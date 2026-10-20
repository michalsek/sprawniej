-- GitHub: pull requests that mention an issue move it (docs/github-app.md).
--
-- The Edge Function github-webhook checks GitHub's signature, finds the issues a pull request mentions and asks two
-- functions here, which only it may call (the service role): github_lookup() reads what it needs, github_apply()
-- moves the issues as the pull request's author and adds their Inbox notes. Admins say which repository feeds which
-- workspace in github_repos (Settings › GitHub).
--
-- A fourth setting joins the three in the helpers file:
--   sprawniej.via  what a change came through, copied into the history event ({"pullRequest": {...}}). Set only by
--                  github_apply, which nobody signed in can call.

-- ---------- which repository feeds which workspace ----------

create table public.github_repos (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  repo           text not null check (repo ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$'),
  repository_id  bigint,                         -- GitHub's number for it, filled when the first pull request comes
  added_by       uuid references public.profiles (id) on delete set null,   -- set by a trigger
  created_at     timestamptz not null default now(),
  last_event_at  timestamptz,                    -- the latest pull request, for Settings
  last_event     jsonb,
  changed_at     timestamptz not null default clock_timestamp()
);
create unique index github_repos_repo on public.github_repos (workspace_id, lower(repo));
create index github_repos_repository on public.github_repos (repository_id);
create index github_repos_lower_repo on public.github_repos (lower(repo));
create index github_repos_added_by on public.github_repos (added_by);

-- Not broadcast: like invites, admins read it when Settings opens.
insert into private.wiring (name, keys, ws_col, topic, topic_col, policies, stamp, forget) values
  ('github_repos',      '{id}',                      'workspace_id', null,  null,           null,                'touch',         false);
call private.wire('github_repos');

create trigger a_author before insert on public.github_repos
  for each row execute function private.stamp_author('added_by');

-- only admins and owners see, connect and remove repositories; nobody changes one (remove it and connect again)
create policy "admins manage repositories" on public.github_repos for all to authenticated
  using (workspace_id in (select private.my_admin_workspaces()))
  with check (workspace_id in (select private.my_admin_workspaces()));
grant insert (workspace_id, repo) on public.github_repos to authenticated;
grant delete on public.github_repos to authenticated;

-- ---------- what the webhook needs to know ----------

-- For every workspace that connected the repository (by GitHub's number, or by name until the number is known): the
-- pull request's author if they are a member there now, the members' logins, and the issues the refs name (by number
-- or an old number; archived issues stay as they are) with what the Inbox rules need.
create function public.github_lookup(p_repository_id bigint, p_repo text, p_author bigint, p_refs text[])
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  refs text[] := (select coalesce(array_agg(distinct upper(r)), '{}') from unnest(p_refs[1:50]) r);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'connection', c.id,
      'workspace', c.workspace_id,
      'actor', (select p.id from public.profiles p
                  join public.workspace_members m on m.profile_id = p.id
                 where p.github_id = p_author and p.user_id is not null
                   and m.workspace_id = c.workspace_id and m.removed_at is null),
      'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'login', p.login))
                            from public.workspace_members m join public.profiles p on p.id = m.profile_id
                           where m.workspace_id = c.workspace_id and m.removed_at is null), '[]'),
      'issues', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'ref', t.key || '-' || i.number,
          'former_refs', to_jsonb(i.former_refs),
          'status', i.status,
          'created_by', i.created_by,
          'assignee_id', i.assignee_id,
          'description', i.description,
          'followers', coalesce((select jsonb_agg(jsonb_build_object('profile_id', f.profile_id, 'following', f.following))
                                   from public.issue_followers f where f.issue_id = i.id), '[]'),
          'comments', coalesce((select jsonb_agg(jsonb_build_object('author_id', k.author_id, 'body', k.body)
                                                 order by k.created_at)
                                  from public.comments k where k.issue_id = i.id), '[]')))
          from public.issues i join public.teams t on t.id = i.team_id
         where i.workspace_id = c.workspace_id and i.archived_at is null
           and ((t.key || '-' || i.number) = any(refs) or i.former_refs && refs)), '[]')))
      from public.github_repos c
     where c.repository_id = p_repository_id
        or (c.repository_id is null and lower(c.repo) = lower(p_repo))), '[]');
end $$;

