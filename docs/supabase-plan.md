# Moving Sprawniej to Supabase: design and plan

Status: **draft for review**. Nothing here has been applied to the database yet.

Today a workspace is a GitHub repo of small files, the browser keeps a copy, saves by committing, checks for news every
30 seconds and merges other people's changes itself (docs/architecture.md). This plan replaces that with a Supabase
project: relational tables with row-level security, realtime updates instead of polling, per-field saves instead of
client-side merging, and normal sign-in (GitHub, Google, email and password). There is no offline mode: Sprawniej is a
tool for working together, so it needs the server to save.

What stays the same for people: issues, teams, projects, views, the inbox, statuses and priorities, drag-n-drop,
issue numbers (`ENG-12`), links and mentions. What changes: how you sign in, how you invite people, and the GitHub key
goes away.

**Decided so far** (2026-10-19):

- The `sprawniej-test` organization is the home for this first run: a copy of the tasks from a real project, to prove
  everything works. So **the whole setup must be easy to repeat** in another Supabase account or project: everything
  lives in the repo and one runbook sets up a fresh project (section 1).
- The first team is **6 to 8 people**, for triage. That is far inside the free tier (section 9).
- **No email sender and no domain for now.** The first days run from localhost, by one person, to check that
  everything behaves. Sign-in starts with GitHub and email and password; Google, our own email sender and a public
  address come before teammates join (section 6, section 11).
- **The tasks come from Linear.** The existing Linear import moves onto rows first (section 8); importing an old
  Sprawniej workspace from GitHub isn't needed for this run and comes later, only if someone needs it.

## Contents

