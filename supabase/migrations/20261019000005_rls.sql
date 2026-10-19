-- Who sees and changes what (docs/supabase-plan.md, section 3).
-- The rule for almost everything: you see and change a workspace's rows if you are a member of it.
--
-- Do not "force row level security": the tables belong to postgres, and that is what lets the security definer
-- functions write history, used numbers and deletions.

-- Every table in private.wiring: rules on, read for signed-in people, the standard member policies, the changed_at
-- stamp, deletion notes and broadcasts (private.wire, in the helpers file). It comes first because it starts by taking
-- every right away; the column grants below give back what people may write.
do $$
declare w record;
begin
  for w in select name from private.wiring order by name loop
    call private.wire(w.name);
  end loop;
end $$;

-- ---------- columns people may write ----------
-- Anything not listed is set by the database: changed_at everywhere, numbers, authors, linear_id (only imports
-- write it), times (P6).

-- workspaces: made by create_workspace()
grant update (name, extra) on public.workspaces to authenticated;
grant delete on public.workspaces to authenticated;

-- profiles: made by ensure_profile() and create_profile(); a login is picked once
grant update (name, avatar_url, name_set_here, extra) on public.profiles to authenticated;

-- workspace_members: joining is accept_invite(), leaving is leave_workspace()
grant update (role, removed_at) on public.workspace_members to authenticated;

grant insert (workspace_id, for_login, for_email, for_profile, role, expires_at) on public.invites to authenticated;
grant update (for_login, for_email, role, expires_at) on public.invites to authenticated;
grant delete on public.invites to authenticated;

grant insert (id, workspace_id, key, name, emoji, auto_archive, extra) on public.teams to authenticated;
grant update (name, emoji, auto_archive, extra) on public.teams to authenticated;    -- not key, not last_number
grant delete on public.teams to authenticated;                                       -- admins only, see below

grant insert (workspace_id, team_id, profile_id) on public.team_members to authenticated;

grant insert (id, workspace_id, name, color, extra) on public.labels to authenticated;
grant update (name, color, extra) on public.labels to authenticated;

grant insert (id, workspace_id, name, emoji, description, status, lead_id, target_date, extra) on public.projects to authenticated;
grant update (name, emoji, description, status, lead_id, target_date, extra) on public.projects to authenticated;

grant insert (workspace_id, project_id, team_id) on public.project_teams to authenticated;

-- a move to another team goes through move_issue_to_team()
grant insert (id, workspace_id, team_id, title, description, status, priority, assignee_id, project_id, parent_id,
              due_date, estimate, sort_order, duplicate_of, extra) on public.issues to authenticated;
grant update (title, description, status, priority, assignee_id, project_id, parent_id, due_date, estimate,
              sort_order, duplicate_of, archived_at, extra) on public.issues to authenticated;

grant insert (workspace_id, issue_id, label_id) on public.issue_labels to authenticated;

grant insert (workspace_id, issue_id, profile_id, following) on public.issue_followers to authenticated;
grant update (following) on public.issue_followers to authenticated;

grant insert (id, workspace_id, issue_id, body, extra) on public.comments to authenticated;
grant update (body, extra) on public.comments to authenticated;                      -- edited_at is set by a trigger
grant delete on public.comments to authenticated;

grant insert (id, workspace_id, team_id, name, emoji, description, filters, display, extra) on public.views to authenticated;
grant update (name, emoji, description, filters, display, extra) on public.views to authenticated;

grant insert (id, workspace_id, recipient_id, type, issue_id, comment_id, status, extra) on public.inbox to authenticated;
grant update (read_at) on public.inbox to authenticated;
grant delete on public.inbox to authenticated;

-- every column, so an upsert works; the policy pins whose row it is
grant insert (profile_id, workspace_id, read_until, extra) on public.read_state to authenticated;
grant update (profile_id, workspace_id, read_until, extra) on public.read_state to authenticated;

-- issue_events, issue_numbers and deletions: read only, written by triggers

-- ---------- the policies that differ ----------
-- At most one permissive policy per table and action, so none of them is checked twice.

-- teams: every member adds and changes them, only admins and owners delete them
create policy "admins delete teams" on public.teams for delete to authenticated
  using (workspace_id in (select private.my_admin_workspaces()));

-- comments: everyone in the workspace reads and adds; only the author edits or deletes, while still a member (P11)
create policy "members read comments" on public.comments for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
create policy "members comment" on public.comments for insert to authenticated
  with check (workspace_id in (select private.my_workspaces()) and author_id = (select private.my_profile_id()));
create policy "authors edit" on public.comments for update to authenticated
  using (author_id = (select private.my_profile_id()) and workspace_id in (select private.my_workspaces()))
  with check (author_id = (select private.my_profile_id()) and workspace_id in (select private.my_workspaces()));
create policy "authors delete" on public.comments for delete to authenticated
  using (author_id = (select private.my_profile_id()) and workspace_id in (select private.my_workspaces()));

-- inbox: written by whoever caused the note; a trigger quietly drops notes for people outside the workspace (P12)
create policy "read your notes" on public.inbox for select to authenticated
  using (recipient_id = (select private.my_profile_id()));
create policy "mark your notes" on public.inbox for update to authenticated
  using (recipient_id = (select private.my_profile_id()))
  with check (recipient_id = (select private.my_profile_id()));
create policy "delete your notes" on public.inbox for delete to authenticated
  using (recipient_id = (select private.my_profile_id()));
create policy "notes from you" on public.inbox for insert to authenticated
  with check (actor_id = (select private.my_profile_id()) and workspace_id in (select private.my_workspaces()));

create policy "your read marks" on public.read_state for all to authenticated
  using (profile_id = (select private.my_profile_id()))
  with check (profile_id = (select private.my_profile_id()) and workspace_id in (select private.my_workspaces()));

-- history, used numbers and deletions: members read, only triggers write
create policy "members read history" on public.issue_events for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
create policy "members read deletions" on public.deletions for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
create policy "members read used numbers" on public.issue_numbers for select to authenticated
  using (workspace_id in (select private.my_workspaces()));

-- workspaces: creating one goes through create_workspace(), which also makes you its owner
create policy "members see it" on public.workspaces for select to authenticated
  using (id in (select private.my_workspaces()));
create policy "admins rename it" on public.workspaces for update to authenticated
  using (id in (select private.my_admin_workspaces()))
  with check (id in (select private.my_admin_workspaces()));
create policy "owners delete it" on public.workspaces for delete to authenticated
  using (id in (select private.my_owner_workspaces()));

-- members: admins change roles and remove people; a trigger keeps owners in charge of owners (P7)
create policy "members see who is in" on public.workspace_members for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
create policy "admins change roles" on public.workspace_members for update to authenticated
  using (workspace_id in (select private.my_admin_workspaces()))
  with check (workspace_id in (select private.my_admin_workspaces()));

-- invites: only admins and owners see them (they hold the tokens); one for a person from Linear must name a person
-- from this workspace
create policy "admins manage invites" on public.invites for all to authenticated
  using (workspace_id in (select private.my_admin_workspaces()))
  with check (workspace_id in (select private.my_admin_workspaces())
              and (for_profile is null
                   or for_profile in (select g.id from public.profiles g where g.guest_of = invites.workspace_id)));

-- profiles: you, everyone who shares (or shared) a workspace with you, and its people from Linear
create policy "people you work with" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or id in (select private.my_people()));
create policy "your own profile" on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
