-- Statuses a workspace sets itself (docs/architecture.md, "Categories and statuses").
--
-- Every issue keeps its fixed category in issues.status, exactly as before: the same values, check, default and
-- grants, so everything that reads it (completed_at, the nightly archive, github_apply, the import, older apps) goes on
-- working unchanged. What is new is the workspace's own statuses, a name and a colour within one category, in the
-- shared table public.statuses, and issues.status_id, which points at one. A trigger keeps the two in step both ways:
-- the new app sets status_id and the category follows; an older app, GitHub and the import set only status, and
-- status_id goes to that category's default status (the first shown one). Statuses are never deleted, only hidden,
-- and each category always keeps a shown one.
--
-- The table is shared with project statuses (kind = 'project'), which a later migration adds: it only inserts its
-- rows into private.status_defaults, seeds them, and adds its own column and trigger on projects.

-- ============================== shared: statuses of every kind ==============================

create table public.statuses (
  id            text primary key check (length(id) between 10 and 40),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  kind          text not null check (kind in ('issue', 'project')),
  category      text not null,
  name          text not null check (length(btrim(name)) between 1 and 40),
  color         text not null check (color ~ '^#[0-9a-f]{6}$'),
  position      text collate "C" not null,         -- a fractional index: the order within its category
  hidden        boolean not null default false,    -- not offered when picking; things that have it keep it
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  unique (workspace_id, id),
  constraint statuses_issue_category check (kind <> 'issue' or category in (
    -- @list issue-statuses
    'backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate')),
  constraint statuses_project_category check (kind <> 'project' or category in (
    -- @list project-statuses
    'backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled'))
);
-- issue and project statuses may share a name ("Backlog", "In Progress", "Canceled"); hidden ones count too
create unique index statuses_name on public.statuses (workspace_id, kind, lower(name));
create index statuses_changed on public.statuses (workspace_id, changed_at);
create index statuses_category on public.statuses (workspace_id, kind, category);

-- every member reads, adds and changes them (like labels); nobody deletes one: they are hidden instead
insert into private.wiring (name, keys, ws_col, topic, topic_col, policies, stamp, forget) values
  ('statuses',          '{id}',                      'workspace_id', 'ws:', 'workspace_id', 'members_no_delete', 'touch',         true);
call private.wire('statuses');

-- kind and category never change
grant insert (id, workspace_id, kind, category, name, color, position, hidden, extra) on public.statuses to authenticated;
grant update (name, color, position, hidden, extra) on public.statuses to authenticated;

-- ---------- what every workspace starts with ----------

-- the statuses a new workspace gets, per kind; private.seed_statuses() copies them
create table private.status_defaults (
  kind      text not null,
  category  text not null,
  name      text not null,
  color     text not null,
  position  text collate "C" not null,
  primary key (kind, category)
);
revoke all on private.status_defaults from public, anon, authenticated;

-- a workspace's default statuses of one kind (every kind when p_kind is null)
create function private.seed_statuses(p_ws uuid, p_kind text) returns void
language sql security definer set search_path = '' as $$
  insert into public.statuses (id, workspace_id, kind, category, name, color, position)
  select gen_random_uuid()::text, p_ws, d.kind, d.category, d.name, d.color, d.position
    from private.status_defaults d
   where d.kind = p_kind or p_kind is null;
$$;

-- every new workspace, also one an older app makes, starts with every kind's defaults
create function private.seed_new_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_statuses(new.id, null);
  return null;
end $$;

create trigger seed_statuses after insert on public.workspaces
  for each row execute function private.seed_new_workspace();

-- ---------- each category keeps a shown status ----------

-- Hiding a status (or adding a hidden one) must leave a shown one in its category. Two people hiding the last two at
-- once wait for each other on a lock per workspace, kind and category, and the second is refused: after the lock,
-- the check is a new statement and sees the first one's change.
create function private.keep_a_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.hidden then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('sprawniej.statuses:' || new.workspace_id || ':' || new.kind || ':' || new.category, 0));
  if not exists (select 1 from public.statuses s
                  where s.workspace_id = new.workspace_id and s.kind = new.kind and s.category = new.category
                    and not s.hidden) then
    raise exception 'Each group needs at least one status that isn''t hidden. Add or show another one first.'
      using errcode = '23514';
  end if;
  return null;
