-- The functions the app calls (docs/supabase-plan.md, section 4), and what they share.
-- Each one checks who is calling, runs as its owner (security definer) and only signed-in people may call it (P2).
-- Errors carry friendly text, because the app shows it as it is, and a code the app can tell apart:
--   42501  not allowed (not signed in, not an admin, someone or something from another workspace)
--   P0002  not there (an issue, an invite link, a person from Linear)
--   23505  already taken (a login, an issue number)
--   23503  no such team
--   22023  not valid (a login, a person to link to)
--   SP001  you already have a name here
--   SP002  the invite was already used
--   SP003  the invite has expired
--   SP010  an import the database can't take (wrong table, too many or too few rows, rows without their keys);
--          the detail says what, for whoever looks after Sprawniej

-- ---------- profiles ----------

-- After sign-in: your profile; or an imported one whose GitHub id matches your GitHub sign-in; or a new one with your
-- GitHub login if it's free. Nothing (an empty list) means you still need to pick a name: create_profile().
-- What GitHub says comes from auth.identities, which Supabase filled at sign-in, never from the browser.
create function public.ensure_profile() returns setof public.profiles rows 1
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  p public.profiles;
  gid bigint;
  glogin text;
  gname text;
  gavatar text;
begin
  if uid is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  select * into p from public.profiles where user_id = uid;
  if found then return next p; return; end if;
  select case when i.provider_id ~ '^\d{1,18}$' then i.provider_id::bigint end,
         i.identity_data ->> 'user_name',
         coalesce(i.identity_data ->> 'full_name', i.identity_data ->> 'name', ''),
         coalesce(i.identity_data ->> 'avatar_url', '')
    into gid, glogin, gname, gavatar
    from auth.identities i where i.user_id = uid and i.provider = 'github' order by i.created_at limit 1;
  if gid is not null then
    -- claim a person imported from an old workspace
    update public.profiles set user_id = uid, avatar_url = coalesce(nullif(gavatar, ''), avatar_url)
     where github_id = gid and user_id is null and guest_of is null
    returning * into p;
    if found then return next p; return; end if;
    if private.valid_login(glogin) then
      insert into public.profiles (user_id, login, github_id, name, avatar_url)
      values (uid, glogin, gid, coalesce(gname, ''), coalesce(gavatar, ''))
      on conflict do nothing
      returning * into p;
      if found then return next p; return; end if;   -- a taken login (or a race): they pick one
    end if;
  end if;
  return query select * from public.profiles where user_id = uid;
end $$;

-- Picks your name here (@login), once. For email and Google sign-ups, or when your GitHub login is taken.
create function public.create_profile(p_login text, p_name text) returns setof public.profiles rows 1
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  wanted text := trim(coalesce(p_login, ''));
  p public.profiles;
  gid bigint;
  gavatar text;
begin
  if uid is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where user_id = uid) then
    raise exception 'You already have a name here.' using errcode = 'SP001';
  end if;
  if not private.valid_login(wanted) then
    raise exception 'Use up to 39 letters, digits and dashes, starting with a letter or a digit.' using errcode = '22023';
  end if;
  select case when i.provider_id ~ '^\d{1,18}$' then i.provider_id::bigint end, coalesce(i.identity_data ->> 'avatar_url', '')
    into gid, gavatar
    from auth.identities i where i.user_id = uid and i.provider = 'github' order by i.created_at limit 1;
  if gid is not null and exists (select 1 from public.profiles where github_id = gid) then gid := null; end if;
  begin
    insert into public.profiles (user_id, login, name, github_id, avatar_url)
    values (uid, wanted, trim(coalesce(p_name, '')), gid, coalesce(gavatar, ''))
    returning * into p;
  exception when unique_violation then
    raise exception 'Someone already uses @%. Pick another one.', wanted using errcode = '23505';
  end;
  return next p;
end $$;

-- ---------- workspaces and invites ----------