-- Moves issues as the pull request's author and adds the Inbox notes the webhook worked out (src/data/notify.ts),
-- in one go. p_moves: [{"issue", "ref", "from": [statuses], "to"}]; an issue moves only if it still has one of the
-- "from" statuses. p_notes: [{"id", "issue", "to", "status"}], kept only for issues that moved. Without an actor
-- (the author isn't a member) nothing moves. Either way the connection remembers the repository's number and name
-- and what happened (p_event, with the refs that moved).
create function public.github_apply(p_connection uuid, p_repository_id bigint, p_repo text, p_actor uuid,
                                    p_via jsonb, p_moves jsonb, p_notes jsonb, p_event jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.github_repos;
  moved text[] := '{}';
  moved_refs text[] := '{}';
  mv jsonb;
  done text;
begin
  select * into c from public.github_repos where id = p_connection for update;
  if not found then raise exception 'There is no such connection.' using errcode = 'P0002'; end if;

  if p_actor is not null then
    if not exists (select 1 from public.workspace_members m
                    where m.workspace_id = c.workspace_id and m.profile_id = p_actor and m.removed_at is null) then
      raise exception 'That person isn''t in this workspace.' using errcode = '42501';
    end if;
    perform set_config('sprawniej.actor', p_actor::text, true);
    perform set_config('sprawniej.via', coalesce(p_via, 'null')::text, true);
    for mv in select * from jsonb_array_elements(coalesce(p_moves, '[]')) loop
      update public.issues set status = mv ->> 'to'
       where id = mv ->> 'issue' and workspace_id = c.workspace_id and archived_at is null
         and status in (select jsonb_array_elements_text(mv -> 'from'))
      returning id into done;
      if done is not null then
        moved := moved || done;
        moved_refs := moved_refs || (mv ->> 'ref');
        done := null;
      end if;
    end loop;
    insert into public.inbox (id, workspace_id, recipient_id, type, issue_id, status)
    select n ->> 'id', c.workspace_id, (n ->> 'to')::uuid, 'status', n ->> 'issue', n ->> 'status'
      from jsonb_array_elements(coalesce(p_notes, '[]')) n
     where n ->> 'issue' = any(moved);
    perform set_config('sprawniej.via', '', true);
    perform set_config('sprawniej.actor', '', true);
  end if;

  update public.github_repos set
    repository_id = coalesce(p_repository_id, repository_id),
    repo = case when p_repo is not null and not exists (
                  select 1 from public.github_repos o
                   where o.workspace_id = c.workspace_id and o.id <> c.id and lower(o.repo) = lower(p_repo))
                then p_repo else repo end,
    last_event_at = now(),
    last_event = coalesce(p_event, '{}') || jsonb_build_object('moved', to_jsonb(moved_refs))
   where id = c.id;
  return jsonb_build_object('moved', to_jsonb(moved_refs));
end $$;

grant execute on function public.github_lookup(bigint, text, bigint, text[]),
  public.github_apply(uuid, bigint, text, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

-- ---------- history says why ----------

-- As in the triggers file, plus "via" when the change came through a pull request (sprawniej.via).
create or replace function private.issue_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := '{}';
  via text := nullif(current_setting('sprawniej.via', true), '');
begin
  if private.importing() then return null; end if;
  if new.title       is distinct from old.title       then c := c || jsonb_build_object('title',    jsonb_build_array(old.title, new.title)); end if;
  if new.status      is distinct from old.status      then c := c || jsonb_build_object('status',   jsonb_build_array(old.status, new.status)); end if;
  if new.priority    is distinct from old.priority    then c := c || jsonb_build_object('priority', jsonb_build_array(old.priority, new.priority)); end if;
  if new.assignee_id is distinct from old.assignee_id then c := c || jsonb_build_object('assignee', jsonb_build_array(old.assignee_id, new.assignee_id)); end if;
  if new.project_id  is distinct from old.project_id  then c := c || jsonb_build_object('project',  jsonb_build_array(old.project_id, new.project_id)); end if;
  if new.parent_id   is distinct from old.parent_id   then c := c || jsonb_build_object('parent',   jsonb_build_array(old.parent_id, new.parent_id)); end if;
  if new.due_date    is distinct from old.due_date    then c := c || jsonb_build_object('dueDate',  jsonb_build_array(old.due_date, new.due_date)); end if;
  if new.estimate    is distinct from old.estimate    then c := c || jsonb_build_object('estimate', jsonb_build_array(old.estimate, new.estimate)); end if;
  if new.description is distinct from old.description then c := c || '{"description": true}'; end if;
  if new.team_id     is distinct from old.team_id then
    c := c || jsonb_build_object('team', jsonb_build_array(
      new.former_refs[array_length(new.former_refs, 1)],
      (select t.key from public.teams t where t.id = new.team_id) || '-' || new.number));
  end if;
  if new.archived_at is distinct from old.archived_at then
    c := c || jsonb_build_object(case when new.archived_at is null then 'restored' else 'archived' end, true);
  end if;
  if c <> '{}' then
    if via is not null and via <> 'null' then c := c || jsonb_build_object('via', via::jsonb); end if;
    insert into public.issue_events (workspace_id, issue_id, actor_id, changes)
    values (new.workspace_id, new.id, private.actor_id(), c);
  end if;
  return null;
end $$;

-- ---------- GitHub ids for people who added GitHub later ----------

-- As in the functions file, plus: a profile without a GitHub id gets the one from the person's GitHub sign-in way
-- (auth.identities, which GitHub vouched for), unless another profile already has it. Pull requests find their
-- author by it.
create or replace function public.ensure_profile() returns setof public.profiles rows 1
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
  select case when i.provider_id ~ '^\d{1,18}$' then i.provider_id::bigint end,
         i.identity_data ->> 'user_name',
         coalesce(i.identity_data ->> 'full_name', i.identity_data ->> 'name', ''),
         coalesce(i.identity_data ->> 'avatar_url', '')
    into gid, glogin, gname, gavatar
    from auth.identities i where i.user_id = uid and i.provider = 'github' order by i.created_at limit 1;
  select * into p from public.profiles where user_id = uid;
  if found then
    if p.github_id is null and gid is not null and not exists (select 1 from public.profiles where github_id = gid) then
      begin
        update public.profiles set github_id = gid where id = p.id returning * into p;
      exception when unique_violation then
        null;                                       -- taken at the same moment: leave it
      end;
    end if;
    return next p;
    return;
  end if;
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