1. [The Supabase project](#1-the-supabase-project)
2. [Tables](#2-tables)
3. [Row-level security](#3-row-level-security)
4. [Database functions and triggers](#4-database-functions-and-triggers)
5. [Realtime](#5-realtime)
6. [Signing in](#6-signing-in)
7. [The code: what goes, what changes, src/backend](#7-the-code)
8. [Imports: Linear first](#8-imports-linear-first)
9. [Staying on the free tier](#9-staying-on-the-free-tier)
10. [CLAUDE.md changes and why this is 2.0.0](#10-claudemd-changes-and-why-this-is-200)
11. [Step-by-step plan](#11-step-by-step-plan)
12. [Open questions](#12-open-questions)

## 1. The Supabase project

The project for this run, found with the `supabase-sprawniej` MCP server (the company account):

| | |
| --- | --- |
| Organization | `sprawniej-test` (id `zdhjqeygsjfjhivenqvz`) |
| Project | `sprawniejapp`, ref `wkqofiacqfuxowavuqxj` |
| Region | `eu-west-1` |
| Postgres | 17 |
| State | healthy, `public` schema empty, storage has no buckets |
| Extensions on | `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault` (`pg_cron` is available, not on yet) |

### Any project, from the repo alone

Nothing in the app or the SQL names this project. Moving to another account, making a second project for tests, or
starting over is the same short runbook, kept as `docs/supabase-setup.md` (written in step 1 of the plan):

```
supabase/
  config.toml        auth and API settings as code; secrets only as env(...)
  migrations/        every table, rule, function, trigger, the pictures bucket, the realtime rule, pg_cron jobs
  tests/             pgTAP tests for the rules and triggers
  seed.sql           a small test workspace, for the local stack only
  templates/         email templates (when we have a sender)
  .env.example       the names of the secrets config.toml reads (never the values)
```

1. Create a project in the Supabase dashboard (any account, any region). Write down its ref.
2. `supabase login`, then `supabase link --project-ref <ref>`.
3. `supabase db push`: the whole schema, including the bucket, the realtime rule and the nightly jobs, because all of
   them are plain SQL in `migrations/` (nothing is clicked together in the dashboard).
4. Make a GitHub OAuth app for this project (its callback is `https://<ref>.supabase.co/auth/v1/callback`; GitHub
   allows one callback per app, so each project gets its own app). Put its id and secret in your shell, then
   `supabase config push`: sign-in providers, redirect URLs, identity linking and password rules come from
   `config.toml`.
5. Put the project's URL and publishable key in `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`) and run the app.
6. Sign in, create the workspace, import (section 8).

The same files drive the local stack: `supabase start` and `supabase db reset` rebuild everything from scratch, which is
also the proof that the runbook works. Step 10 of the plan repeats the runbook on a second, throwaway project.

Rules that keep it repeatable:

- **Every change to the database is a migration in the repo.** No edits in the dashboard or the SQL editor; if one
  happens by accident, `supabase db pull` turns it into a migration.
- **Every setting is in `config.toml`** (`supabase config push`), with secrets read from the environment.
- **No project ref, URL or key in the code**; the app reads them at build time.
- Seed data is only for the local stack (`db push` doesn't send it).

The MCP server (`apply_migration`) is fine for looking around and for emergencies; normal changes go through the
CLI so that the files in the repo stay the truth. Database branches cost money, so the local stack is where we try
things. Types for the client come from `supabase gen types typescript` into `src/backend/database.types.ts`.

## 2. Tables

### Choices behind the tables

- **Ids.** Issues, comments, labels, projects, views and inbox notes keep their **ULIDs** as `text` primary keys. The
  browser makes the id, so a new issue or comment shows at once and the importer keeps every id, which keeps links,
  mentions, `parent`, `duplicateOf` and view filters working. Workspaces, teams and profiles get `uuid`s (new things,
  never referenced by old files). A team is still found by its `key`, unique per workspace.
- **People are `profiles`.** Every reference to a person is a `uuid` pointing at `profiles.id`. Each profile has a
  unique `login` handle, which is what the app, mentions (`@ania-k`) and view filters keep using. The code in
  `src/backend` turns ids into logins when reading and back when writing, so the store, selectors, `notify.ts` and the
  screens keep working with logins. People from Linear who haven't joined (`~jan`) are profiles too, with no account
  behind them.
- **Things two people change at once are rows, not lists.** Labels on an issue, team members, followers and a project's
  teams are join tables. Adding a label is an insert, removing one is a delete, so two people's changes both stay
  without any merge code. This replaces the set-merging in `src/sync/merge.ts`.
- **Every write sends only the columns that changed**, so the later save wins per field, exactly the merge rule we have
  today, without the merging.
- **Unknown fields survive.** Every main table has `extra jsonb not null default '{}'`. Fields the model doesn't know
  go there and come back on read (the `.passthrough()` promise). A later version that adds a real column moves the
  value out of `extra` in its migration. Older apps never overwrite columns they don't know, because they only send the
  columns they changed.
- **`workspace_id` on every row**, even join tables. It keeps the security rules simple and fast, and it is the
  realtime topic. Composite foreign keys (`(workspace_id, issue_id)`) make it impossible to point at a row in another
  workspace.
- **Two times per row.** `updated_at` is "last changed" as people see it (following an issue doesn't change it).
  `changed_at` is set by the database on every write with `clock_timestamp()`; it is what catching up after a
  reconnect uses (section 5).
- **Statuses and priorities** are `text`/`smallint` with `check` constraints copied from `src/model/status.ts`, not
  Postgres enums (they stay fixed, and checks are easier to change in a migration if they ever must).
- **`sort_order` uses `collate "C"`**, so the database sorts fractional-index keys byte by byte, the same way the app
  compares them.
- **The archive is a column.** Archived issues stay in `issues` with `archived_at` set. The packed month files,
  `tidyArchive`'s batching and `mendArchive` all go away. Opening the app loads only `archived_at is null`; the
  Archived tab, search and links load archived rows when asked.
- **Deleting is real deleting**, with a small `deletions` table (filled by a trigger) so a reconnecting browser learns
  what went away.

### SQL

This is the first migration, in the order it would run. Functions referenced here (`private.*`) are in section 4;
in the real migration they come first.

```sql
-- supabase/migrations/20261020000000_workspaces.sql

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
  login          text not null check (login ~ '^~?[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  github_id      bigint unique,                 -- matches GitHub sign-ins to people from the old workspace
  name           text not null default '',
  avatar_url     text not null default '',
  name_set_here  boolean not null default false,
  guest_of       uuid references public.workspaces (id) on delete cascade,  -- set for people from Linear who haven't joined
  linear_ids     text[] not null default '{}',
  created_at     timestamptz not null default now(),
  changed_at     timestamptz not null default clock_timestamp(),
  extra          jsonb not null default '{}',
  check (guest_of is null or (user_id is null and login like '~%'))
);
create unique index profiles_login on public.profiles (lower(login));

alter table public.workspaces
  add foreign key (created_by) references public.profiles (id) on delete set null;

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at     timestamptz not null default now(),
  removed_at    timestamptz,                    -- left or removed: their name still shows on old work
  changed_at    timestamptz not null default clock_timestamp(),
  primary key (workspace_id, profile_id)
);
create index on public.workspace_members (profile_id) where removed_at is null;

create table public.invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  token         text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  for_login     text,                           -- who it's meant for, shown in the wizard (optional)
  for_email     text,
  for_profile   uuid references public.profiles (id) on delete cascade,  -- a person from Linear: accepting makes them you
  role          text not null default 'member' check (role in ('admin', 'member')),
  invited_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  accepted_by   uuid references public.profiles (id) on delete set null,
  accepted_at   timestamptz
);

-- ---------- teams, labels, projects ----------

create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  key           text not null check (key ~ '^[A-Z][A-Z0-9]{0,6}$'),
  name          text not null,
  emoji         text not null default '',
  last_number   integer not null default 0,     -- the highest number ever given out (see next_issue_number)
  auto_archive  integer not null default 6 check (auto_archive >= 0),
  linear_id     text,
  created_at    timestamptz not null default now(),
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  unique (workspace_id, key),
  unique (workspace_id, id),
  unique (workspace_id, linear_id)
);

create table public.team_members (
  workspace_id  uuid not null,
  team_id       uuid not null,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  changed_at    timestamptz not null default clock_timestamp(),
  primary key (team_id, profile_id),
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete cascade
);

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

create table public.projects (
  id            text primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  emoji         text not null default '',
  description   text not null default '',
  status        text not null default 'planned'
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

create table public.project_teams (
  workspace_id  uuid not null,
  project_id    text not null,
  team_id       uuid not null,
  changed_at    timestamptz not null default clock_timestamp(),
  primary key (project_id, team_id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade,
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete cascade
);

-- ---------- issues ----------

create table public.issues (
  id            text primary key check (length(id) between 10 and 40),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  team_id       uuid not null,
  number        integer not null,               -- given out by a trigger (section 4)
  title         text not null,
  description   text not null default '',       -- Markdown
  status        text not null default 'todo'
                check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate')),
  priority      smallint not null default 0 check (priority between 0 and 4),
  assignee_id   uuid references public.profiles (id) on delete set null,
  project_id    text,
  parent_id     text,
  due_date      date,
  estimate      numeric check (estimate >= 0),
  sort_order    text collate "C" not null,
  duplicate_of  text,
  former_refs   text[] not null default '{}',   -- 'WEB-2' after a move to another team
  created_by    uuid default private.my_profile_id() references public.profiles (id) on delete set null,
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
create index issues_open on public.issues (workspace_id, changed_at) where archived_at is null;
create index issues_archived on public.issues (workspace_id, team_id) where archived_at is not null;
create index issues_former_refs on public.issues using gin (former_refs);
create index on public.issues (parent_id);

create table public.issue_labels (
  workspace_id  uuid not null,
  issue_id      text not null,
  label_id      text not null,
  changed_at    timestamptz not null default clock_timestamp(),
  primary key (issue_id, label_id),
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade,
  foreign key (workspace_id, label_id) references public.labels (workspace_id, id) on delete cascade
);

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

create table public.comments (
  id            text primary key,
  workspace_id  uuid not null,
  issue_id      text not null,
  author_id     uuid default private.my_profile_id() references public.profiles (id) on delete set null,
  body          text not null check (length(trim(body)) > 0),
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  linear_id     text,
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  unique (workspace_id, linear_id),
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade
);
create index on public.comments (issue_id);

-- ---------- views ----------

create table public.views (
  id            text primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  team_id       uuid,                           -- null: a workspace view
  owner_id      uuid default private.my_profile_id() references public.profiles (id) on delete set null,
  name          text not null,
  emoji         text not null default '',
  description   text not null default '',
  filters       jsonb not null default '{}',    -- same shape as today (team keys, logins, label and project ids)
  display       jsonb not null,
  created_at    timestamptz not null default now(),
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete cascade
);

-- ---------- your inbox ----------

create table public.inbox (
  id            text primary key,
  workspace_id  uuid not null,
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  actor_id      uuid default private.my_profile_id() references public.profiles (id) on delete set null,
  type          text not null check (type in ('assigned', 'mentioned', 'commented', 'status')),
  issue_id      text not null,
  comment_id    text references public.comments (id) on delete cascade,
  status        text check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate')),
  at            timestamptz not null default now(),
  read_at       timestamptz,                    -- read one by one
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  foreign key (workspace_id, issue_id) references public.issues (workspace_id, id) on delete cascade
);
create index on public.inbox (recipient_id, workspace_id, at desc);

-- "Mark all as read" and anything else personal per workspace
create table public.read_state (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  read_until    timestamptz,
  changed_at    timestamptz not null default clock_timestamp(),
  extra         jsonb not null default '{}',
  primary key (profile_id, workspace_id)
);

-- ---------- history and deletions ----------

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
create index on public.issue_events (issue_id, id);

-- every number a team ever gave out, so none is given out twice (filled by the number trigger, never emptied;
-- deleting or moving an issue leaves its number here). The Linear import reads it to keep Linear's numbers where free.
create table public.issue_numbers (
  workspace_id  uuid not null,
  team_id       uuid not null,
  number        integer not null,
  primary key (team_id, number),
  foreign key (workspace_id, team_id) references public.teams (workspace_id, id) on delete cascade
);

-- the email a person from Linear had there, so an invite can find them; never sent to browsers
create table private.guest_emails (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  email       text not null
);

-- what was deleted, so a browser that reconnects can drop it too (kept 45 days, see section 9)
create table public.deletions (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null,                  -- no foreign key: deleting a workspace writes these too
  table_name    text not null,
  row_key       jsonb not null,                 -- {"id": "…"} or {"issue_id": "…", "label_id": "…"}
  deleted_at    timestamptz not null default clock_timestamp()
);
create index on public.deletions (workspace_id, deleted_at);
```

### Pictures

A private Storage bucket. Files are named `<workspace id>/<sha>.<ext>` (the same hash as today, so a picture pasted
twice is stored once). Markdown keeps saying `/assets/<sha>.png`, so imported descriptions need no rewriting; the app
turns that into the bucket path.

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pictures', 'pictures', false, 10 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
```

Policies are in section 3. Showing a picture uses a signed URL valid for a day, kept in memory, so the browser's own
cache does the rest (`src/backend/pictures.ts`).

### From the model to the tables

| Today (file, field) | Database |
| --- | --- |
| `sprawniej.json` | `workspaces` (`format` is dropped: the migrations are the format now) |
| `people/<login>.json` | `profiles` + `workspace_members` |
| `people/~<name>.json` | `profiles` with `guest_of` set |
| `teams/<KEY>/team.json`, `members` | `teams`, `team_members` |
| `team.lastNumber` | `teams.last_number`, which now counts every number ever given out |
| issue file, `labels` | `issues`, `issue_labels` |
| `subscribers`, `unsubscribed` | `issue_followers` (`following` true or false) |
| `teams/<KEY>/archive/*.jsonl` | `issues` with `archived_at`, `archived_by`; their comments stay in `comments` |
| comment file | `comments` |
| `projects/<id>.json`, `teams` | `projects`, `project_teams` |
| `views/<id>.json` | `views` |
| `inbox/<login>/<id>.json` | `inbox` |
| `state/<login>.json` (`readUntil`, `read`) | `read_state.read_until` and `inbox.read_at` |
| `assets/<sha>.<ext>` | Storage bucket `pictures` |
| history from git commits | `issue_events` |
| `linearId` | `linear_id` columns (`linear_ids` on profiles) |

`isUnread` in `src/data/select.ts` becomes `!n.readAt && (!readUntil || n.at > readUntil)`.

**Times.** Postgres returns `2026-10-06T16:40:00+00:00`, the app writes `2026-10-06T16:40:00.000Z`, and the selectors
compare these as strings (`n.at > since`). `src/backend/rows.ts` turns every time into `toISOString()` form when
reading. This is easy to forget and breaks sorting and "new since" quietly, so it gets a test.

## 3. Row-level security

The rule for almost everything: **you see and change a workspace's rows if you are a member of it**. Exceptions: only
a comment's author edits or deletes it; your inbox and read marks are yours alone; managing the workspace (name,
invites, roles, removing people, linking people from Linear) is for admins and owners.

Helpers are `security definer` functions in the `private` schema, so a rule on `workspace_members` can ask about
`workspace_members` without going in circles, and so they run once per query (`in (select …)`), not once per row.

```sql
create function private.my_profile_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where user_id = (select auth.uid())
$$;

create function private.my_workspaces() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from public.workspace_members m
  where m.profile_id = private.my_profile_id() and m.removed_at is null
$$;

create function private.my_admin_workspaces() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from public.workspace_members m
  where m.profile_id = private.my_profile_id() and m.removed_at is null and m.role in ('owner', 'admin')
$$;

grant execute on all functions in schema private to authenticated;
```

Every table gets RLS turned on and nothing for `anon`:

```sql
do $$
declare t text;
begin
  foreach t in array array['workspaces', 'profiles', 'workspace_members', 'invites', 'teams', 'team_members', 'labels',
    'projects', 'project_teams', 'issues', 'issue_labels', 'issue_followers', 'comments', 'views', 'inbox',
    'read_state', 'issue_events', 'issue_numbers', 'deletions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
```

**Shared workspace data** (`teams`, `team_members`, `labels`, `projects`, `project_teams`, `issues`, `issue_labels`,
`issue_followers`, `views`): members read and write.

```sql
-- the same four lines for each of the tables above
create policy "members read"   on public.issues for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
create policy "members add"    on public.issues for insert to authenticated
  with check (workspace_id in (select private.my_workspaces()));
create policy "members change" on public.issues for update to authenticated
  using (workspace_id in (select private.my_workspaces()))
  with check (workspace_id in (select private.my_workspaces()));
create policy "members delete" on public.issues for delete to authenticated
  using (workspace_id in (select private.my_workspaces()));
```

**Columns only the database sets.** Column grants keep the numbers, the history and authorship honest. A move to
another team goes through `move_issue_to_team` (section 4).

```sql
revoke insert, update on public.issues from authenticated;
grant insert (id, workspace_id, team_id, title, description, status, priority, assignee_id, project_id, parent_id,
              due_date, estimate, sort_order, duplicate_of, extra) on public.issues to authenticated;
grant update (title, description, status, priority, assignee_id, project_id, parent_id, due_date, estimate,
              sort_order, duplicate_of, archived_at, extra) on public.issues to authenticated;

revoke update on public.teams from authenticated;
grant update (name, emoji, auto_archive, extra) on public.teams to authenticated;   -- not key, not last_number
```

**Comments: everyone in the workspace reads and adds; only the author edits or deletes.**

```sql
create policy "members read comments" on public.comments for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
create policy "members comment as themselves" on public.comments for insert to authenticated
  with check (workspace_id in (select private.my_workspaces()) and author_id = (select private.my_profile_id()));
create policy "authors edit their comments" on public.comments for update to authenticated
  using (author_id = (select private.my_profile_id()))
  with check (author_id = (select private.my_profile_id()));
create policy "authors delete their comments" on public.comments for delete to authenticated
  using (author_id = (select private.my_profile_id()));

revoke insert, update on public.comments from authenticated;
grant insert (id, workspace_id, issue_id, body, extra) on public.comments to authenticated;
grant update (body, extra) on public.comments to authenticated;   -- edited_at is set by a trigger
```

Deleting an issue still removes its comments (the foreign key cascades, which RLS doesn't stop), as today.

**Your inbox.** Notes are written by the person who caused them, for members of the same workspace, and only the
recipient reads, marks or deletes them.

```sql
create policy "read your notes" on public.inbox for select to authenticated
  using (recipient_id = (select private.my_profile_id()));
create policy "mark your notes" on public.inbox for update to authenticated
  using (recipient_id = (select private.my_profile_id()));
create policy "delete your notes" on public.inbox for delete to authenticated
  using (recipient_id = (select private.my_profile_id()));
create policy "notes from you to teammates" on public.inbox for insert to authenticated
  with check (
    actor_id = (select private.my_profile_id())
    and workspace_id in (select private.my_workspaces())
    and recipient_id in (select profile_id from public.workspace_members m
                         where m.workspace_id = inbox.workspace_id and m.removed_at is null)
  );
revoke update on public.inbox from authenticated;
grant update (read_at) on public.inbox to authenticated;

create policy "your read marks" on public.read_state for all to authenticated
  using (profile_id = (select private.my_profile_id()))
  with check (profile_id = (select private.my_profile_id()) and workspace_id in (select private.my_workspaces()));
```

**History, used numbers and deletions:** members read; only triggers write (no insert, update or delete policies).

```sql
create policy "members read history"   on public.issue_events for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
create policy "members read deletions" on public.deletions for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
create policy "members read used numbers" on public.issue_numbers for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
```

**Workspaces, members, invites.**

```sql
create policy "members see the workspace" on public.workspaces for select to authenticated
  using (id in (select private.my_workspaces()));
create policy "admins rename it" on public.workspaces for update to authenticated
  using (id in (select private.my_admin_workspaces()));
create policy "owners delete it" on public.workspaces for delete to authenticated
  using (id in (select m.workspace_id from public.workspace_members m
               where m.profile_id = (select private.my_profile_id()) and m.role = 'owner' and m.removed_at is null));
-- creating one goes through create_workspace() (section 4), which also makes you its owner

create policy "members see who is in" on public.workspace_members for select to authenticated
  using (workspace_id in (select private.my_workspaces()));
create policy "admins change roles and remove people" on public.workspace_members for update to authenticated
  using (workspace_id in (select private.my_admin_workspaces()));
revoke insert, update on public.workspace_members from authenticated;
grant update (role, removed_at) on public.workspace_members to authenticated;
-- joining goes through accept_invite() and leaving through leave_workspace() (a policy letting people update their
-- own row would also let them make themselves owner); a trigger keeps at least one owner per workspace

create policy "admins manage invites" on public.invites for all to authenticated
  using (workspace_id in (select private.my_admin_workspaces()))
  with check (workspace_id in (select private.my_admin_workspaces()));
```

**Profiles.** You see yourself, everyone who shares (or shared) a workspace with you, and that workspace's guests. You
change your own name and picture; a login is picked once, through a function.

```sql
create policy "people you work with" on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or id in (select m.profile_id from public.workspace_members m where m.workspace_id in (select private.my_workspaces()))
    or guest_of in (select private.my_workspaces())
  );
create policy "your own profile" on public.profiles for update to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update on public.profiles from authenticated;
grant update (name, avatar_url, name_set_here, extra) on public.profiles to authenticated;
```

**Pictures.** The first folder of a picture's path is the workspace id.

```sql
create policy "members see pictures" on storage.objects for select to authenticated
  using (bucket_id = 'pictures' and ((storage.foldername(name))[1])::uuid in (select private.my_workspaces()));
create policy "members add pictures" on storage.objects for insert to authenticated
  with check (bucket_id = 'pictures' and ((storage.foldername(name))[1])::uuid in (select private.my_workspaces()));
-- no update or delete: a picture never changes (its name is its hash); a monthly job can remove unused ones later
```

**Realtime** has its own rule, in section 5. After every migration we run the security and performance advisors
(`get_advisors`) and fix what they find.

## 4. Database functions and triggers

The database does only what must be done in one place: hand out numbers, keep history, remember deletions, send
realtime messages, and a few multi-step changes that must happen together. Everything else (who hears about what,
ordering, descriptions of changes) stays in TypeScript, where it is tested and where a PocketBase version could reuse it.

### Issue numbers

`teams.last_number` is a counter. A `before insert` trigger takes the next number while holding the team's row lock,
so two people creating issues in the same instant get different numbers. Every number given out is also written to
`issue_numbers`, whose primary key makes it impossible to give one out twice, even to an import that keeps Linear's
numbers (deleted, archived and moved issues included, which is what `lastNumber` and `highestArchived` do today).

```sql
create function private.next_issue_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('sprawniej.importing', true) = 'on' and new.number is not null then
    -- the importer keeps old numbers and moves the counter past them
    update public.teams set last_number = greatest(last_number, new.number) where id = new.team_id;
  else
    update public.teams set last_number = last_number + 1
    where id = new.team_id and workspace_id = new.workspace_id
    returning last_number into new.number;
  end if;
  if new.number is null then raise exception 'There is no such team.'; end if;
  -- fails (and so does the insert) if the number was ever used in this team
  insert into public.issue_numbers (workspace_id, team_id, number) values (new.workspace_id, new.team_id, new.number);
  return new;
end $$;

create trigger issue_number before insert on public.issues
  for each row execute function private.next_issue_number();
```

The browser shows a new issue at once with its title and a short "ENG-…" until the insert returns (a fraction of a
second), then the real number. `src/sync/renumber.ts` and the "ENG-12 is now ENG-14" message go away.

Moving an issue to another team takes a number there and remembers the old one:

```sql
create function public.move_issue_to_team(p_issue text, p_team uuid) returns public.issues
language plpgsql security definer set search_path = '' as $$
declare
  i public.issues;
  old_ref text;
  n integer;
begin
  select * into i from public.issues where id = p_issue for update;
  if i is null or i.workspace_id not in (select private.my_workspaces()) then raise exception 'Not found.'; end if;
  if i.team_id = p_team then return i; end if;
  select t.key || '-' || i.number into old_ref from public.teams t where t.id = i.team_id;
  update public.teams set last_number = last_number + 1
  where id = p_team and workspace_id = i.workspace_id returning last_number into n;
  if n is null then raise exception 'There is no such team.'; end if;
  insert into public.issue_numbers (workspace_id, team_id, number) values (i.workspace_id, p_team, n);
  update public.issues set team_id = p_team, number = n, former_refs = former_refs || old_ref
  where id = p_issue returning * into i;
  return i;
end $$;
```

Comments, labels and followers need nothing: they point at the issue's id, not its team.

### Keeping times and history

A `before update` trigger on every table sets `changed_at := clock_timestamp()`. On `issues` it also sets
`updated_at := now()` when a field people see changed (not for followers, which are another table anyway), sets
`completed_at` when the status becomes or stops being Done (today's rule in `updateIssue`), and sets
`archived_by := private.actor_id()` when `archived_at` is set. On `comments` it sets `edited_at` when the body changes.

`private.actor_id()` is the signed-in person, or, for the future GitHub webhook (an Edge Function using the service
role), whoever it says it acts for:

```sql
create function private.actor_id() returns uuid language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('sprawniej.actor', true), '')::uuid, private.my_profile_id())
$$;
```

**History is written by triggers**, so it is complete whoever makes the change (the app, the importer's later
re-runs, a webhook, someone in the SQL editor):

```sql
create function private.issue_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c jsonb := '{}';
begin
  if current_setting('sprawniej.importing', true) = 'on' then return null; end if;
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

create trigger issue_history after update on public.issues
  for each row execute function private.issue_history();
```

`issue_labels` gets a matching trigger that writes `{"labels": {"added": [id]}}` or `{"removed": [id]}`. It writes
nothing when the issue or the label itself is being deleted (the delete cascades to `issue_labels`, and a history row
for a vanished issue would make the whole delete fail on its foreign key):

```sql
if tg_op = 'DELETE' and (not exists (select 1 from public.issues where id = old.issue_id)
                         or not exists (select 1 from public.labels where id = old.label_id)) then
  return null;
end if;
```

Creating an issue writes no event, as today: the issue page shows "created" from the issue's own fields.

`src/data/history.ts` keeps `Change`, `combine` and the folding of quick repeated changes ("typing a title" reads as
one change). `issueEvents(versions)` becomes `issueEvents(rows)`, which turns `issue_events` rows into the same
`Change` list, mapping profile ids to logins. The `removed`/`restored` kinds become `archived`/`restored`. History
loads when an issue page opens, as now (`src/features/issues/useHistory.ts`), one query: `issue_events where
issue_id = $1 order by id`.

### Remembering deletions

```sql
create function private.remember_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.deletions (workspace_id, table_name, row_key)
  select old.workspace_id, tg_table_name, jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(tg_argv) k;
  return null;
end $$;

create trigger forget after delete on public.issues       for each row execute function private.remember_deletion('id');
create trigger forget after delete on public.issue_labels for each row execute function private.remember_deletion('issue_id', 'label_id');
-- … and the same for every shared table, with its key columns
```

Row triggers fire for cascaded deletes too, so deleting a team leaves a note for each issue, comment and view that went
with it. Inbox and read marks don't need this: on reconnect the app simply reloads your inbox, which is small.

### Inbox notes: written by the app, checked by the database

Who hears about what stays in `src/data/notify.ts`, unchanged. It is pure, tested, and it reads Markdown mentions,
which would be clumsy to rewrite in SQL; the future webhook (an Edge Function, in TypeScript) can import the same file.
After an issue or comment change is saved, `src/backend` inserts the notes in one request. The database makes sure
they are honest (RLS: from you, to members) and does the "not again within ten minutes" check that today reads other
people's inbox files, which browsers can no longer see:

```sql
create function private.skip_repeated_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type <> 'commented' and new.comment_id is null and exists (
    select 1 from public.inbox n
    where n.recipient_id = new.recipient_id and n.actor_id = new.actor_id and n.issue_id = new.issue_id
      and n.type = new.type and n.status is not distinct from new.status and n.comment_id is null
      and n.at > now() - interval '10 minutes'
  ) then
    return null;   -- quietly skipped
  end if;
  return new;
end $$;

create trigger skip_repeated before insert on public.inbox
  for each row execute function private.skip_repeated_note();
```

If the network drops between the change and its notes, the notes are lost and the change is not; that is acceptable
for notes. (If it turns out not to be, an `update_issue(id, patch, notes)` function can do both in one go.)

### Other functions

| Function | What it does | Who may call it |
| --- | --- | --- |
| `ensure_profile()` | After sign-in: finds your profile; or claims an imported one whose `github_id` matches your GitHub sign-in (read from `auth.identities`, never from the browser); or makes one from your GitHub login if it's free. Returns null when you still need to pick a login. | anyone signed in |
| `create_profile(login, name)` | Picks your login (Google and email sign-ups, or a taken GitHub login) | anyone signed in without a profile |
| `create_workspace(name, team_key, team_name, team_emoji)` | The workspace, you as owner, a first team with you in it | anyone with a profile |
| `invite_info(token)` | Workspace name, who invited, who it's for: what the join wizard shows before you join | anyone signed in |
| `accept_invite(token)` | Makes you a member (or back from `removed_at`), marks the invite used. An invite made for a person from Linear (`for_profile`) turns that person into you, with the same work as `link_person` (their issues, comments, follows and team places move to your profile, and view filters that name them are rewritten). | the invited person |
| `leave_workspace(workspace)` | Sets your own `removed_at` (not for the last owner) | members |
| `move_issue_to_team(issue, team)` | See above | members |
| `link_person(workspace, guest, to)` | Someone from Linear who hadn't joined is this person: every reference moves over (issues, comments, projects, views' filters, followers, team members, inbox), `linear_ids` merge, the guest profile goes. One transaction, replacing `src/data/relink.ts`'s file rewriting. | admins |
| `import_rows(workspace, table, rows jsonb)` | Upsert for the imports (Linear first) with `sprawniej.importing` on: keeps numbers, no history or realtime noise. Re-imports match on `(workspace_id, linear_id)`. | admins |
| `set_guest_email(profile, email)` | The Linear import keeps a person's Linear email in `private.guest_emails`, so Settings can suggest inviting them at that address | admins |

`auth.users` gets **no trigger**: a failing trigger there breaks sign-up for everyone, so profiles are made by
`ensure_profile`/`create_profile`, called by the app after sign-in.

### Jobs (pg_cron)

`create extension pg_cron with schema pg_catalog;` then, once a day at night:

- **auto-archive**: `update issues set archived_at = now() …` for issues Done, Canceled or Duplicate and untouched for
  longer than their team's `auto_archive` months (today's `tidyArchive` rule, in one statement);
- **tidy inboxes**: delete read notes older than 30 days, unread ones older than 90 days (`INBOX_KEEP` today);
- **forget old deletions**: `delete from deletions where deleted_at < now() - interval '45 days'`.

So `tidyArchive`, `mendArchive` and `tidyInbox` leave the browser.

## 5. Realtime

### What a browser listens to

Two **private broadcast channels** per open workspace:

- `ws:<workspace id>`: every change to the workspace's shared rows;
- `me:<profile id>`: your inbox and read marks.

We use **Broadcast from the database** (`realtime.send` in a trigger) rather than Postgres Changes: it is what Supabase
recommends for scale, it checks access once when you join a channel rather than for every change and every listener,
and it lets the trigger send a small message.

```sql
create function private.broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  topic text := tg_argv[0] || (rec ->> tg_argv[1]);
  payload jsonb;
begin
  if current_setting('sprawniej.importing', true) = 'on' then return null; end if;
  if tg_op = 'UPDATE' then
    -- only what changed, plus the keys and changed_at: small messages, and they say which fields moved
    select jsonb_object_agg(e.key, e.value) into payload
    from jsonb_each(rec) e
    where e.key = any (tg_argv[2:]) or e.key = 'changed_at' or to_jsonb(old) -> e.key is distinct from e.value;
  elsif tg_op = 'DELETE' then
    select jsonb_object_agg(k, rec -> k) into payload from unnest(tg_argv[2:]) k;
  else
    payload := rec;
  end if;
  if octet_length(payload::text) > 200000 then            -- a huge description: send a nudge, the app fetches the row
    payload := (payload - 'description' - 'body') || '{"partial": true}';
  end if;
  perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op, 'row', payload), 'change', topic, true);
  return null;
end $$;

create trigger live after insert or update or delete on public.issues
  for each row execute function private.broadcast('ws:', 'workspace_id', 'id');
create trigger live after insert or update or delete on public.issue_labels
  for each row execute function private.broadcast('ws:', 'workspace_id', 'issue_id', 'label_id');
create trigger live after insert or update or delete on public.inbox
  for each row execute function private.broadcast('me:', 'recipient_id', 'id');
-- … one for each table; profiles send to every workspace the person is in (a small loop)
```

Who may listen:

```sql
create policy "members listen to their workspace" on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast' and (
      (realtime.topic() like 'ws:%' and substr(realtime.topic(), 4)::uuid in (select private.my_workspaces()))
      or realtime.topic() = 'me:' || (select private.my_profile_id())::text
    )
  );
```

`realtime.messages` is split by day and old days are dropped by Supabase after three days, so it doesn't grow.

### Opening a workspace

1. Show what this browser already has (a read cache in IndexedDB, see section 9; it comes before the team joins, and
   until then this step is skipped and step 3 loads everything), so the screen is there at once.
2. Join both channels (`supabase.channel('ws:…', { config: { private: true } })`, after `supabase.realtime.setAuth()`).
   Messages that arrive before step 3 finishes are held.
3. Fetch what changed since the cache's mark: for each table `select … where workspace_id = $1 and changed_at > $mark`,
   plus `deletions where deleted_at > $mark`, plus your whole inbox. No cache, or a mark older than 45 days (deletions
   are forgotten then): load everything that isn't archived.
4. Apply the held messages, then keep applying messages as they come.

The mark is the highest `changed_at` the browser has seen, minus 10 seconds. `changed_at` is set when a row is written,
but becomes visible when its transaction ends, a moment later; looking back a little catches those, and applying a row
twice does nothing.

### After a reconnect

Supabase's client rejoins channels by itself. When a channel reports `SUBSCRIBED` again after having dropped, the app
runs step 3 with its mark, so whatever happened while it was away arrives. The same happens when a tab comes back after
being hidden (see "Free tier" for why hidden tabs leave their channels).

### Applying a change

Every incoming row (from a message or a fetch) goes through one function, `applyRows` in `src/backend/live.ts`:

- **Newer only.** A row whose `changed_at` is older than what we have is ignored, so messages arriving out of order
  can't undo anything.
- **Your own echoes.** Every write you make also comes back to you as a message. Fields you have **waiting to be saved
  or just saved** (in flight) are not overwritten by incoming values. Once the write returns, the echo carries the same
  values you already have, and the store keeps the same objects (nothing redraws). So typing in a title is never
  undone by the echo of what you typed a second ago.
- **Per field.** An update message carries only the changed fields; they are laid over the row we have. So if Ania
  changes the status and Bartek the assignee at the same time, both stay; if they both change the status, the later
  save wins, exactly the rules in docs/architecture.md, without `src/sync/merge.ts`.
- **Partial rows** (a huge description) are fetched by id.
- Rows are turned into the model types (`Issue`, `Comment`…) by `src/backend/rows.ts`, and the store gets new objects
  only for the kinds that changed (as `applyFiles` does today, so a label change doesn't redraw issue lists).

### Saving

There is still no Save button. An action updates the store at once, then `src/backend/writes.ts` sends **only the
changed columns** (`update issues set status = 'done' where id = …`). Labels, followers and team members are inserts
and deletes in their join tables.

- Quick edits of the same row are joined into one request (the title already waits until you stop typing).
- The save chip says "Saving…" while something is on its way, "Saved" after.
- If a request fails because the connection dropped, it is retried (in memory, not kept across a closed tab) and the
  chip says the change will be saved when the connection is back. Closing the tab with something unsaved asks first.
- If the server refuses a change (a rule or a check), the app puts the old value back and says so in plain words.

What we lose, knowingly: two people rewriting **different lines of the same description** at the same moment no
longer merge line by line; the later save wins for the whole description. With realtime, people see each other's edits
within a second, so this should be rare. (We can bring back the line merge from `node-diff3` later, inside the editor,
if it bites.)

### Several tabs

Each tab has its own connection, and there is no leader any more (`src/sync/tabs.ts` goes). The Supabase client keeps
the sign-in shared between tabs by itself. If connections or messages become a problem (section 9), the leader idea can
come back for realtime only.

## 6. Signing in

Supabase Auth with three ways in: **GitHub**, **Google**, and **email and password**.

### In stages

| Stage | Who | Ways in | Emails | Address |
| --- | --- | --- | --- | --- |
| **A. Solo on localhost** (first days) | you | GitHub, email and password with **"confirm email" off** | none needed | `http://localhost:5173` only |
| **B. The team** (6 to 8 people) | everyone | GitHub, email and password with confirmation, Google | our own sender (for confirmations and password resets) | the public address |

Stage A needs no email and no domain: GitHub sign-in sends no email, and with confirmations off an email account works
at once. The built-in sender would only reach the project team's own addresses, a couple of times an hour, so we don't
rely on it; "Forgot your password?" stays hidden until stage B. In `config.toml`:

```toml
[auth]
site_url = "env(SPRAWNIEJ_SITE_URL)"                       # http://localhost:5173 in stage A
additional_redirect_urls = ["http://localhost:5173", "http://localhost:5297", "http://localhost:5298", "http://localhost:5299"]
enable_manual_linking = true

[auth.email]
enable_signup = true
enable_confirmations = false                               # stage A only; true in stage B

[auth.external.github]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)"
```

Stage B changes `site_url`, adds the public address to the redirect URLs, turns confirmations on, adds
`[auth.external.google]` and `[auth.email.smtp]`, and is pushed with `supabase config push`. Moving from A to B changes
no code, only settings.

`main` deploys to GitHub Pages, where people use today's version, so the Supabase version **stays on its branch** during
stage A and runs only from localhost. It reaches `main` at the switch (section 11).

### PKCE, because the app uses hash routes

Routes live in the URL hash (`#/team/ENG/issues/active`). The older "implicit" sign-in puts the session in the hash and
would clash with them. With **PKCE** (`flowType: 'pkce'`) Supabase sends people back with `?code=…` in the query
string, which leaves the hash alone:

```ts
createClient(url, publishableKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } })
```

- Sign-in buttons call `signInWithOAuth({ provider: 'github' | 'google', options: { redirectTo: publicAppUrl() } })`,
  where `redirectTo` is the app's address **without** a hash. After sign-in the app returns to where it was (the route
  is kept in `sessionStorage` before leaving) and removes `?code` with `history.replaceState`.
- **Email links** (confirm your address, reset your password) also use PKCE. The email templates link to
  `{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=email` (or `type=recovery`), and the app calls
  `verifyOtp({ token_hash, type })`. A recovery opens a "Choose a new password" screen.
- **Redirect URLs** allowed in Auth settings: `http://localhost:5173`, `:5297`, `:5298`, `:5299` for development and
  tests, and in stage B the public address (`VITE_PUBLIC_URL`, GitHub Pages today).
- In stage B, email sign-ups must confirm their address before they can sign in.

### Providers

- **GitHub** (stage A): an OAuth app per Supabase project, callback `https://<project ref>.supabase.co/auth/v1/callback`
  (for this run, `wkqofiacqfuxowavuqxj`). Asks only for the profile and email; no access to repos. (The later GitHub
  App for pull requests is a separate thing, installed on repositories, not used for sign-in.)
- **Email and password** (stage A): minimum length 8, leaked-password check if the plan allows it.
- **Google** (stage B): an OAuth client in Google Cloud with the same callback, consent screen "External" or
  "Internal" depending on whether everyone has a company Google account (open question).

### Who you are: profiles and logins

After any sign-in the app calls `ensure_profile()`:

1. You already have a profile: done.
2. You signed in with GitHub and the old workspace had someone with your **GitHub id** (`people/<login>.json` has
   `githubId`): you get that profile. Everything you did before is already yours, and you are already a member of the
   imported workspace. We match by id, not by login, because GitHub logins can change and be reused.
3. You signed in with GitHub and your GitHub login is free: a profile with that login is made.
4. Otherwise (Google, email, or the login is taken): a short "Pick a name people can @mention" step calls
   `create_profile(login, name)`, suggesting one from your email or name.

### One person, several ways in

- Supabase links a new sign-in to an existing account by itself when the **verified email** is the same (GitHub with
  a public or verified primary email and Google with the same address end up as one account).
- Otherwise, Settings › Your account gets a **"Ways to sign in"** list: add GitHub or Google (`linkIdentity`, needs
  "manual linking" turned on in Auth settings), set or change a password (`updateUser({ password })`), remove one
  (`unlinkIdentity`, only while another is left).
- Someone who was in the old GitHub workspace but now signs in with Google keeps a fresh profile. Linking GitHub from
  Settings then claims their old profile: `ensure_profile()` runs again and moves everything over with the same code as
  `link_person`.

### Emails: our own sender (stage B)

Not needed in stage A. Supabase's built-in email sender only allows a couple of emails an hour and only to the project
team's own addresses, so before teammates join, sign-up confirmations and password resets need **custom SMTP**
(`[auth.email.smtp]` in `config.toml`, password from the environment): the company's mail server, or a service with a free
allowance (for example Resend or Brevo) on a domain we control, with SPF and DKIM set. Templates are rewritten in
Sprawniej's plain, friendly words (no "token", no "redirect").

### Invites

The GitHub collaborator invite and the five-step join wizard go away. An admin creates an invite in Settings (for a
person, optionally with their email) and gets a link, `#/join/<token>`, with the same ready-to-send message as today.
The link opens: Welcome (workspace name, who invited you, the team's pictures) → sign in or create an account → you're
in.

People from Linear who haven't joined are listed in Settings with an **Invite** button. Their invite is made for that
person (`for_profile`, with their Linear email suggested), so whoever accepts it becomes them: their assigned issues,
comments and follows move to that account in the same step. This replaces most uses of "Link person"; linking by hand stays for
someone who already joined with another account (`link_person`). Invites last 14 days and work once. Sending the email for you can come later (it needs the SMTP above and an Edge
Function).

## 7. The code

### `src/backend/`: every call to Supabase

Nothing outside this folder imports `@supabase/supabase-js`. The rest of the app talks to a small interface, so a
PocketBase version could be written against the same interface if Supabase ever stops being right for us.

```
src/backend/
  index.ts           the Backend interface and the one instance the app uses
  client.ts          createClient (URL and publishable key from VITE_SUPABASE_URL / VITE_SUPABASE_KEY)
  database.types.ts  generated by `supabase gen types typescript`
  auth.ts            sign in (GitHub, Google, password), sign up, reset, ways to sign in, sign out
  profiles.ts        ensure_profile, create_profile, rename
  workspaces.ts      my workspaces, create, rename, members and roles, invites, accept, leave
  rows.ts            rows <-> model types (ids <-> logins, times as toISOString, extra <-> passthrough fields)
  load.ts            opening a workspace: cache, catch-up since the mark, archive on demand
  live.ts            channels, reconnects, applyRows (newer only, in-flight fields, per field)
  writes.ts          sending changed columns, join-table inserts and deletes, retries, the save chip's state
  cache.ts           the read cache in IndexedDB (rows + mark per workspace)
  pictures.ts        upload, signed URLs
  history.ts         issue_events for one issue
  importRepo.ts      the one-time import from a GitHub workspace (section 8)
```

```ts
// src/backend/index.ts (shape, not final)
export interface Backend {
  auth: { session(): Session | null; signIn(how: SignInWith): Promise<void>; signOut(): Promise<void>; onChange(cb: () => void): () => void }
  me: { ensure(): Promise<Person | null>; create(login: string, name: string): Promise<Person>; rename(name: string): Promise<void> }
  workspaces: { mine(): Promise<WorkspaceInfo[]>; create(...): Promise<string>; open(id: string): Promise<void>; close(): void }
  write(change: Change): void          // what actions.ts calls: { table, op, key, fields } items
  flush(): Promise<void>               // before updating the app or signing out
  moveIssueToTeam(id: string, team: string): Promise<Issue>
  history(issueId: string): Promise<IssueEventRow[]>
  loadArchive(): Promise<void>
  addPicture(file: Blob): Promise<string>
  pictureUrl(path: string): string | undefined
  status: SaveStatus                    // for the save chip
}
```

### What happens to each part of `src`

| Path | Fate | Notes |
| --- | --- | --- |
| `src/sync/engine.ts`, `local.ts`, `merge.ts`, `pace.ts`, `renumber.ts`, `sha.ts`, `tabs.ts` | **deleted** | Replaced by `src/backend/load.ts`, `live.ts`, `writes.ts`, `cache.ts`. `useSync` becomes the backend's save status. |
| `src/github/api.ts` | **deleted** (after the import period) | Until then only `importRepo.ts` uses the reading parts (`getHead`, `getFiles`, `getBlobs`). |
| `src/data/actions.ts` | **rewritten inside, same functions outside** | Still the only place that changes data. Instead of files it hands `src/backend` the changed fields. Many actions get shorter: deleting a team, issue, label or project no longer rewrites other files (foreign keys cascade or set null); `rememberNumber`, `archiveIssues`/`restoreIssue` packing, `tidyArchive`, `mendArchive`, `tidyInbox`, `dropNotes`, `toldRecently` go; `importFiles` becomes `importRows`. `dropFromViews` stays (view filters are JSON). |
| `src/data/files.ts` | **kept for the importer**, moved to `src/backend/legacy/` | Parsers for the old repo files; deleted when the import screen goes. |
| `src/data/project.ts` | **deleted** | `applyFiles` becomes `applyRows`; `loadArchive` moves to `src/backend/load.ts`. |
| `src/data/relink.ts` | **mostly deleted** | `link_person()` in SQL does the moving. `sameName`/`plainName` (matching Linear people by name) stay for the Linear import. |
| `src/data/history.ts` | **changed** | Reads `issue_events` rows instead of file versions; `Change`, `combine`, folding stay. |
| `src/data/assets.ts` | **rewritten** | Uses `src/backend/pictures.ts`; `/assets/<sha>.png` in Markdown stays. |
| `src/data/notify.ts`, `mentions.ts`, `ordering.ts`, `select.ts`, `search.ts`, `displays.ts`, `store.ts` | **kept** | `isUnread` uses `readAt`; the store's `InboxItem` gets `readAt`. |
| `src/model/schema.ts` | **kept, trimmed** | Still the types and a check on rows coming in. `FORMAT_VERSION`, `workspaceSchema.format`, `archivedIssueSchema` (only for the importer) move or go. |
| `src/model/status.ts` | **kept** | The SQL checks copy its lists; a test compares them. |
| `src/session.ts` | **rewritten** | The GitHub key goes; Supabase keeps the sign-in. Keeps the open workspace id, recent workspaces, `toured`. |
| `src/app/Gate.tsx`, `signOut.ts`, `SaveStatus.tsx`, `updates.ts`, `JoinTeams.tsx`, `components/SignOut.tsx` | **changed** | Use the backend; signing out wipes the read caches. |
| `src/features/onboarding/*` | **rewritten** | Sign-in screen (three ways), pick a login, choose or create a workspace, the invite wizard. `KeyStep.tsx`, `repoNames.ts`, `setupDraft.ts` and the GitHub parts of `joinLink.ts` go. |
| `src/features/settings/SettingsPage.tsx` | **changed** | Members and roles, invite links, "Ways to sign in". `LinkPersonDialog.tsx` calls `link_person`. "Where your workspace is stored" goes. |
| `src/features/import/*` (Linear) | **changed first** | `linearMap.ts` builds rows instead of files (the mapping and its tests mostly stay; the archive-file code goes); the page calls `importRows` (section 8). |
| `src/features/issues/useHistory.ts`, `HistoryLine.tsx` | **changed** | New source; `archived`/`restored` lines. |
| `src/editor/*`, `src/features/issues/composer.ts` | **small changes** | Picture upload and URLs through the backend. |
| `src/features/help`, `docs/user-guide.md` | **changed** | Signing in, inviting, no GitHub key. |
| `window.sprawniej` | **changed** | `data`, `actions` stay; `sync` becomes `backend` (`status`, `catchUp()`). |
| `tests/` | `merge`, `pace`, `archive` (packing), `relink` (file rewriting), `repoNames` tests go; `files` tests move with the importer; new tests for `rows.ts` (including times), `applyRows` (newer only, in-flight fields, per field), `history` from events, the status lists matching the SQL checks. SQL rules and triggers get pgTAP tests run against `supabase start`. |
| `supabase/` | **new** | `config.toml`, `migrations/`, `tests/` (pgTAP), email templates, later `functions/github-webhook/`. |

## 8. Imports: Linear first

### From Linear (step 7 of the plan)

This run starts from a copy of a real project's tasks in Linear, so the existing **Settings › Import from Linear**
moves onto rows first. The wizard stays as it is for people (key, teams, people, check, import, progress); what changes
is what `buildImport` returns and how it is saved.

- **`linearMap.ts` returns rows, not files.** `buildImport(data, choices, existing, newId, now)` keeps its name, its
  inputs and most of its rules, and returns `{ profiles, teams, teamMembers, labels, projects, projectTeams, issues,
  issueLabels, issueFollowers, comments, views, counts, renumbered, inexactViews, skippedViews }` in the model's own
  shapes (logins, team keys). `src/backend/rows.ts` turns logins into profile ids and team keys into team ids when
  sending. `tests/linearImport.test.ts` keeps its fixture and checks rows instead of files.
- **What gets simpler.** No archive month files: issues finished longer ago than their team keeps finished issues
  arrive with `archived_at` set, and comments on archived issues are ordinary comments. The `relinkedArchive`,
  `archivedWithNew` and month-file merging code goes. A person from Linear who joined since an earlier import is moved
  over by `link_person` in the database instead of rewriting files.
- **People.** The people step is the same: each Linear user is matched to someone in the workspace (by name or email,
  as `guessPerson` does today, plus "That's you" for the person importing), comes as a person who hasn't joined (a
  guest profile, with a fresh `uuid` made in the browser so the rows can point at it before it's saved), or is left
  out. A guest's Linear email goes to `private.guest_emails` through `set_guest_email`, so Settings can offer to invite
  them at that address (section 6, Invites). In stage A, with only you signed in, everyone else arrives as a guest.
- **Numbers.** Issues keep their Linear numbers (`ENG-123` stays `ENG-123`). The wizard loads the team's used numbers
  (`issue_numbers`, numbers only) instead of every issue file, and anything already used gets the next free number, as
  today ("ENG-12 came in as ENG-40" in the check step). The database refuses a used number anyway.
- **Saving.** Rows go through `import_rows` in dependency order (guest profiles, teams and team members, labels,
  projects and project teams, issues without parent or duplicate, then those two fields, issue labels and followers,
  comments, views), in batches of 500, with the same progress bar. `import_rows` upserts on `(workspace_id,
  linear_id)`, so running the import again updates what came over and adds what's new, as it does now; issues archived
  here since stay archived.
- **Pictures** pasted in Linear stay links to Linear, as today.
- **Archived issues for matching.** A second import needs to know archived issues too; it asks the database for
  `id, linear_id` of the workspace's issues with a `linear_id` (a small query) instead of loading the archive.

`docs/linear-import.md` is updated to say "rows" where it says "files" and to drop the part-of-300-files saving.

### From a GitHub workspace (later, only if someone needs it)

Not needed for this run. If a team using today's GitHub version wants to move, this is the one-time move, done by the
workspace's owner from the app: **Settings › Bring over your old workspace**. It would live only for a release or two,
so it can reuse today's code instead of a new tool.

1. The owner signs in (with GitHub, so their old profile is claimed) and creates the new workspace, or picks an empty
   one.
2. They paste a GitHub key once (used for this import only, not saved, as the Linear import does) and choose the old
   workspace repo.
3. The app reads every file the way it does today (`getHead`, `getFiles`, `getBlobs` from `src/github/api.ts`) and
   parses them with `parseFile` and `parseArchive` from `src/data/files.ts`. Files that don't parse are listed and
   skipped, as now.
4. It maps them to rows (`src/backend/importRepo.ts`, a pure function with tests on a fixture repo):
   - `people/<login>.json` → profiles with `login`, `github_id`, `name`, `avatar_url`, `name_set_here`, `linear_ids`
     (no account yet; claimed when that person signs in with GitHub), and a `workspace_members` row each. People in
     the GitHub repo's collaborator list without a file get a profile from their GitHub profile too.
   - `people/~*.json` → guest profiles (`guest_of` = the new workspace).
   - teams with `last_number` = the highest of `lastNumber`, every issue number (active and archived) and every number
     in `formerRefs` that starts with the team's key; `members` → `team_members`.
   - labels, projects (+ `project_teams`), views (filters kept as they are: logins and keys still mean the same).
   - issues: active ones, and archived ones from the month files with `archived_at`/`archived_by`; same ids, numbers,
     `sort_order`, `former_refs`; `labels` → `issue_labels`; `subscribers`/`unsubscribed` → `issue_followers`.
   - comments from comment files and from archive lines.
   - unread inbox notes from the last 90 days, and `state/<login>.json` → `read_state.read_until` plus `read_at` on the
     notes in `read`.
   - `assets/*` → uploaded to the `pictures` bucket under the workspace id.
   - Unknown fields → `extra`; `linearId` → `linear_id`.
5. It sends them in dependency order (profiles, teams, labels, projects, issues without parents, then parents and
   duplicates set in a second pass, join tables, comments, views, inbox) in batches of 500 through
   `import_rows`, which upserts by id. Importing again updates instead of duplicating, so the owner can run it once
   to try, and once more right before everyone switches.
6. History before the move is **not** brought over: it stays readable in the old repository's history on GitHub. Issue
   pages say "History before <date> is in the old workspace" with a link, for issues created before the move. (Bringing
   it over would mean one GitHub request per issue; see open questions.)

The old repo is left as it was. After the switch the owner can archive it on GitHub (read-only).

## 9. Staying on the free tier

The free plan (check the current numbers on supabase.com/pricing before deciding): about 500 MB database, 1 GB file
storage, 5 GB egress a month, 200 realtime connections at once, 2 million realtime messages a month, 50,000 monthly
users, **no downloadable backups**, and the project is **paused after a week without activity**.

For the first team of 6 to 8 people that leaves a lot of room:

| | Rough use with 8 people | Free limit |
| --- | --- | --- |
| Realtime connections | 8 people × 2 or 3 tabs = about 25 | 200 |
| Realtime messages | 8 × 100 changes a day × about 20 listening tabs = 16,000 a day, about 500,000 a month | 2,000,000 |
| Database | a few thousand issues with comments and history: tens of MB | 500 MB |
| Egress | depends mostly on how many issues every app start downloads (below) | 5 GB |

So the shared leader tab and leaving channels in hidden tabs are **not needed** now; they stay listed below as what to
do if the team grows.

### A daily backup that also keeps the project awake

`.github/workflows/backup.yml` in this repo (or a private one, see open questions):

```yaml
name: Back up the database
on:
  schedule:
    - cron: '17 3 * * *'      # every night
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest
    container: postgres:17      # pg_dump must match the server's Postgres 17
    steps:
      - name: Dump
        env:
          # the session pooler address (IPv4), from Project Settings › Database; stored as a repository secret
          DATABASE_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          pg_dump "$DATABASE_URL" --no-owner --no-privileges \
            --schema=public --schema=auth --schema=storage \
            --format=custom --file=sprawniej-$(date +%F).dump
      - name: Say hello through the API too, so the project counts as active
        run: curl -fsS "${{ secrets.SUPABASE_URL }}/rest/v1/" -H "apikey: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}" > /dev/null
      - uses: actions/upload-artifact@v4
        with:
          name: sprawniej-db-${{ github.run_id }}
          path: sprawniej-*.dump
          retention-days: 30
```

Pictures aren't in the dump. A weekly job copies the bucket through Storage's S3-compatible endpoint (`rclone sync`)
into the same place. A restore is tried once, into the local stack, before we go live, and written down in
`docs/architecture.md`.

### Keeping egress low

- **Load only what changed.** Each browser keeps a **read cache** of the workspace's rows in IndexedDB (not an offline
  mode: nothing can be changed without the server). Opening the app downloads only rows with a newer `changed_at` and
  the deletions since. Without it, every app start downloads all open issues: 2,000 issues are about 3 MB, and 8 people
  starting the app 10 times a day makes about 7 GB a month, over the limit. With a few hundred issues it wouldn't
  matter. Not needed while one person tests on localhost (stage A); it comes before the team starts (step 11 of the
  plan), so the first version of `load.ts` simply loads everything.
- **Archived issues, history and comments of archived issues load only when asked** (Archived tab, search, an issue
  page).
- **Realtime messages carry only the changed fields**, not whole rows (a status change doesn't resend the description).
- **If the team grows:** hidden tabs leave their channels after a few minutes and catch up when shown again, and the
  shared leader tab can come back for realtime. Not needed for 8 people.
- **Pictures** come through signed URLs that stay the same for a day, so the browser's cache serves them again.
- The description saves a moment after you stop typing, like the title, not on every key.
- `select` lists the columns it needs.

### Keeping the database small

Nightly jobs (section 4) archive, tidy inboxes and forget old deletions. `issue_events` store which fields changed,
never whole descriptions. Pictures stay at 10 MB at most; the editor could shrink big screenshots before uploading
(later).

## 10. CLAUDE.md changes and why this is 2.0.0

### Golden rules

| Today | After | Why |
| --- | --- | --- |
| Intro: "The workspace is a GitHub repo… There is no server of our own. Sign-in is a classic GitHub token." | "Workspaces live in a Supabase database; the app is still a static site on GitHub Pages. You sign in with GitHub, Google or email." | It isn't true any more. |
| No Save buttons, ever. | **Stays.** | Every change still saves by itself. |
| Every change goes through `src/data/actions.ts`. Components never write files, call git or set the store. | Every change goes through `src/data/actions.ts`, and **every call to Supabase lives in `src/backend/`**. | One path keeps "always saved" true, and one folder keeps the backend replaceable (PocketBase). |
| One file per thing, one writer per file. | **One row per thing. Things several people change at once (labels on an issue, team members, followers) are rows in a join table, never a list in a column. Saves send only the fields that changed.** | That is what keeps simultaneous changes from undoing each other now. |
| The repo format is a promise. MAJOR with a migration. Unknown fields survive (`.passthrough()`). | **The database schema is a promise.** It changes only through a new file in `supabase/migrations/` (never edit one that was applied). A change old app versions can't live with is MAJOR. Unknown fields survive in `extra`. | Same promise, new place. |
| The archive exception (packed month files). | Removed. | Archived issues are rows with `archived_at`. |
| Statuses and priorities are fixed. | **Stays**, plus: the SQL checks copy `src/model/status.ts`. | |
| Classic tokens only. No fine-grained tokens, no OAuth app, no proxy server. | **Sign in through Supabase Auth only. No server of our own besides Supabase: database rules, a few SQL functions, Edge Functions for webhooks.** | The old rule forbids exactly what we're doing. |
| No agents or AI features. | **Stays.** | |
| Code map: `src/github`, `src/sync`. | `src/backend` (all Supabase calls), `supabase/` (migrations, SQL tests, email templates, Edge Functions). | |
| Testing: sync tests on a throwaway repo; `window.sprawniej.sync`; two origins and two tabs. | Tests run against the local stack (`supabase start`), **never the real project**. `window.sprawniej.backend`. Two people = two browsers signed in as two test accounts; also test one person in two tabs, and a dropped connection. | |
| Never write a GitHub key into a file. | Never write a Supabase secret key, database password or GitHub key into a file. The publishable key and project URL may be in the build. | |
| Writing: screens never say commit, push, pull, merge, repo or token. | Also never say database, server, row, Supabase or sync. "Saved", "Can't save right now, we'll keep trying", "updated with your teammates' changes". | |

### Why it is a MAJOR release (2.0.0)

- **Where the data lives changes completely.** The repo format promise ends and a new one begins; old versions of the
  app can't read or save the new workspace, and the new app doesn't use the repo.
- **People's habits break.** Everyone signs in a new way, the GitHub key is gone, joining a workspace works
  differently, and a one-time move (section 8) has to happen before people can work.
- **Some behaviour changes on purpose:** new issues get their number from the server, simultaneous description edits
  no longer merge line by line, Sprawniej doesn't work offline any more, and history before the move stays on GitHub.

The changelog entry tells people what to do: "Sprawniej moved to its own home. Sign in again with GitHub, Google or
email; your workspace owner brings your work over once."

## 11. Step-by-step plan

Each step ends with something we can check. The work happens on a branch; `main` keeps serving today's version until
the switch.

**Building (local stack only)**

1. **Schema and settings in the repo.** `supabase/` with `config.toml`, the migrations from sections 2 to 5, a small
   `seed.sql`, pgTAP tests (members only, comment authors, inbox privacy, numbers under two parallel inserts, history
   rows, deletions, broadcasts, the import flag), and the runbook `docs/supabase-setup.md`. Done = `supabase db reset`
   builds everything from nothing, `supabase test db` passes, the advisors report nothing.
2. **`src/backend` and `rows.ts`.** Client, generated types, row mapping with tests (times, logins, `extra`). Done =
   `bun test`.
3. **Opening a workspace.** `load.ts` (loads everything for now) and `live.ts` with `applyRows` and its tests. Done = two
   browsers on the local stack see each other's changes within a second, and one that lost its connection catches up,
   including deletions.
4. **Saving.** `writes.ts`, `actions.ts` rewired function by function (issues, comments, labels, projects, views, teams,
   inbox, pictures, move to team, archive and restore). Done = `tests/actions.test.ts` updated and green; the whole app
   works against the local stack; the two-person table in docs/architecture.md checked by hand.
5. **Signing in, stage A.** Sign-in screen (GitHub, email and password), pick a login, choose or create a workspace,
   Settings › ways to sign in, sign out. Done = sign in both ways on the local stack and reach the workspace.
6. **History.** `issue_events` on the issue page. Done = the history test cases pass with event rows.
7. **The Linear import on rows** (section 8). Done = `tests/linearImport.test.ts` passes on rows; the real Linear
   project imports into the local stack with the same counts the check step promised (teams, issues, archived issues,
   comments, labels, projects, views); a second run changes nothing; a change made in Linear in between comes over on
   a third run.

**Stage A: solo on localhost, on the real project**

8. **Set up `sprawniejapp` with the runbook only**: `supabase link`, `db push`, a GitHub OAuth app, `config push`,
   `.env.local`. Anything the runbook missed gets added to it, not done by hand. Done = the app on localhost signs in
   against `sprawniejapp`.
9. **Import the real project's tasks from Linear and use them for a few days**, alone, from localhost. Keep a list of
   anything that behaves differently from today's app. Done = the list is empty or turned into fixes.
10. **Prove it repeats:** run the runbook on a second, throwaway free project (or a fresh account), import, sign in,
    then delete that project. Done = it works with no steps beyond the runbook.

**Before the team joins (stage B)**

11. **What a team needs:** invites and Settings › members and roles, the read cache (section 9), Google sign-in, our own
    email sender and templates with confirmations on, the backup workflow and picture backup, and a restore tried once
    into the local stack.
12. **Where the team opens it:** the public address in `config.toml` and `VITE_PUBLIC_URL` (see open question 2).
13. **Remove the old code** (`src/sync`, most of `src/github`, `src/data/project.ts`, old tests) and update
    docs/architecture.md, docs/data-format.md (becomes "the database"), docs/user-guide.md, Help, README, CLAUDE.md.
14. **Switch.** Release 2.0.0 (version, changelog, `package.json`, `bun scripts/changelog.ts`), a final re-import, the
    team signs in.

**Later**

- The GitHub workspace import (section 8), only if a team on today's GitHub version wants to move.

- The GitHub App and an Edge Function (`supabase/functions/github-webhook`) that moves issues when linked pull
    requests open or merge, writing as the person who opened the PR (`sprawniej.actor`) and reusing `notify.ts`. Its
    secrets go in through `supabase secrets set`, so it repeats with the runbook too.

## 12. Open questions

**Answered** (2026-10-19):

- *Is `sprawniej-test` the real home?* Yes, for this run: a copy of a real project's tasks, to prove everything works.
  The setup must repeat easily in other accounts (section 1).
- *How many people?* 6 to 8 for triage first: the free tier is plenty (section 9).
- *Where do the tasks come from?* Linear. The Linear import moves onto rows first; the GitHub workspace import waits
  until someone needs it (section 8).
- *Email sender and our own address?* Not now. Stage A runs from localhost with no email (section 6); both come back
  before the team joins.

**Still open:**

1. **Who opens it in stage B?** Today `main` deploys to GitHub Pages for the people using the GitHub version. Should
   2.0.0 replace that for everyone, or should the Supabase version live at a second address (another Pages site or a
   preview) while today's version keeps running for its users?
2. **Which public address** for stage B: GitHub Pages as now, or a custom domain? (Redirect URLs, email links and
   `VITE_PUBLIC_URL` follow from it.)
3. **Who may delete teams, labels and projects?** Today anyone can. Keep that, or only admins?
4. **Invites by email** (sent by Sprawniej), or links only, as today?
5. **Google sign-in in stage B:** for everyone with a Google account, or only company Google accounts (an "Internal"
   consent screen and a domain check)?
6. **History from Linear:** an issue's history before the import stays in Linear (proposed, as the import does today),
   or should it come over? Linear's API has it, at about one request per issue.
7. **Simultaneous description edits:** is "the later save wins for the whole description" acceptable, or should the
   line merge come back in the editor right away?
8. **Where do backups go?** GitHub Actions artifacts in this repo (30 days, visible to everyone with access to the
   repo), or a separate private repo, possibly encrypted?
9. **Login handles for Google and email sign-ups:** chosen by the person (proposed), or made from their email
    automatically?
10. **One workspace or several?** The design allows several per person, as today. Is there a reason to limit it to one
    (which would simplify sign-up to "anyone with a company address joins")?
11. **Inbox notes:** written by the app with the existing rules (proposed), or moved into the database as triggers (more
    robust, but the rules would live in SQL)?
