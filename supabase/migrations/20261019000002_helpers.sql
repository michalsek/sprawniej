-- Small helpers that rules (policies) and triggers share, the one list of shared tables (P22) and the procedure that
-- wires a table up from that list.
--
-- Three settings change what triggers do inside one transaction:
--   sprawniej.importing  'on' while import_rows or move_person write: no history, no per-row broadcasts, keep the
--                        times and numbers that came with the rows
--   sprawniej.trusted    'on' while accept_invite and leave_workspace change membership: skip the role guard
--   sprawniej.actor      a profile id that the service role, the SQL editor or a job acts for (no signed-in person)
-- They are safe only because no function the browser can call puts its input into set_config. Keep it that way.

-- ---------- nobody runs a new function unless it says so (P2) ----------
-- Postgres lets everyone run a new function, and Supabase lets anon and authenticated run new functions in public.
-- From here on, functions made by postgres are closed by default; each one that the app or a policy calls is granted
-- by name.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- ---------- the shared tables ----------

-- One row per table: its keys, the column that says which workspace it belongs to, where its changes are broadcast,
-- which standard policies it gets, which trigger stamps it and whether deleting a row leaves a note in deletions.
-- private.wire() reads it, and import_rows takes the workspace column and keys from it.
-- A new table: insert its row here in a migration, then "call private.wire('the_table');".
create table private.wiring (
  name       text primary key,
  keys       text[] not null,
  ws_col     text,
  topic      text,                               -- 'ws:' (the workspace), 'me:' (one person) or null (not broadcast)
  topic_col  text,                               -- the column that completes the topic
  policies   text check (policies in ('members', 'members_no_delete')),   -- null: written out in the rls file
  stamp      text,                               -- the trigger function that sets changed_at
  forget     boolean not null default false      -- write a deletions row when a row goes
);

-- profiles have no topic column: broadcast() sends a person's changes to every workspace they are in
insert into private.wiring (name, keys, ws_col, topic, topic_col, policies, stamp, forget) values
  ('workspaces',        '{id}',                      'id',           'ws:', 'id',           null,                'touch',         false),
  ('profiles',          '{id}',                      'guest_of',     'ws:', null,           null,                'touch',         true),
  ('workspace_members', '{workspace_id,profile_id}', 'workspace_id', 'ws:', 'workspace_id', null,                'touch',         true),
  ('invites',           '{id}',                      'workspace_id', null,  null,           null,                null,            false),
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
-- invites have no topic on purpose: their tokens stay with admins (P9)

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

-- what the policies call, and nothing else
grant execute on function private.my_profile_id(), private.my_workspaces(), private.my_admin_workspaces(),
  private.my_owner_workspaces(), private.my_people() to authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- ---------- wiring a table up ----------

-- Everything a table in private.wiring gets: rules on, nothing for people who aren't signed in, read for signed-in
-- people (the policies narrow it), the four standard member policies where the list says so, the changed_at stamp,
-- the deletion note and the realtime broadcast. The trigger functions it names are in the triggers and realtime
-- files, so it is called once they exist (20261019000005_rls.sql). Column grants and other policies come after it,
-- because it starts by taking everything away.
create procedure private.wire(t text)
language plpgsql set search_path = '' as $$
declare w private.wiring;
begin
  select * into w from private.wiring where name = t;
  if not found then raise exception 'private.wiring has no row for %.', t using errcode = '22023'; end if;
  execute format('alter table public.%I enable row level security', w.name);
  execute format('revoke all on public.%I from anon, authenticated', w.name);   -- also drops truncate, trigger, references
  execute format('grant select on public.%I to authenticated', w.name);
  if w.policies is not null then
    execute format('create policy "members read" on public.%I for select to authenticated '
                   'using (workspace_id in (select private.my_workspaces()))', w.name);
    execute format('create policy "members add" on public.%I for insert to authenticated '
                   'with check (workspace_id in (select private.my_workspaces()))', w.name);
    execute format('create policy "members change" on public.%I for update to authenticated '
                   'using (workspace_id in (select private.my_workspaces())) '
                   'with check (workspace_id in (select private.my_workspaces()))', w.name);
    if w.policies = 'members' then
      execute format('create policy "members delete" on public.%I for delete to authenticated '
                     'using (workspace_id in (select private.my_workspaces()))', w.name);
      execute format('grant delete on public.%I to authenticated', w.name);
    end if;
  end if;
  if w.stamp is not null then
    execute format('create trigger a_stamp before insert or update on public.%I '
                   'for each row execute function private.%I()', w.name, w.stamp);
  end if;
  if w.forget then
    execute format('create trigger forget after delete on public.%I '
                   'for each row execute function private.remember_deletion(%s)',
                   w.name, (select string_agg(quote_literal(x), ', ') from unnest(array[w.ws_col] || w.keys) x));
  end if;
  if w.topic is not null then
    execute format('create trigger live after insert or update or delete on public.%I '
                   'for each row execute function private.broadcast(%s)',
                   w.name, (select string_agg(quote_literal(x), ', ')
                              from unnest(array[w.topic, coalesce(w.topic_col, '')] || w.keys) x));
  end if;
end $$;