-- A new workspace with you as its owner and a first team with you in it.
create function public.create_workspace(p_name text, p_team_key text, p_team_name text, p_team_emoji text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_profile_id();
  ws uuid;
  team uuid;
begin
  if me is null then raise exception 'Pick your name first.' using errcode = '42501'; end if;
  insert into public.workspaces (name, created_by) values (trim(coalesce(p_name, '')), me) returning id into ws;
  insert into public.workspace_members (workspace_id, profile_id, role) values (ws, me, 'owner');
  insert into public.teams (workspace_id, key, name, emoji)
  values (ws, upper(trim(coalesce(p_team_key, ''))), trim(coalesce(p_team_name, '')), coalesce(p_team_emoji, ''))
  returning id into team;
  insert into public.team_members (workspace_id, team_id, profile_id) values (ws, team, me);
  insert into public.read_state (profile_id, workspace_id) values (me, ws) on conflict do nothing;
  return ws;
end $$;

-- What the join page shows before you join. Never the token, never an email. An unknown token gives no rows.
-- state: member (you're already in), used, expired or open.
create function public.invite_info(p_token text)
returns table (workspace_id uuid, workspace_name text, invited_by_name text, invited_by_login text,
               invited_by_avatar text, for_login text, for_name text, role text, state text, people jsonb)
language sql stable security definer set search_path = '' as $$
  select i.workspace_id, w.name,
         coalesce(nullif(b.name, ''), b.login), b.login, b.avatar_url,
         i.for_login, g.name, i.role,
         case when exists (select 1 from public.workspace_members m where m.workspace_id = i.workspace_id
                           and m.profile_id = (select private.my_profile_id()) and m.removed_at is null) then 'member'
              when i.accepted_at is not null then 'used'
              when i.expires_at < now() then 'expired'
              else 'open' end,
         (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'avatarUrl', x.avatar_url)), '[]'::jsonb)
            from (select coalesce(nullif(p.name, ''), p.login) as name, p.avatar_url
                    from public.workspace_members m join public.profiles p on p.id = m.profile_id
                   where m.workspace_id = i.workspace_id and m.removed_at is null
                   order by m.joined_at limit 8) x)
    from public.invites i
    join public.workspaces w on w.id = i.workspace_id
    left join public.profiles b on b.id = i.invited_by
    left join public.profiles g on g.id = i.for_profile
   where i.token = p_token and (select auth.uid()) is not null
$$;

-- Makes you a member (or brings you back), marks the invite used. An invite for a person from Linear turns that
-- person into you: their work moves to your profile (move_person).
create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_profile_id();
  inv public.invites;
begin
  if me is null then raise exception 'Pick your name first.' using errcode = '42501'; end if;
  select * into inv from public.invites where token = p_token for update;
  if not found then
    raise exception 'This invite link doesn''t work. Ask for a new one.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.workspace_members m where m.workspace_id = inv.workspace_id
             and m.profile_id = me and m.removed_at is null) then
    return inv.workspace_id;                                 -- already in
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invite was already used. Ask for a new one.' using errcode = 'SP002';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invite has expired. Ask for a new one.' using errcode = 'SP003';
  end if;
  perform set_config('sprawniej.trusted', 'on', true);
  insert into public.workspace_members (workspace_id, profile_id, role) values (inv.workspace_id, me, inv.role)
  on conflict (workspace_id, profile_id) do update set removed_at = null, role = excluded.role, joined_at = now();
  -- before the move: removing the guest sets for_profile to null
  update public.invites set accepted_by = me, accepted_at = now() where id = inv.id;
  if inv.for_profile is not null and exists (select 1 from public.profiles g
                                             where g.id = inv.for_profile and g.guest_of = inv.workspace_id) then
    perform private.move_person(inv.for_profile, me, inv.workspace_id);
  end if;
  insert into public.read_state (profile_id, workspace_id) values (me, inv.workspace_id) on conflict do nothing;
  perform set_config('sprawniej.trusted', 'off', true);
  return inv.workspace_id;
end $$;

