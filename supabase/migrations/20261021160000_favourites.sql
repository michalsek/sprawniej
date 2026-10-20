-- Favourites: the projects and views someone starred, kept in their sidebar in their own order (docs/data-format.md).
--
-- Yours only: nobody else reads them, they come and go on your own channel (me:<profile>), and deleting one leaves no
-- note in deletions (that would tell every member what you unstarred). A browser that missed a delete compares keys
-- when it catches up instead. Deleting the project or view deletes the favourite with it.

-- favourites point at a view by workspace and id, as they do at a project
alter table public.views add constraint views_workspace_id_id_key unique (workspace_id, id);

create table public.favourites (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  -- @list favourite-kinds
  kind          text not null check (kind in ('project', 'view')),
  item_id       text not null,                  -- the project's or view's id
  sort_order    text collate "C" not null,      -- fractional index, like issues
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  -- the same id once more, in the column of its kind, so each kind has a real foreign key
  project_id    text generated always as (case when kind = 'project' then item_id end) stored,
  view_id       text generated always as (case when kind = 'view' then item_id end) stored,
  primary key (profile_id, item_id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade,
  foreign key (workspace_id, view_id) references public.views (workspace_id, id) on delete cascade
);
create index favourites_changed on public.favourites (workspace_id, changed_at);
create index favourites_project on public.favourites (workspace_id, project_id);
create index favourites_view on public.favourites (workspace_id, view_id);

insert into private.wiring (name, keys, ws_col, topic, topic_col, policies, stamp, forget) values
  ('favourites', '{profile_id,item_id}', 'workspace_id', 'me:', 'profile_id', null, 'touch', false);
call private.wire('favourites');

-- the kind, the item and the workspace never change: unstar and star again instead
grant insert (profile_id, workspace_id, kind, item_id, sort_order, extra) on public.favourites to authenticated;
grant update (sort_order, extra) on public.favourites to authenticated;
grant delete on public.favourites to authenticated;

-- one policy for everything, so none is checked twice: your own, and only while you are in the workspace
create policy "your favourites" on public.favourites for all to authenticated
  using (profile_id = (select private.my_profile_id()) and workspace_id in (select private.my_workspaces()))
  with check (profile_id = (select private.my_profile_id()) and workspace_id in (select private.my_workspaces()));
