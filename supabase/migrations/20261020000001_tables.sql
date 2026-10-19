-- Every table. Rules, functions, triggers and realtime come in the later files (docs/supabase-plan.md, section 2).
-- No column default calls a private.* function (work log P1): the author columns are filled by triggers instead
-- (20261020000005_triggers.sql), so this file only needs the tables themselves.
--
-- The lines marked "-- @list", "-- @range", "-- @regex" and "-- @default" must match src/model; tests/statusLists.test.ts
-- reads the line right after each marker.

create schema if not exists private;          -- helpers for rules and triggers; not exposed through the API
grant usage on schema private to authenticated;

-- ---------- workspaces and people ----------

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_by  uuid,                             -- foreign key added after profiles
  created_at  timestamptz not null default now(),
  changed_at  timestamptz not null default clock_timestamp(),
  extra       jsonb not null default '{}'
);

create table public.profiles (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references auth.users (id) on delete set null,  -- null: not signed up yet, or a guest
  login          text not null,
  github_id      bigint unique,                 -- matches GitHub sign-ins to people from an old workspace
  name           text not null default '',
  avatar_url     text not null default '',
  name_set_here  boolean not null default false,
  guest_of       uuid references public.workspaces (id) on delete cascade,  -- people from Linear who haven't joined
  linear_ids     text[] not null default '{}',
  created_at     timestamptz not null default now(),
  changed_at     timestamptz not null default clock_timestamp(),
  extra          jsonb not null default '{}',
  -- a real account never starts with "~"; a guest always does and has no account (P5)
  check (case when guest_of is null then login ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'
              else user_id is null and login ~ '^~[A-Za-z0-9][A-Za-z0-9-]{0,38}$' end)
);
-- logins are unique among people with accounts; guest logins only within their workspace (P5)
create unique index profiles_login on public.profiles (lower(login)) where guest_of is null;
create unique index profiles_guest_login on public.profiles (guest_of, lower(login)) where guest_of is not null;
create index profiles_guest_of on public.profiles (guest_of);

alter table public.workspaces
  add constraint workspaces_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;
create index workspaces_created_by on public.workspaces (created_by);

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at     timestamptz not null default now(),
  removed_at    timestamptz,                    -- left or removed: their name still shows on old work
  changed_at    timestamptz not null default clock_timestamp(),
  primary key (workspace_id, profile_id)
);
create index workspace_members_profile on public.workspace_members (profile_id, workspace_id);

create table public.invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  token         text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  for_login     text,                           -- who it's meant for, shown in the join wizard (optional)
  for_email     text,
  -- a person from Linear: accepting makes them you. "set null", so accepting (which removes the guest) keeps the invite
  for_profile   uuid references public.profiles (id) on delete set null,
  role          text not null default 'member' check (role in ('admin', 'member')),
  invited_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  accepted_by   uuid references public.profiles (id) on delete set null,
  accepted_at   timestamptz
);
create index invites_workspace on public.invites (workspace_id);
create index invites_for_profile on public.invites (for_profile);
create index invites_invited_by on public.invites (invited_by);
create index invites_accepted_by on public.invites (accepted_by);

-- ---------- teams, labels, projects ----------

create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  -- @regex team-key
  key           text not null check (key ~ '^[A-Z][A-Z0-9]{0,6}$'),
  name          text not null,
  emoji         text not null default '',
  last_number   integer not null default 0,     -- the highest number ever given out (see next_issue_number)
  -- @default auto-archive
  auto_archive  integer not null default 6 check (auto_archive >= 0),
  linear_id     text,
  created_at    timestamptz not null default now(),
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  unique (workspace_id, key),
  unique (workspace_id, id),
  unique (workspace_id, linear_id)
);
create index teams_changed on public.teams (workspace_id, changed_at);

create table public.team_members (
  workspace_id  uuid not null,
  team_id       uuid not null,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  changed_at    timestamptz not null default clock_timestamp(),
  primary key (team_id, profile_id),
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete cascade
);
create index team_members_changed on public.team_members (workspace_id, changed_at);
create index team_members_team on public.team_members (workspace_id, team_id);
create index team_members_profile on public.team_members (profile_id);

