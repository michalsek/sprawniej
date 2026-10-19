-- Small helpers that rules (policies) and triggers share, and the one list of shared tables (P22).
--
-- Three settings change what triggers do inside one transaction:
--   sprawniej.importing  'on' while import_rows, link_person or accept_invite write: no history, no per-row
--                        broadcasts, keep the times and numbers that came with the rows
--   sprawniej.trusted    'on' while accept_invite and leave_workspace change membership: skip the role guard
--   sprawniej.actor      a profile id that the service role, the SQL editor or a job acts for (no signed-in person)
-- They are safe only because no function the browser can call puts its input into set_config. Keep it that way.

-- Every function here is called by the policies or by triggers, never by the browser directly. Postgres gives new
-- functions to everyone (PUBLIC) by default, so each file that adds private functions takes that back at its end (P2).

-- One row per table: its keys, the column that says which workspace it belongs to, where its changes are broadcast,
-- which standard policies it gets, which trigger stamps it and whether deleting a row leaves a note in deletions.
-- 20261020000003_rls.sql, 20261020000005_triggers.sql and 20261020000006_realtime.sql loop over it, so a table can't
-- be forgotten (P22).
create table private.wiring (
  name       text primary key,
  keys       text[] not null,
  ws_col     text,
  topic      text,                               -- 'ws:' (the workspace), 'me:' (one person) or null (not broadcast)
  topic_col  text,
  policies   text check (policies in ('members', 'members_no_delete')),   -- null: written out in the rls file
  stamp      text,                               -- the trigger function that sets changed_at
  forget     boolean not null default false      -- write a deletions row when a row goes
);

insert into private.wiring (name, keys, ws_col, topic, topic_col, policies, stamp, forget) values
  ('workspaces',        '{id}',                      'id',           'ws:', 'id',           null,                'touch',         false),
  ('profiles',          '{id}',                      'guest_of',     'ws:', 'id',           null,                'touch',         true),
  ('workspace_members', '{workspace_id,profile_id}', 'workspace_id', 'ws:', 'workspace_id', null,                'touch',         true),
  ('invites',           '{id}',                      'workspace_id', null,  null,           null,                null,            false),  -- tokens stay with admins (P9)
  ('teams',             '{id}',                      'workspace_id', 'ws:', 'workspace_id', 'members_no_delete', 'touch',         true),
  ('team_members',      '{team_id,profile_id}',      'workspace_id', 'ws:', 'workspace_id', 'members',           'touch',         true),
  ('labels',            '{id}',                      'workspace_id', 'ws:', 'workspace_id', 'members',           'touch',         true),
  ('projects',          '{id}',                      'workspace_id', 'ws:', 'workspace_id', 'members',           'touch',         true),
  ('project_teams',     '{project_id,team_id}',      'workspace_id', 'ws:', 'workspace_id', 'members',           'touch',         true),
  ('issues',            '{id}',                      'workspace_id', 'ws:', 'workspace_id', 'members',           'issue_times',   true),
  ('issue_labels',      '{issue_id,label_id}',       'workspace_id', 'ws:', 'workspace_id', 'members',           'touch',         true),
  ('issue_followers',   '{issue_id,profile_id}',     'workspace_id', 'ws:', 'workspace_id', 'members',           'touch',         true),
  ('comments',          '{id}',                      'workspace_id', 'ws:', 'workspace_id', null,                'comment_times', true),
  ('views',             '{id}',                      'workspace_id', 'ws:', 'workspace_id', 'members',           'touch',         true),
  ('inbox',             '{id}',                      'workspace_id', 'me:', 'recipient_id', null,                'touch',         false),
  ('read_state',        '{profile_id,workspace_id}', 'workspace_id', 'me:', 'profile_id',   null,                'touch',         false),
  ('issue_events',      '{id}',                      'workspace_id', null,  null,           null,                null,            false),
  ('issue_numbers',     '{team_id,number}',          'workspace_id', null,  null,           null,                null,            false),
  ('deletions',         '{id}',                      'workspace_id', null,  null,           null,                null,            false);

-- ---------- who is asking ----------

-- the signed-in person's profile (null before they pick a name)
create function private.my_profile_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.user_id = (select auth.uid())
$$;

-- the workspaces they are in now (not the ones they left)
create function private.my_workspaces() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from public.workspace_members m
  where m.profile_id = (select private.my_profile_id()) and m.removed_at is null
$$;

create function private.my_admin_workspaces() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from public.workspace_members m
  where m.profile_id = (select private.my_profile_id()) and m.removed_at is null and m.role in ('owner', 'admin')
$$;

create function private.my_owner_workspaces() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from public.workspace_members m
  where m.profile_id = (select private.my_profile_id()) and m.removed_at is null and m.role = 'owner'
$$;

-- everyone who is (or was) in a workspace with them, and those workspaces' people from Linear
create function private.my_people() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.profile_id from public.workspace_members m where m.workspace_id in (select private.my_workspaces())
  union
  select g.id from public.profiles g where g.guest_of in (select private.my_workspaces())
$$;

create function private.importing() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('sprawniej.importing', true), '') = 'on'
$$;

-- the signed-in person; the service role, the SQL editor and jobs may say who they act for (sprawniej.actor)
create function private.actor_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return nullif(current_setting('sprawniej.actor', true), '')::uuid;
  end if;
  return private.my_profile_id();
end $$;

-- is this person in the workspace (now or before), or one of its people from Linear?
create function private.belongs(p uuid, ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.profile_id = p)
      or exists (select 1 from public.profiles g where g.id = p and g.guest_of = ws)
$$;

revoke all on all tables in schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
-- what the policies call, and nothing else
grant execute on function private.my_profile_id(), private.my_workspaces(), private.my_admin_workspaces(),
  private.my_owner_workspaces(), private.my_people() to authenticated;
