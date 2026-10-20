-- Project statuses, and projects in an order of their own (docs/architecture.md, "Categories and statuses").
--
-- The project part of the workspace's own statuses (the shared part is 20261021140000_statuses.sql). Every project
-- keeps its fixed category in projects.status, exactly as before: the same values, check, default and grants, so
-- older apps and the import go on reading and writing it. What is new is projects.status_id, one of the workspace's
-- project statuses, kept in step with the category by private.follow_status('project'), and projects.sort_order, a
-- fractional index for the order within a board column. Projects made by an older app have no sort_order until
-- someone moves one next to them; they show after the others, by name.

-- the six statuses a workspace starts with, named and coloured as projects showed them before
insert into private.status_defaults (kind, category, name, color, position)
select 'project', d.category, d.name, d.color, 'a0' from (values
  -- @seed project-statuses
  ('backlog', 'Backlog', '#8a8f98'), ('planned', 'Planned', '#c4c6cc'), ('in_progress', 'In progress', '#f2c94c'), ('paused', 'Paused', '#8a8f98'), ('completed', 'Completed', '#5e6ad2'), ('canceled', 'Canceled', '#8a8f98')
) as d(category, name, color);

alter table public.projects add column status_id text;
-- the name ends in _status_id_fkey on purpose (src/backend/writes/problems.ts tells foreign keys apart by it); no
-- action, so deleting a workspace takes both tables
alter table public.projects add constraint projects_status_id_fkey
  foreign key (workspace_id, status_id) references public.statuses (workspace_id, id);
create index projects_status on public.projects (workspace_id, status_id);

-- byte order, like issues.sort_order (fractional-indexing compares keys that way)
alter table public.projects add column sort_order text collate "C";

-- Every workspace there is gets the six (new ones get them from the seed_statuses trigger, which seeds every kind in
-- private.status_defaults), every project the status of its own category, and an order: by name within the
-- workspace, so each column starts in the order the list showed. Quietly, as an import: no broadcast per row
-- (changed_at moves, so browsers read the projects again). The setting lasts until it is switched off below, whether
-- or not the file runs in one transaction.
select set_config('sprawniej.importing', 'on', false);
select private.seed_statuses(w.id, 'project') from public.workspaces w;
update public.projects p set status_id = s.id
  from public.statuses s
 where s.workspace_id = p.workspace_id and s.kind = 'project' and s.category = p.status;
-- Keys as fractional-indexing writes them: a head letter for the length of the whole part ('a' one digit, 'b' two,
-- 'c' three), then base-62 digits in byte order. The n-th project (from 0) gets: a0 … az for the first 62, then b10 …
-- bzz (n / 62 and n % 62), then c100 … (n / 3844, n / 62 % 62, n % 62).
with d as (select '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'::text as s),
     o as (select id, (row_number() over (partition by workspace_id order by lower(name), id) - 1)::integer as n
             from public.projects)
update public.projects p set sort_order = case
    when o.n < 62 then 'a' || substr(d.s, o.n + 1, 1)
    when o.n < 3844 then 'b' || substr(d.s, o.n / 62 + 1, 1) || substr(d.s, o.n % 62 + 1, 1)
    else 'c' || substr(d.s, o.n / 3844 % 62 + 1, 1) || substr(d.s, o.n / 62 % 62 + 1, 1) || substr(d.s, o.n % 62 + 1, 1)
  end
  from o, d
 where o.id = p.id;
select set_config('sprawniej.importing', 'off', false);
alter table public.projects alter column status_id set not null;

grant insert (status_id, sort_order), update (status_id, sort_order) on public.projects to authenticated;

-- the same trigger as on issues (and the same name, for one pattern); it sorts before a_stamp and c_people
create trigger a_category before insert or update of status, status_id on public.projects
  for each row execute function private.follow_status('project');

-- The import may send the status (a Linear status matched by name or kind) and the order of a new project. The order
-- is written only when the project is new, so a second import keeps the order people arranged here.
update private.import_spec
   set insert_cols = insert_cols || '{status_id,sort_order}',
       update_cols = update_cols || '{status_id}'
 where table_name = 'projects';