create table public.labels (
  id            text primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  color         text not null,
  linear_id     text,
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  unique (workspace_id, id),
  unique (workspace_id, linear_id)
);
create unique index labels_name on public.labels (workspace_id, lower(name));
create index labels_changed on public.labels (workspace_id, changed_at);

create table public.projects (
  id            text primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  emoji         text not null default '',
  description   text not null default '',
  status        text not null default 'planned'
                -- @list project-statuses
                check (status in ('backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled')),
  lead_id       uuid references public.profiles (id) on delete set null,
  target_date   date,
  linear_id     text,
  created_at    timestamptz not null default now(),
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  unique (workspace_id, id),
  unique (workspace_id, linear_id)
);
create index projects_changed on public.projects (workspace_id, changed_at);
create index projects_lead on public.projects (lead_id);

create table public.project_teams (
  workspace_id  uuid not null,
  project_id    text not null,
  team_id       uuid not null,
  changed_at    timestamptz not null default clock_timestamp(),
  primary key (project_id, team_id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade,
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete cascade
);
create index project_teams_changed on public.project_teams (workspace_id, changed_at);
create index project_teams_project on public.project_teams (workspace_id, project_id);
create index project_teams_team on public.project_teams (workspace_id, team_id);

-- ---------- issues ----------

create table public.issues (
  id            text primary key check (length(id) between 10 and 40),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  team_id       uuid not null,
  number        integer not null,               -- given out by a trigger (next_issue_number)
  title         text not null,
  description   text not null default '',       -- Markdown
  status        text not null default 'todo'
                -- @list issue-statuses
                check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate')),
  -- @range priorities
  priority      smallint not null default 0 check (priority between 0 and 4),
  assignee_id   uuid references public.profiles (id) on delete set null,
  project_id    text,
  parent_id     text,
  due_date      date,
  estimate      numeric check (estimate >= 0),
  sort_order    text collate "C" not null,
  duplicate_of  text,
  former_refs   text[] not null default '{}',   -- 'WEB-2' after a move to another team
  created_by    uuid references public.profiles (id) on delete set null,   -- set by a trigger
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  archived_at   timestamptz,
  archived_by   uuid references public.profiles (id) on delete set null,
  linear_id     text,
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  unique (workspace_id, id),
  unique (team_id, number),
  unique (workspace_id, linear_id),
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete cascade,
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete set null (project_id),
  foreign key (workspace_id, parent_id) references public.issues (workspace_id, id) on delete set null (parent_id),
  foreign key (workspace_id, duplicate_of) references public.issues (workspace_id, id) on delete set null (duplicate_of)
);
-- catching up reads archived rows too, so no "archived_at is null" here (P18)
create index issues_changed on public.issues (workspace_id, changed_at);
create index issues_team on public.issues (workspace_id, team_id);
create index issues_project on public.issues (workspace_id, project_id);
create index issues_parent on public.issues (workspace_id, parent_id);
create index issues_duplicate_of on public.issues (workspace_id, duplicate_of);
create index issues_assignee on public.issues (assignee_id);
create index issues_created_by on public.issues (created_by);
create index issues_archived_by on public.issues (archived_by);
create index issues_former_refs on public.issues using gin (former_refs);

create table public.issue_labels (
  workspace_id  uuid not null,
  issue_id      text not null,
  label_id      text not null,
  changed_at    timestamptz not null default clock_timestamp(),
  primary key (issue_id, label_id),
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade,
  foreign key (workspace_id, label_id) references public.labels (workspace_id, id) on delete cascade
);
create index issue_labels_changed on public.issue_labels (workspace_id, changed_at);
create index issue_labels_issue on public.issue_labels (workspace_id, issue_id);
create index issue_labels_label on public.issue_labels (workspace_id, label_id);

-- subscribers (following = true) and unsubscribed (following = false), as in the issue file today
create table public.issue_followers (
  workspace_id  uuid not null,
  issue_id      text not null,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  following     boolean not null,
  changed_at    timestamptz not null default clock_timestamp(),
  primary key (issue_id, profile_id),
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade
);
create index issue_followers_changed on public.issue_followers (workspace_id, changed_at);
create index issue_followers_issue on public.issue_followers (workspace_id, issue_id);
create index issue_followers_profile on public.issue_followers (profile_id);

create table public.comments (
  id            text primary key,
  workspace_id  uuid not null,
  issue_id      text not null,
  author_id     uuid references public.profiles (id) on delete set null,   -- set by a trigger
  body          text not null check (length(trim(body)) > 0),
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  linear_id     text,
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  unique (workspace_id, id),
  unique (workspace_id, linear_id),
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade
);
create index comments_changed on public.comments (workspace_id, changed_at);
create index comments_issue on public.comments (workspace_id, issue_id);
create index comments_author on public.comments (author_id);

-- ---------- views ----------

create table public.views (
  id            text primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  team_id       uuid,                           -- null: a workspace view
  owner_id      uuid references public.profiles (id) on delete set null,   -- set by a trigger
  name          text not null,
  emoji         text not null default '',
  description   text not null default '',
  filters       jsonb not null default '{}',    -- same shape as today (team keys, logins, label and project ids)
  display       jsonb not null,
  created_at    timestamptz not null default now(),
  linear_id     text,                           -- the Linear import keeps view ids too
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  unique (workspace_id, linear_id),
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete cascade
);
create index views_changed on public.views (workspace_id, changed_at);
create index views_team on public.views (workspace_id, team_id);
create index views_owner on public.views (owner_id);

-- ---------- your inbox ----------

create table public.inbox (
  id            text primary key,
  workspace_id  uuid not null,
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  actor_id      uuid references public.profiles (id) on delete set null,   -- set by a trigger
  -- @list inbox-types
  type          text not null check (type in ('assigned', 'mentioned', 'commented', 'status')),
  issue_id      text not null,
  comment_id    text,
  -- @list issue-statuses
  status        text check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate')),
  at            timestamptz not null default now(),
  read_at       timestamptz,                    -- read one by one
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade,
  -- a note can't point at a comment in another workspace
  foreign key (workspace_id, comment_id) references public.comments (workspace_id, id) on delete cascade
);
create index inbox_recipient on public.inbox (recipient_id, workspace_id, at desc);
create index inbox_issue on public.inbox (workspace_id, issue_id);
create index inbox_comment on public.inbox (workspace_id, comment_id);
create index inbox_actor on public.inbox (actor_id);

-- "Mark all as read" and anything else personal per workspace
create table public.read_state (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  read_until    timestamptz,
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  primary key (profile_id, workspace_id)
);
create index read_state_workspace on public.read_state (workspace_id);

-- ---------- history, used numbers and deletions ----------

create table public.issue_events (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null,
  issue_id      text not null,
  actor_id      uuid references public.profiles (id) on delete set null,
  at            timestamptz not null default now(),
  -- {"status": ["todo", "in_progress"], "assignee": [null, "<profile id>"], "description": true,
  --  "labels": {"added": ["01J…"]}, "team": ["WEB-2", "ENG-14"], "archived": true, "restored": true}
  changes       jsonb not null,
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade
);
create index issue_events_issue on public.issue_events (workspace_id, issue_id, id);
create index issue_events_actor on public.issue_events (actor_id);

-- every number a team ever gave out, so none is given out twice (filled by the number trigger, never emptied;
-- deleting or moving an issue leaves its number here)
create table public.issue_numbers (
  workspace_id  uuid not null,
  team_id       uuid not null,
  number        integer not null,
  primary key (team_id, number),
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete cascade
);
create index issue_numbers_team on public.issue_numbers (workspace_id, team_id);

-- the email a person from Linear had there, so an invite can find them; never sent to browsers
create table private.guest_emails (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  email       text not null
);

-- what was deleted, so a browser that reconnects can drop it too (kept 45 days)
create table public.deletions (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null,                  -- no foreign key: rows outlive what they describe
  table_name    text not null,
  row_key       jsonb not null,                 -- {"id": "…"} or {"issue_id": "…", "label_id": "…"}
  deleted_at    timestamptz not null default clock_timestamp()
);
create index deletions_workspace on public.deletions (workspace_id, deleted_at);