end $$;

create trigger c_keep_a_status after insert or update of hidden on public.statuses
  for each row execute function private.keep_a_status();

-- ---------- category and status in step ----------

-- the default status of a category: the first shown one (keep_a_status makes sure there is one)
create function private.default_status(p_ws uuid, p_kind text, p_category text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare s text;
begin
  select id into s from public.statuses
   where workspace_id = p_ws and kind = p_kind and category = p_category and not hidden
   order by position, id limit 1;
  if s is null then
    raise exception 'This workspace has no status for that.' using errcode = '22023';
  end if;
  return s;
end $$;

-- tg_argv[0]: the kind ('issue', 'project'). The new app sets status_id, and status (the category) follows. An older
-- app, GitHub and the import set only status, and status_id goes to that category's default. Both sent: status_id
-- wins. It runs during imports too, so an imported row gets its category's default.
create function private.follow_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if tg_op = 'UPDATE' and new.status_id is not distinct from old.status_id then
    if new.status is distinct from old.status then
      new.status_id := private.default_status(new.workspace_id, tg_argv[0], new.status);
    end if;
    return new;
  end if;
  if new.status_id is null then                    -- an insert without one (status has its column default by now)
    new.status_id := private.default_status(new.workspace_id, tg_argv[0], new.status);
    return new;
  end if;
  select s.category into c from public.statuses s
   where s.id = new.status_id and s.workspace_id = new.workspace_id and s.kind = tg_argv[0];
  if c is null then
    raise exception 'That status isn''t in this workspace.' using errcode = '22023';
  end if;
  new.status := c;
  return new;
end $$;

-- ============================== issues ==============================

insert into private.status_defaults (kind, category, name, color, position)
select 'issue', d.category, d.name, d.color, 'a0' from (values
  -- @seed issue-statuses
  ('backlog', 'Backlog', '#8a8f98'), ('todo', 'Todo', '#c4c6cc'), ('in_progress', 'In Progress', '#f2c94c'), ('in_review', 'In Review', '#4cb782'), ('done', 'Done', '#5e6ad2'), ('canceled', 'Canceled', '#8a8f98'), ('duplicate', 'Duplicate', '#8a8f98')
) as d(category, name, color);

alter table public.issues add column status_id text;
-- the name ends in _status_id_fkey on purpose (src/backend/writes/problems.ts tells foreign keys apart by it); no
-- action, so deleting a workspace takes both tables
alter table public.issues add constraint issues_status_id_fkey
  foreign key (workspace_id, status_id) references public.statuses (workspace_id, id);
create index issues_status on public.issues (workspace_id, status_id);

-- Every workspace there is gets the seven, and every issue the one of its own category. Quietly, as an import: no
-- history, no broadcast per row, the times stay (changed_at moves, so browsers read the issues again). The setting
-- lasts until it is switched off below, whether or not the file runs in one transaction.
select set_config('sprawniej.importing', 'on', false);
select private.seed_statuses(w.id, 'issue') from public.workspaces w;
update public.issues i set status_id = s.id
  from public.statuses s
 where s.workspace_id = i.workspace_id and s.kind = 'issue' and s.category = i.status;
select set_config('sprawniej.importing', 'off', false);
alter table public.issues alter column status_id set not null;

grant insert (status_id), update (status_id) on public.issues to authenticated;

-- "a_category" sorts before "a_stamp", so issue_times already sees the final category (completed_at, updated_at)
create trigger a_category before insert or update of status, status_id on public.issues
  for each row execute function private.follow_status('issue');

-- As in the triggers file, plus status_id: a move between two statuses of one category counts as a change
-- (updated_at), while completed_at still follows the category (Done to "Released", both done, keeps it).
create or replace function private.issue_times() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.changed_at := clock_timestamp();
  if tg_op = 'INSERT' then
    if new.created_by is null or not private.importing() then new.created_by := private.actor_id(); end if;
    if private.importing() then return new; end if;
    new.created_at := now();
    new.updated_at := now();
    new.completed_at := case when private.is_completed(new.status) then now() end;
    return new;
  end if;
  if private.importing() then return new; end if;
  -- updated_at is "last changed" as people see it; a restore counts, so tonight's job won't archive it again
  if (new.title, new.description, new.status, new.status_id, new.priority, new.assignee_id, new.project_id,
      new.parent_id, new.due_date, new.estimate, new.sort_order, new.duplicate_of, new.team_id, new.extra)
     is distinct from
     (old.title, old.description, old.status, old.status_id, old.priority, old.assignee_id, old.project_id,
      old.parent_id, old.due_date, old.estimate, old.sort_order, old.duplicate_of, old.team_id, old.extra)
     or (old.archived_at is not null and new.archived_at is null) then
    new.updated_at := now();
  end if;
  if new.status is distinct from old.status then
    new.completed_at := case when private.is_completed(new.status) then now() end;
  end if;
  if old.archived_at is null and new.archived_at is not null then
    new.archived_at := now();
    new.archived_by := private.actor_id();
  elsif new.archived_at is null then
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;              -- archived stays archived at the time it happened
  end if;
  return new;
end $$;

-- As in the GitHub file, plus "statusId": [old, new] when the status changed. "status" (the categories) is still
-- written only when the category changed, so older apps go on reading it; a move within one category writes only
-- "statusId".
create or replace function private.issue_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := '{}';
  via text := nullif(current_setting('sprawniej.via', true), '');
begin
  if private.importing() then return null; end if;
  if new.title       is distinct from old.title       then c := c || jsonb_build_object('title',    jsonb_build_array(old.title, new.title)); end if;
  if new.status      is distinct from old.status      then c := c || jsonb_build_object('status',   jsonb_build_array(old.status, new.status)); end if;
  if new.status_id   is distinct from old.status_id   then c := c || jsonb_build_object('statusId', jsonb_build_array(old.status_id, new.status_id)); end if;
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

-- ---------- inbox notes name the status ----------

-- No foreign key: a wrong id must never fail a batch of notes; b_status puts it right (or empties it) instead.
alter table public.inbox add column status_id text;
grant insert (status_id) on public.inbox to authenticated;

-- A status note says which status the issue went to. Sent with status_id (the new app): status becomes its category,
-- and an id that isn't one of this workspace's issue statuses is dropped. Sent with only status (an older app, or
-- github_apply, both after the move is saved): the issue's own status, when it is of that category.
create function private.note_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c text;
  s text;
begin
  if new.type <> 'status' then
    new.status_id := null;
    return new;
  end if;
  if new.status_id is not null then
    select x.category into c from public.statuses x
     where x.id = new.status_id and x.workspace_id = new.workspace_id and x.kind = 'issue';
    if c is null then new.status_id := null; else new.status := c; end if;
  end if;
  if new.status_id is null and new.status is not null then
    select i.status_id into s from public.issues i
     where i.id = new.issue_id and i.workspace_id = new.workspace_id and i.status = new.status;
    new.status_id := s;
  end if;
  return new;
end $$;

-- after a_author and a_stamp, before c_check_note (which compares status_id)
create trigger b_status before insert on public.inbox
  for each row execute function private.note_status();

-- As in the triggers file, except that the same note again means the same status too, so a move from Testing to
-- In Progress (one category) is still told.
create or replace function private.check_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.recipient_id = new.actor_id or not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = new.workspace_id and m.profile_id = new.recipient_id and m.removed_at is null) then
    return null;
  end if;
  if new.type <> 'commented' and new.comment_id is null and exists (
       select 1 from public.inbox n
        where n.recipient_id = new.recipient_id and n.actor_id = new.actor_id and n.issue_id = new.issue_id
          and n.type = new.type and n.status is not distinct from new.status
          and n.status_id is not distinct from new.status_id and n.comment_id is null
          and n.at > now() - interval '10 minutes') then
    return null;
  end if;
  return new;
end $$;
