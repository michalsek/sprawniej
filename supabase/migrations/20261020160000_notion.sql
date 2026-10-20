-- Notion: a page sent from Notion becomes an issue (docs/notion.md).
--
-- A database button or an automation in Notion sends a page's properties to the Edge Function notion-webhook with
-- "Send webhook". Notion signs nothing, so the address carries a secret (?c=<connection>&k=<secret>); only its sha256
-- is kept here. The function asks two functions here, which only it may call (the service role): notion_lookup()
-- checks the secret and reads what it needs, notion_apply() checks it again and makes the issue as the page's author
-- (or nobody), with its labels and Inbox notes. The same page sent again keeps the issue it made, and changes nothing.
-- Admins connect a workspace in Settings › Notion with notion_connect() and replace the address with
-- notion_new_secret().
--
-- sprawniej.via (the GitHub file) is now also set by notion_apply ({"notion": {"url": ...}}), and an issue made while
-- it is set gets one history event saying so.

-- ---------- one connection per workspace ----------

create table public.notion_connections (
  id             uuid primary key default gen_random_uuid(),   -- part of the address
  workspace_id   uuid not null unique references public.workspaces (id) on delete cascade,
  team_id        uuid,                           -- where pages become issues; null once that team is deleted
  secret_hash    text not null check (secret_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the secret, never the secret
  secret_set_at  timestamptz not null default now(),             -- when the address was made or last replaced
  added_by       uuid references public.profiles (id) on delete set null,   -- set by a trigger
  created_at     timestamptz not null default now(),
  last_event_at  timestamptz,                    -- the latest page, for Settings
  last_event     jsonb,
  changed_at     timestamptz not null default clock_timestamp(),
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete set null (team_id)
);
create index notion_connections_team on public.notion_connections (workspace_id, team_id);
create index notion_connections_added_by on public.notion_connections (added_by);

-- Not broadcast: like invites and github_repos, admins read it when Settings opens.
insert into private.wiring (name, keys, ws_col, topic, topic_col, policies, stamp, forget) values
  ('notion_connections', '{id}',                      'workspace_id', null,  null,           null,                'touch',         false);
call private.wire('notion_connections');

create trigger a_author before insert on public.notion_connections
  for each row execute function private.stamp_author('added_by');

-- only admins and owners see, change and remove it; notion_connect() makes it, with its secret
create policy "admins manage notion" on public.notion_connections for all to authenticated
  using (workspace_id in (select private.my_admin_workspaces()))
  with check (workspace_id in (select private.my_admin_workspaces()));
grant update (team_id) on public.notion_connections to authenticated;
grant delete on public.notion_connections to authenticated;

-- ---------- which page made which issue ----------

-- Per workspace, not per connection: disconnecting and connecting again still finds earlier pages. Deleting the issue
-- deletes the row, so the page can be sent again; archiving keeps it. Never sent to browsers.
create table private.notion_pages (
  workspace_id   uuid not null,
  page_id        text not null check (page_id ~ '^[0-9a-f]{32}$'),   -- Notion's page id, lower case, no dashes
  issue_id       text not null,
  connection_id  uuid references public.notion_connections (id) on delete set null,
  url            text not null check (url ~ '^https://'),
  created_at     timestamptz not null default now(),
  primary key (workspace_id, page_id),
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade
);
create index notion_pages_issue on private.notion_pages (workspace_id, issue_id);
create index notion_pages_recent on private.notion_pages (connection_id, created_at);
revoke all on private.notion_pages from public, anon, authenticated;

-- ---------- for admins (Settings › Notion) ----------

-- Connects the workspace: pages become issues in p_team. Gives {"id", "secret"}; the secret is shown once and only its
-- sha256 is kept.
create function public.notion_connect(p_workspace uuid, p_team uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  secret text := encode(extensions.gen_random_bytes(32), 'hex');
  made uuid;
begin
  if p_workspace is null or p_workspace not in (select private.my_admin_workspaces()) then
    raise exception 'Only admins and owners can connect Notion.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team and t.workspace_id = p_workspace) then
    raise exception 'There is no such team.' using errcode = '23503';
  end if;
  begin
    insert into public.notion_connections (workspace_id, team_id, secret_hash)
    values (p_workspace, p_team, encode(extensions.digest(secret, 'sha256'), 'hex'))
    returning id into made;
  exception when unique_violation then
    raise exception 'Notion is already connected.' using errcode = '23505';
  end;
  return jsonb_build_object('id', made, 'secret', secret);
end $$;

-- "Replace address": a new secret, and the old address stops working at its next delivery. Gives the new secret.
create function public.notion_new_secret(p_connection uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  secret text := encode(extensions.gen_random_bytes(32), 'hex');
  ws uuid;
begin
  select c.workspace_id into ws from public.notion_connections c where c.id = p_connection;
  if not found then raise exception 'Notion isn''t connected.' using errcode = 'P0002'; end if;
  if ws not in (select private.my_admin_workspaces()) then
    raise exception 'Only admins and owners can connect Notion.' using errcode = '42501';
  end if;
  update public.notion_connections
     set secret_hash = encode(extensions.digest(secret, 'sha256'), 'hex'), secret_set_at = now()
   where id = p_connection;
  return secret;
end $$;

-- ---------- what the webhook needs to know ----------

-- With the right secret: the workspace, the team the page goes to (the page's Team property by key or name, else the
-- connection's team) with the place at the top of its list, the members, those whose sign-in email is one the page
-- names (at most 20), and the labels. Otherwise only {"state": "unknown"} or {"state": "wrong_key"}.
create function public.notion_lookup(p_connection uuid, p_secret_hash text, p_emails text[], p_team text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.notion_connections;
  t public.teams;
  hint text := lower(trim(coalesce(p_team, '')));
  mails text[] := (select coalesce(array_agg(distinct lower(trim(e))), '{}') from unnest(p_emails[1:20]) e where e is not null);
begin
  select * into c from public.notion_connections where id = p_connection;
  if not found then return '{"state": "unknown"}'; end if;
  if c.secret_hash is distinct from p_secret_hash then return '{"state": "wrong_key"}'; end if;
  if hint <> '' then
    select * into t from public.teams
     where workspace_id = c.workspace_id and (lower(key) = hint or lower(trim(name)) = hint)
     order by lower(key) = hint desc limit 1;
  end if;
  if t.id is null then
    select * into t from public.teams where workspace_id = c.workspace_id and id = c.team_id;
  end if;
  return jsonb_build_object(
    'state', 'ok',
    'connection', c.id,
    'workspace', c.workspace_id,
    'team', case when t.id is not null then jsonb_build_object(
      'id', t.id,
      'key', t.key,
      'first_sort', (select min(i.sort_order) from public.issues i
                      where i.workspace_id = c.workspace_id and i.team_id = t.id and i.archived_at is null)) end,
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'login', p.login))
                          from public.workspace_members m join public.profiles p on p.id = m.profile_id
                         where m.workspace_id = c.workspace_id and m.removed_at is null), '[]'),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('email', lower(u.email), 'profile_id', p.id))
                          from auth.users u
                          join public.profiles p on p.user_id = u.id
                          join public.workspace_members m on m.profile_id = p.id
                         where m.workspace_id = c.workspace_id and m.removed_at is null
                           and u.email_confirmed_at is not null and lower(u.email) = any(mails)), '[]'),
    'labels', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name))
                          from public.labels l where l.workspace_id = c.workspace_id), '[]'));