-- You leave a workspace. The last owner can't (a trigger says so).
create function public.leave_workspace(p_ws uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.my_profile_id();
begin
  perform set_config('sprawniej.trusted', 'on', true);
  update public.workspace_members set removed_at = now()
   where workspace_id = p_ws and profile_id = me and removed_at is null;
  if not found then raise exception 'You are not in this workspace.' using errcode = 'P0002'; end if;
  perform set_config('sprawniej.trusted', 'off', true);
end $$;

-- ---------- issues ----------

-- Moves an issue to another team of the same workspace: it gets a number there and remembers its old one.
create function public.move_issue_to_team(p_issue text, p_team uuid) returns public.issues
language plpgsql security definer set search_path = '' as $$
declare
  i public.issues;
  old_ref text;
  n integer;
begin
  select * into i from public.issues where id = p_issue for update;
  if not found or i.workspace_id not in (select private.my_workspaces()) then
    raise exception 'There is no such issue.' using errcode = 'P0002';
  end if;
  if i.team_id = p_team then return i; end if;
  select t.key || '-' || i.number into old_ref from public.teams t where t.id = i.team_id;
  n := private.take_number(i.workspace_id, p_team);
  update public.issues set team_id = p_team, number = n, former_refs = former_refs || old_ref
   where id = p_issue
  returning * into i;
  return i;
end $$;

-- ---------- people from Linear ----------

-- Swaps one login for another in a view's assignees and subscribers filters, keeping the order, dropping repeats and
-- leaving null (no assignee) as it is (P10).
create function private.swap_login(f jsonb, from_login text, to_login text) returns jsonb
language sql immutable set search_path = '' as $$
  select f || coalesce((
    select jsonb_object_agg(k, (
      select coalesce(jsonb_agg(d.x order by d.first_n), '[]'::jsonb) from (
        select s.x, min(s.n) as first_n from (
          select case when a.e = to_jsonb(from_login) then to_jsonb(to_login) else a.e end as x, a.n
            from jsonb_array_elements(f -> k) with ordinality as a(e, n)) s
        group by s.x) d))
    from unnest(array['assignees', 'subscribers']) k
    where jsonb_typeof(f -> k) = 'array'), '{}'::jsonb)
$$;

-- A person from Linear who hadn't joined is this person: every reference moves over and the guest goes. Quietly (no
-- history, no per-row broadcasts), then one catch-up message for the workspace.
create function private.move_person(p_guest uuid, p_to uuid, p_ws uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.profiles;
  t public.profiles;
begin
  select * into g from public.profiles where id = p_guest and guest_of = p_ws for update;
  if not found then raise exception 'That person isn''t here any more.' using errcode = 'P0002'; end if;
  select * into t from public.profiles where id = p_to for update;
  if not found or t.guest_of is not null then
    raise exception 'You can only link someone to a person who has joined.' using errcode = '22023';
  end if;
  perform set_config('sprawniej.importing', 'on', true);
  -- they join the teams the guest's issues are in, and the guest's teams
  insert into public.team_members (workspace_id, team_id, profile_id)
  select distinct p_ws, x.team_id, p_to from (
    select i.team_id from public.issues i
     where i.workspace_id = p_ws and (i.assignee_id = p_guest or i.created_by = p_guest)
    union
    select tm.team_id from public.team_members tm where tm.workspace_id = p_ws and tm.profile_id = p_guest) x
  on conflict (team_id, profile_id) do nothing;
  update public.issues       set assignee_id = p_to where workspace_id = p_ws and assignee_id = p_guest;
  update public.issues       set created_by  = p_to where workspace_id = p_ws and created_by  = p_guest;
  update public.issues       set archived_by = p_to where workspace_id = p_ws and archived_by = p_guest;
  update public.comments     set author_id   = p_to where workspace_id = p_ws and author_id   = p_guest;
  update public.projects     set lead_id     = p_to where workspace_id = p_ws and lead_id     = p_guest;
  update public.views        set owner_id    = p_to where workspace_id = p_ws and owner_id    = p_guest;
  update public.inbox        set actor_id    = p_to where workspace_id = p_ws and actor_id    = p_guest;
  update public.issue_events set actor_id    = p_to where workspace_id = p_ws and actor_id    = p_guest;
  -- ids inside the history ({"assignee": [old, new]})
  update public.issue_events e
     set changes = jsonb_set(e.changes, '{assignee}',
       (select jsonb_agg(case when a.v = to_jsonb(p_guest::text) then to_jsonb(p_to::text) else a.v end order by a.n)
          from jsonb_array_elements(e.changes -> 'assignee') with ordinality a(v, n)))
   where e.workspace_id = p_ws and e.changes -> 'assignee' @> jsonb_build_array(p_guest::text);
  -- logins inside view filters
  update public.views v set filters = private.swap_login(v.filters, g.login, t.login)
   where v.workspace_id = p_ws
     and (v.filters -> 'assignees' @> jsonb_build_array(g.login)
          or v.filters -> 'subscribers' @> jsonb_build_array(g.login));
  insert into public.issue_followers (workspace_id, issue_id, profile_id, following)
  select f.workspace_id, f.issue_id, p_to, f.following from public.issue_followers f
   where f.workspace_id = p_ws and f.profile_id = p_guest
  on conflict (issue_id, profile_id) do nothing;
  update public.profiles set
      linear_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(t.linear_ids || g.linear_ids) x),
      name = case when t.name = '' or t.name = t.login then g.name else t.name end,
      avatar_url = case when t.avatar_url = '' then g.avatar_url else t.avatar_url end
   where id = p_to;
  delete from public.invites where for_profile = p_guest and accepted_at is null;
  delete from public.profiles where id = p_guest;          -- the forget trigger notes it under guest_of (P10)
  perform set_config('sprawniej.importing', 'off', true);
  perform realtime.send(jsonb_build_object('op', 'catch_up'), 'change', 'ws:' || p_ws, true);
end $$;

