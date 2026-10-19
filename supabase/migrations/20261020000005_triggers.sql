-- Triggers: times, authors, issue numbers, history, deletions, inbox checks and owners (docs/supabase-plan.md,
-- section 4). Every trigger function runs as its owner, so the helpers it calls need no grant.
--
-- Postgres fires "before" triggers on the same event in the alphabetical order of their names. That is why they are
-- called a_*, b_*, c_*: authors and times first (a_), then the number (b_), then checks that need both (c_).
-- Keep this in later migrations.

-- ---------- times and authors ----------

-- changed_at on every write, whatever the browser sent (P6)
create function private.touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.changed_at := clock_timestamp();
  return new;
end $$;

-- issues: author, times and who archived. During imports, the times that came with the row stay (P13).
create function private.issue_times() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.changed_at := clock_timestamp();
  if tg_op = 'INSERT' then
    if new.created_by is null or not private.importing() then new.created_by := private.actor_id(); end if;
    if private.importing() then return new; end if;
    new.created_at := now();
    new.updated_at := now();
    new.completed_at := case when new.status in (
      -- @list completed-statuses
      'done'
    ) then now() end;
    return new;
  end if;
  if private.importing() then return new; end if;
  -- updated_at is "last changed" as people see it; a restore counts, so tonight's job won't archive it again
  if (new.title, new.description, new.status, new.priority, new.assignee_id, new.project_id, new.parent_id,
      new.due_date, new.estimate, new.sort_order, new.duplicate_of, new.team_id, new.extra)
     is distinct from
     (old.title, old.description, old.status, old.priority, old.assignee_id, old.project_id, old.parent_id,
      old.due_date, old.estimate, old.sort_order, old.duplicate_of, old.team_id, old.extra)
     or (old.archived_at is not null and new.archived_at is null) then
    new.updated_at := now();
  end if;
  if new.status is distinct from old.status then
    new.completed_at := case when new.status in (
      -- @list completed-statuses
      'done'
    ) then now() end;
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

-- comments: author and times; edited_at when the body changes. Imports keep theirs.
create function private.comment_times() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.changed_at := clock_timestamp();
  if tg_op = 'INSERT' then
    if new.author_id is null or not private.importing() then new.author_id := private.actor_id(); end if;
    if not private.importing() then
      new.created_at := now();
      new.edited_at := null;
    end if;
  elsif not private.importing() and new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end $$;

-- views (owner_id), inbox (actor_id), invites (invited_by): whoever is signed in. Imports may name someone else.
create function private.stamp_author() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new) ->> tg_argv[0]) is null or not private.importing() then
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], private.actor_id()));
  end if;
  return new;
end $$;

create trigger a_author before insert on public.views
  for each row execute function private.stamp_author('owner_id');
create trigger a_author before insert on public.inbox
  for each row execute function private.stamp_author('actor_id');
create trigger a_author before insert on public.invites
  for each row execute function private.stamp_author('invited_by');

-- ---------- issue numbers ----------

-- teams.last_number counts every number ever given out; taking the next one locks the team's row, so two people
-- creating issues at the same moment get different numbers. issue_numbers makes sure a number is never given twice.
-- Imports keep their numbers and move the counter past them; an upsert of an existing issue keeps its number (P3).
create function private.next_issue_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.importing() then
    if exists (select 1 from public.issues i where i.id = new.id) then return new; end if;
    if new.number is not null then
      update public.teams set last_number = greatest(last_number, new.number)
       where id = new.team_id and workspace_id = new.workspace_id;
      if not found then raise exception 'There is no such team.' using errcode = '23503'; end if;
      insert into public.issue_numbers (workspace_id, team_id, number) values (new.workspace_id, new.team_id, new.number);
      return new;
    end if;
  end if;
  update public.teams set last_number = last_number + 1
   where id = new.team_id and workspace_id = new.workspace_id
  returning last_number into new.number;
  if not found then raise exception 'There is no such team.' using errcode = '23503'; end if;
  insert into public.issue_numbers (workspace_id, team_id, number) values (new.workspace_id, new.team_id, new.number);
  return new;
exception when unique_violation then
  raise exception 'Number % is already used in this team.', new.number using errcode = '23505';
end $$;

create trigger b_number before insert on public.issues
  for each row execute function private.next_issue_number();

-- ---------- history ----------

-- One event per change of an issue, with every field that changed. Creating an issue writes none (its own fields say
-- when and who). Imports write none.
create function private.issue_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c jsonb := '{}';
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
    insert into public.issue_events (workspace_id, issue_id, actor_id, changes)
    values (new.workspace_id, new.id, private.actor_id(), c);
  end if;
  return null;
end $$;