end $$;

-- Makes the issue for a page, in one go, unless the page already made one (then it says which). p_page: {"id",
-- "url"}. p_issue: {"id", "team_id", "title", "description", "status", "priority", "assignee_id", "due_date",
-- "sort_order", "labels": [label ids]}; anything that doesn't fit is tidied (a blank title is "Untitled", an unknown
-- status Todo, an assignee who isn't a member nobody). p_notes: [{"id", "to", "type"}], the Inbox notes the webhook
-- worked out (src/data/notify.ts). p_actor: the page's author when they are a member, or null ("From Notion"). The
-- connection remembers what happened (last_event).
create function public.notion_apply(p_connection uuid, p_secret_hash text, p_page jsonb, p_actor uuid,
                                    p_issue jsonb, p_notes jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.notion_connections;
  page text := lower(replace(coalesce(p_page ->> 'id', ''), '-', ''));
  link text := left(p_page ->> 'url', 2000);
  had record;
  team uuid;
  iid text := p_issue ->> 'id';
  title text := left(coalesce(nullif(trim(regexp_replace(coalesce(p_issue ->> 'title', ''), '\s+', ' ', 'g')), ''), 'Untitled'), 500);
  st text := p_issue ->> 'status';
  due date;
  who uuid;
  tags text[];
  ref text;
begin
  select * into c from public.notion_connections where id = p_connection for update;
  if not found then raise exception 'There is no such connection.' using errcode = 'P0002'; end if;
  if c.secret_hash is distinct from p_secret_hash then
    raise exception 'This address was replaced.' using errcode = '42501';
  end if;
  if page !~ '^[0-9a-f]{32}$' then raise exception 'That isn''t a Notion page.' using errcode = '22023'; end if;
  if link is null or link !~ '^https://([a-z0-9-]+\.)*notion\.(so|site)/' then link := 'https://www.notion.so/' || page; end if;

  -- the same page again: the issue it made
  select t.key || '-' || i.number as ref, i.title, i.archived_at is not null as archived into had
    from private.notion_pages n
    join public.issues i on i.workspace_id = n.workspace_id and i.id = n.issue_id
    join public.teams t on t.id = i.team_id
   where n.workspace_id = c.workspace_id and n.page_id = page;
  if found then
    update public.notion_connections
       set last_event_at = now(), last_event = jsonb_build_object('title', had.title, 'ref', had.ref, 'new', false)
     where id = c.id;
    return jsonb_build_object('issue', had.ref, 'new', false, 'archived', had.archived);
  end if;

  -- too many at once (an automation gone wild): Notion pauses it, and Settings says why
  if (select count(*) from private.notion_pages n
       where n.connection_id = c.id and n.created_at > now() - interval '10 minutes') >= 100 then
    update public.notion_connections set last_event_at = now(), last_event = '{"problem": "busy"}' where id = c.id;
    return '{"problem": "busy"}';
  end if;

  if p_issue ->> 'team_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select t.id into team from public.teams t where t.workspace_id = c.workspace_id and t.id = (p_issue ->> 'team_id')::uuid;
  end if;
  if team is null then
    update public.notion_connections
       set last_event_at = now(), last_event = jsonb_build_object('title', title, 'problem', 'team')
     where id = c.id;
    return '{"problem": "team"}';
  end if;

  if p_actor is not null and not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = c.workspace_id and m.profile_id = p_actor and m.removed_at is null) then
    raise exception 'That person isn''t in this workspace.' using errcode = '42501';
  end if;

  if st is null or st not in (
    -- @list issue-statuses
    'backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate'
  ) then
    st := 'todo';
  end if;
  if p_issue ->> 'due_date' ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      due := (p_issue ->> 'due_date')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      due := null;
    end;
  end if;
  if p_issue ->> 'assignee_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select m.profile_id into who from public.workspace_members m
     where m.workspace_id = c.workspace_id and m.profile_id = (p_issue ->> 'assignee_id')::uuid and m.removed_at is null;
  end if;
  if jsonb_typeof(p_issue -> 'labels') = 'array' then
    tags := array(select l.id from public.labels l
                   where l.workspace_id = c.workspace_id
                     and l.id in (select jsonb_array_elements_text(p_issue -> 'labels'))
                   order by l.id limit 20);
  end if;

  perform set_config('sprawniej.actor', coalesce(p_actor::text, ''), true);
  perform set_config('sprawniej.via', jsonb_build_object('notion', jsonb_build_object('url', link))::text, true);
  begin
    insert into public.issues (id, workspace_id, team_id, title, description, status, priority, assignee_id, due_date,
                               sort_order)
    values (iid, c.workspace_id, team, title, left(coalesce(p_issue ->> 'description', ''), 50000), st,
            case when p_issue ->> 'priority' ~ '^[0-4]$' then (p_issue ->> 'priority')::smallint else 0 end,
            who, due, coalesce(nullif(left(p_issue ->> 'sort_order', 200), ''), 'a0'))
    returning (select t.key from public.teams t where t.id = team) || '-' || number into ref;
    insert into public.issue_labels (workspace_id, issue_id, label_id)
    select c.workspace_id, iid, l from unnest(coalesce(tags, '{}')) l;
    insert into private.notion_pages (workspace_id, page_id, issue_id, connection_id, url)
    values (c.workspace_id, page, iid, c.id, link);
    -- check_note drops notes for people who aren't members, and the author's own
    insert into public.inbox (id, workspace_id, recipient_id, type, issue_id, extra)
    select n ->> 'id', c.workspace_id, (n ->> 'to')::uuid, n ->> 'type', iid, '{"from": "notion"}'
      from jsonb_array_elements(coalesce(p_notes, '[]')) n
     where n ->> 'type' in ('assigned', 'mentioned');
  exception when unique_violation then
    -- the same page in another delivery at the same moment (the row lock makes it rare): that one's issue
    select t.key || '-' || i.number as ref, i.archived_at is not null as archived into had
      from private.notion_pages n
      join public.issues i on i.workspace_id = n.workspace_id and i.id = n.issue_id
      join public.teams t on t.id = i.team_id
     where n.workspace_id = c.workspace_id and n.page_id = page;
    if not found then raise; end if;
    perform set_config('sprawniej.via', '', true);
    perform set_config('sprawniej.actor', '', true);
    return jsonb_build_object('issue', had.ref, 'new', false, 'archived', had.archived);
  end;
  perform set_config('sprawniej.via', '', true);
  perform set_config('sprawniej.actor', '', true);

  update public.notion_connections
     set last_event_at = now(),
         last_event = jsonb_build_object('title', title, 'ref', ref, 'new', true,
                                         'author', (select p.login from public.profiles p where p.id = p_actor))
   where id = c.id;
  return jsonb_build_object('issue', ref, 'new', true);
end $$;

grant execute on function public.notion_lookup(uuid, text, text[], text),
  public.notion_apply(uuid, text, jsonb, uuid, jsonb, jsonb) to service_role;
grant execute on function public.notion_connect(uuid, uuid), public.notion_new_secret(uuid) to authenticated;

-- ---------- history says where it came from ----------

-- An issue made through an integration (notion_apply sets sprawniej.via) gets one event saying so, by whoever it was
-- made as. One made in the app or by an import still writes none: its own fields say who and when.
create function private.issue_created_via() returns trigger
language plpgsql security definer set search_path = '' as $$
declare via text := nullif(current_setting('sprawniej.via', true), '');
begin
  if private.importing() or via is null or via = 'null' then return null; end if;
  insert into public.issue_events (workspace_id, issue_id, actor_id, changes)
  values (new.workspace_id, new.id, private.actor_id(), jsonb_build_object('created', true, 'via', via::jsonb));
  return null;
end $$;

create trigger history_created after insert on public.issues
  for each row execute function private.issue_created_via();