-- Admins: "this person from Linear is that member".
create function public.link_person(p_ws uuid, p_guest uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_ws is null or p_ws not in (select private.my_admin_workspaces()) then
    raise exception 'Only admins can link people.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_members m
                 where m.workspace_id = p_ws and m.profile_id = p_to and m.removed_at is null) then
    raise exception 'You can only link someone to a person who is in this workspace.' using errcode = '22023';
  end if;
  perform private.move_person(p_guest, p_to, p_ws);
end $$;

-- Admins: the email a person from Linear had there, so Settings can suggest inviting them. Empty forgets it.
create function public.set_guest_email(p_profile uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles g
                 where g.id = p_profile and g.guest_of in (select private.my_admin_workspaces())) then
    raise exception 'Only admins can do this.' using errcode = '42501';
  end if;
  if coalesce(trim(p_email), '') = '' then
    delete from private.guest_emails where profile_id = p_profile;
  else
    insert into private.guest_emails (profile_id, email) values (p_profile, trim(p_email))
    on conflict (profile_id) do update set email = excluded.email;
  end if;
end $$;

-- Admins: the emails of a workspace's people from Linear.
create function public.guest_emails(p_ws uuid) returns table (profile_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select e.profile_id, e.email
    from private.guest_emails e join public.profiles g on g.id = e.profile_id
   where g.guest_of = p_ws and p_ws in (select private.my_admin_workspaces())
$$;

-- ---------- imports ----------

-- What import_rows may write, per table: the columns it may insert and update, the columns that name a person (who
-- must be in the workspace) and whether it only updates rows that came from an import (comments: what people wrote
-- here stays theirs). The workspace column and the keys come from private.wiring (P4).
create table private.import_spec (
  table_name     text primary key references private.wiring (name),
  insert_cols    text[] not null,
  update_cols    text[] not null default '{}',
  person_cols    text[] not null default '{}',
  only_imported  boolean not null default false
);

insert into private.import_spec (table_name, insert_cols, update_cols, person_cols, only_imported) values
  ('profiles',
   '{id,login,name,avatar_url,guest_of,linear_ids,extra}',
   '{name,avatar_url,linear_ids,extra}', '{}', false),
  ('teams',
   '{id,workspace_id,key,name,emoji,auto_archive,linear_id,created_at,extra}',
   '{name,emoji,linear_id,extra}', '{}', false),
  ('team_members',
   '{workspace_id,team_id,profile_id}', '{}', '{profile_id}', false),
  ('labels',
   '{id,workspace_id,name,color,linear_id,extra}',
   '{name,color,linear_id,extra}', '{}', false),
  ('projects',
   '{id,workspace_id,name,emoji,description,status,lead_id,target_date,linear_id,created_at,extra}',
   '{name,emoji,description,status,lead_id,target_date,linear_id,extra}', '{lead_id}', false),
  ('project_teams',
   '{workspace_id,project_id,team_id}', '{}', '{}', false),
  ('issues',
   '{id,workspace_id,team_id,number,title,description,status,priority,assignee_id,project_id,parent_id,due_date,estimate,sort_order,duplicate_of,former_refs,created_by,created_at,updated_at,completed_at,archived_at,archived_by,linear_id,extra}',
   '{title,description,status,priority,assignee_id,project_id,parent_id,due_date,estimate,duplicate_of,completed_at,updated_at,linear_id,extra}',
   '{assignee_id,created_by,archived_by}', false),
  ('issue_labels',
   '{workspace_id,issue_id,label_id}', '{}', '{}', false),
  ('issue_followers',
   '{workspace_id,issue_id,profile_id,following}', '{following}', '{profile_id}', false),
  ('comments',
   '{id,workspace_id,issue_id,author_id,body,created_at,edited_at,linear_id,extra}',
   '{body,edited_at,linear_id,extra}', '{author_id}', true),
  ('views',
   '{id,workspace_id,team_id,owner_id,name,emoji,description,filters,display,created_at,linear_id,extra}',
   '{name,emoji,description,filters,linear_id,extra}', '{owner_id}', false);

-- Admins: insert or update up to 1000 rows of one table, quietly (no history, no per-row broadcasts), keeping the
-- numbers and times that came with them, then one catch-up message for the workspace (P3, P4, P13, P15).
--
-- What the caller must do (phase 6):
--   * send the same columns in every row of a batch (a column missing from one row becomes null, not its default);
--   * send every required column in every row, even for a row that is already here and will only be updated:
--     Postgres checks the proposed row (not null, checks) before it finds the conflict;
--   * reuse the existing id for a row that matches an earlier import by linear_id. Rows match on the primary key,
--     not on (workspace_id, linear_id): child rows point at ids, so ids must stay the same anyway, and one rule works
--     for every table. A new id with an old linear_id fails loudly on unique (workspace_id, linear_id).
-- A row whose key belongs to another workspace is refused, whatever the rows say about their workspace (S1).
-- A second run with the same rows changes nothing and returns 0.
create function public.import_rows(p_ws uuid, p_table text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s private.import_spec;
  w private.wiring;
  pinned jsonb;
  present text[];
  ins text[];
  upd text[];
  elsewhere boolean;
  n integer;
  q text;
  cant constant text := 'This import has something Sprawniej can''t take. Try again, and tell whoever looks after '
                        'Sprawniej if it keeps happening.';
begin
  if p_ws is null or p_ws not in (select private.my_admin_workspaces()) then
    raise exception 'Only admins can import.' using errcode = '42501';
  end if;
  select * into s from private.import_spec where table_name = p_table;
  if not found then raise exception '%', cant using errcode = 'SP010', detail = format('table %s', p_table); end if;
  select * into w from private.wiring where name = p_table;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception '%', cant using errcode = 'SP010', detail = 'send an array of 1 to 1000 rows';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r) <> 'object') then
    raise exception '%', cant using errcode = 'SP010', detail = 'every row must be an object';
  end if;
  -- whatever the rows say, they land in this workspace
  select jsonb_agg(r || jsonb_build_object(w.ws_col, p_ws)) into pinned from jsonb_array_elements(p_rows) r;
  select array_agg(distinct k) into present from jsonb_array_elements(pinned) r, jsonb_object_keys(r) k;
  if not w.keys <@ present then
    raise exception '%', cant using errcode = 'SP010', detail = format('every row needs %s', array_to_string(w.keys, ', '));
  end if;
  ins := array(select c from unnest(s.insert_cols) c where c = any (present));
  upd := array(select c from unnest(s.update_cols) c where c = any (present));
  -- people named in the rows must be in this workspace
  if exists (select 1 from jsonb_array_elements(pinned) r, unnest(s.person_cols) c
             where r ->> c is not null and not private.belongs((r ->> c)::uuid, p_ws)) then
    raise exception 'This import names someone who isn''t in this workspace.' using errcode = '42501';
  end if;
  -- a key that is already used in another workspace (or by someone who has joined, for profiles) is refused (S1)
  execute format('select exists (select 1 from public.%1$I t join jsonb_populate_recordset(null::public.%1$I, $1) r '
                 'on %2$s where t.%3$I is distinct from $2)',
                 p_table,
                 (select string_agg(format('t.%1$I = r.%1$I', k), ' and ') from unnest(w.keys) k),
                 w.ws_col)
    into elsewhere using pinned, p_ws;
  if elsewhere then
    raise exception 'This import would change something outside this workspace.' using errcode = '42501';
  end if;
  perform set_config('sprawniej.importing', 'on', true);
  q := format('insert into public.%1$I as t (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) '
              'on conflict (%3$s) ',
              p_table,
              (select string_agg(format('%I', c), ', ') from unnest(ins) c),
              (select string_agg(format('%I', c), ', ') from unnest(w.keys) c));
  if cardinality(upd) = 0 then
    q := q || 'do nothing';
  else
    -- only this workspace's rows; a re-run with the same values touches nothing (P3)
    q := q || format('do update set %s where t.%I = $2%s and (%s) is distinct from (%s)',
      (select string_agg(format('%I = excluded.%I', c, c), ', ') from unnest(upd) c),
      w.ws_col,
      case when s.only_imported then ' and t.linear_id is not null' else '' end,
      (select string_agg(format('t.%I', c), ', ') from unnest(upd) c),
      (select string_agg(format('excluded.%I', c), ', ') from unnest(upd) c));
  end if;
  execute q using pinned, p_ws;
  get diagnostics n = row_count;
  perform set_config('sprawniej.importing', 'off', true);
  perform realtime.send(jsonb_build_object('op', 'catch_up', 'table', p_table), 'change', 'ws:' || p_ws, true);
  return n;
end $$;

-- ---------- who may call what ----------
-- New functions are closed by default (helpers file); these are the ones signed-in people call.
grant execute on function
  public.ensure_profile(), public.create_profile(text, text), public.create_workspace(text, text, text, text),
  public.invite_info(text), public.accept_invite(text), public.leave_workspace(uuid),
  public.move_issue_to_team(text, uuid), public.link_person(uuid, uuid, uuid), public.set_guest_email(uuid, text),
  public.guest_emails(uuid), public.import_rows(uuid, text, jsonb)
to authenticated;