create trigger history after update on public.issues
  for each row execute function private.issue_history();

-- Labels added and removed. Nothing when the issue or the label itself is going: the delete cascades here, and an
-- event for a vanished issue would fail its foreign key.
create function private.label_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.issue_labels;
begin
  if private.importing() then return null; end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.issues where id = old.issue_id)
       or not exists (select 1 from public.labels where id = old.label_id) then
      return null;
    end if;
    r := old;
  else
    r := new;
  end if;
  insert into public.issue_events (workspace_id, issue_id, actor_id, changes)
  values (r.workspace_id, r.issue_id, private.actor_id(),
          jsonb_build_object('labels', jsonb_build_object(case when tg_op = 'INSERT' then 'added' else 'removed' end,
                                                          jsonb_build_array(r.label_id))));
  return null;
end $$;

create trigger history after insert or delete on public.issue_labels
  for each row execute function private.label_history();

-- ---------- deletions ----------

-- A note per deleted row, so a browser that reconnects drops it too. Cascades count: deleting a team leaves a note
-- for each issue, comment and view that went with it. The first argument is the workspace column, the rest are the
-- keys (P16). Nothing when the whole workspace is going: nobody could read the notes, and members learn about it
-- from the workspace's own delete message.
create function private.remember_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(old);
  ws uuid := (r ->> tg_argv[0])::uuid;
begin
  if ws is null or not exists (select 1 from public.workspaces w where w.id = ws) then return null; end if;
  insert into public.deletions (workspace_id, table_name, row_key)
  select ws, tg_table_name, jsonb_object_agg(k, r -> k) from unnest(tg_argv[1:]) k;
  return null;
end $$;

-- ---------- inbox ----------

-- Notes only go to members of the workspace (not people from Linear, not people who left, not yourself), quietly,
-- so one wrong recipient doesn't fail the rest (P12). And the same note about the same issue isn't sent again within
-- ten minutes (comments always are).
create function private.check_note() returns trigger
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
          and n.type = new.type and n.status is not distinct from new.status and n.comment_id is null
          and n.at > now() - interval '10 minutes') then
    return null;
  end if;
  return new;
end $$;

create trigger c_check_note before insert on public.inbox
  for each row execute function private.check_note();

-- ---------- members and owners (P7) ----------

-- Only an owner makes or unmakes owners or removes one; nobody but an owner changes their own role.
-- accept_invite and leave_workspace turn sprawniej.trusted on; jobs and the SQL editor have no signed-in person.
create function private.guard_members() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_profile_id();
  my_role text;
begin
  if (select auth.uid()) is null or current_setting('sprawniej.trusted', true) = 'on' then return new; end if;
  select m.role into my_role from public.workspace_members m
   where m.workspace_id = new.workspace_id and m.profile_id = me and m.removed_at is null;
  if (new.role is distinct from old.role and 'owner' in (old.role, new.role))
     or (old.role = 'owner' and old.removed_at is null and new.removed_at is not null) then
    if my_role is distinct from 'owner' then
      raise exception 'Only an owner can change who owns the workspace.' using errcode = '42501';
    end if;
  end if;
  if new.profile_id = me and new.role is distinct from old.role and my_role is distinct from 'owner' then
    raise exception 'You can''t change your own role.' using errcode = '42501';
  end if;
  if old.removed_at is null and new.removed_at is not null then new.removed_at := now(); end if;
  return new;
end $$;

create trigger a_guard before update on public.workspace_members
  for each row execute function private.guard_members();

-- Every workspace keeps at least one owner (unless the whole workspace is going).
create function private.keep_an_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then return null; end if;
  if old.role = 'owner' and old.removed_at is null and not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = old.workspace_id and m.role = 'owner' and m.removed_at is null) then
    raise exception 'A workspace needs at least one owner. Make someone else an owner first.' using errcode = '23514';
  end if;
  return null;
end $$;

create trigger keep_an_owner after update or delete on public.workspace_members
  for each row execute function private.keep_an_owner();

-- ---------- the same triggers on every table (P22) ----------

do $$
declare w record;
begin
  for w in select * from private.wiring loop
    if w.stamp is not null then
      execute format('create trigger a_stamp before insert or update on public.%I '
                     'for each row execute function private.%I()', w.name, w.stamp);
    end if;
    if w.forget then
      execute format('create trigger forget after delete on public.%I '
                     'for each row execute function private.remember_deletion(%s)',
                     w.name, (select string_agg(quote_literal(x), ', ') from unnest(array[w.ws_col] || w.keys) x));
    end if;
  end loop;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_profile_id(), private.my_workspaces(), private.my_admin_workspaces(),
  private.my_owner_workspaces(), private.my_people() to authenticated;
