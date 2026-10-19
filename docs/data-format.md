# The database

Every workspace lives in one Supabase project: Postgres tables in the `public` schema (read and written by the app
through the API), helpers in `private` (never exposed through the API), a private Storage bucket for pictures and
three nightly jobs. This page describes all of it. The files in `supabase/migrations/` are the truth; keep this page in
step with them.

The schema is a promise: an older app must keep working against it, and a newer app must never lose what an older one
wrote.

## Changing the database

1. Write a **new** file in `supabase/migrations/`, named with a later timestamp than the newest one
   (`20261019000011_what_it_does.sql`). Never edit a file that was applied anywhere.
2. Apply it with the CLI: `bunx supabase db push` (`bunx supabase migration list --linked` shows what is applied).
   Never through the dashboard, the SQL editor or the MCP server's `apply_migration`: those don't record the file
   name, and the list of applied migrations stops matching the files.
3. Regenerate the types: `bunx supabase gen types typescript --linked --schema public`, into
   `src/backend/database.types.ts` below its two-line header.
4. Set `SCHEMA_ID` in `src/backend/cache.ts` to the new file's timestamp (`tests/cache.test.ts` checks it), so no
   browser reads a copy made for the old layout.
5. A new shared table: a row in `private.wiring` and `call private.wire('the_table')` in the migration, its keys in
   `KEYS` and `LIVE_TABLES` (`src/backend/tables.ts`), its columns in `src/backend/rows.ts` and in the column grants
   (`src/backend/changes.ts` keeps a copy). `tests/wiringList.test.ts` and `tests/db/wiring.test.ts` check the lists.
   A fixed list copied into SQL gets a marker comment (`-- @list …`) for `tests/statusLists.test.ts`.
6. `bun run test:db` on a development project (docs/supabase-setup.md), then the advisors (Dashboard, Advisors).
7. Update this page.

A change that older versions of the app can't live with is a MAJOR release, and the migration goes in before the app
that needs it is published.

## Common columns

- **Ids.** Issues, comments, labels, projects, views and inbox notes have text ids the app makes:
  [ULIDs](https://github.com/ulid/spec), random and sortable by time, so a new row shows before it is saved. Issues
  that came from Linear keep Linear's id. Workspaces, profiles, teams and invites have uuids the database makes.
- **`workspace_id`** on every shared row: the workspace it belongs to. Every policy starts from it.
- **`changed_at`**: set by the `a_stamp` trigger on every insert and update (`clock_timestamp()`, to the
  microsecond), whatever the browser sent. Catching up asks for rows changed after a mark, and newer wins per column
  (`src/backend/rows.ts` keeps it exact; it never goes through `toISOString`).
- **`extra`** (jsonb, `{}` by default): the app's fields that have no column of their own. `rows.ts` puts unknown
  fields here and reads them back (schemas use `.loose()`), so a field a newer app adds survives an older app's
  write.
- **`linear_id`**: the row's id in Linear, for rows the Linear import brought (teams, labels, projects, issues,
  comments, views). Unique per workspace, written only by `import_rows`, so a second import updates instead of
  copying (docs/linear-import.md).
- **Times** are `timestamptz`. The database sends `2026-10-19T12:28:00.816096+00:00`; `rows.ts` turns every time but
  `changed_at` into the app's `2026-10-19T12:28:00.816Z`.

Rows point at people by profile id and at teams by team id. The app uses logins and team keys instead;
`src/backend/rows.ts` turns one into the other with the registry (`src/backend/registry.ts`). The model names are
given below in brackets.

## Tables

### workspaces

`id`, `name` (not blank), `created_by` (profile), `created_at`, `changed_at`, `extra`. Made by `create_workspace()`.
Admins and owners rename it; only owners delete it (everything in it goes with it).

### profiles

A person: someone with an account, or a person from Linear who hasn't joined (a guest).

| Column | Meaning |
| --- | --- |
| `id` | uuid |
| `user_id` | the sign-in account (`auth.users`); null for a guest |
| `login` (`login`) | the @handle: letters, digits and dashes, up to 39, not starting with a dash (`private.valid_login`). Unique among people with accounts, case aside. A guest's starts with `~` and is unique within its workspace. Never changes. |
| `github_id` (`githubId`) | set when the profile was made from a GitHub sign-in; unique |
| `name`, `avatar_url` (`name`, `avatarUrl`) | what teammates see |
| `name_set_here` (`nameSetHere`) | they typed their name in Sprawniej, so GitHub's doesn't replace it |
| `guest_of` | for a guest: their workspace |
| `linear_ids` (`linearIds`) | the Linear people this profile stands for, so later imports match them |

Made by `ensure_profile()` or `create_profile()` (accounts) and `import_rows` (guests). You see yourself, everyone who
is or was in a workspace you are in now, and those workspaces' guests. You change your own `name`, `avatar_url`,
`name_set_here` and `extra`.

### workspace_members

`workspace_id`, `profile_id`, `role` (`owner`, `admin` or `member`), `joined_at`, `removed_at` (left or removed; the
name still shows on old work), `changed_at`. Read by the workspace's members (model: `members`, by login). Joining is
`accept_invite()` (or `create_workspace()` for its owner), leaving `leave_workspace()`. Admins and owners update
`role` and `removed_at`, within what `guard_members` and `keep_an_owner` allow (Triggers, below).

### invites

`id`, `workspace_id`, `token` (36 random hex digits), `for_login` (no longer written), `for_email` (so the admin
remembers where to send it), `for_profile` (a guest: whoever accepts becomes them; set to null when the guest goes),
`role` (`admin` or `member`), `invited_by` (set by a trigger), `created_at`, `expires_at` (14 days by default, at most
30 after `created_at`), `accepted_by`, `accepted_at`. Only the workspace's admins and owners see and change them; an
invite for a guest must name a guest of that workspace. Never broadcast.

### teams

`id` (uuid), `workspace_id`, `key` (a capital letter, then up to six capitals or digits; unique per workspace; never
changes), `name`, `emoji`, `last_number` (`lastNumber`: the highest number ever given out, see Issue numbers),
`auto_archive` (`autoArchive`: months after which finished issues are archived; 0 never; 6 by default), `linear_id`,
`created_at`, `changed_at`, `extra`. Members add and change teams; only admins and owners delete them (with their
issues, comments and views).

### team_members

`workspace_id`, `team_id`, `profile_id`, `changed_at` (model: `team.members`). Members add and delete rows; the person
must belong to the workspace.

### labels

`id`, `workspace_id`, `name` (unique per workspace, case aside), `color`, `linear_id`, `changed_at`, `extra`.

### projects

`id`, `workspace_id`, `name`, `emoji`, `description`, `status` (`backlog`, `planned`, `in_progress`, `paused`,
`completed`, `canceled`), `lead_id` (`lead`), `target_date` (`targetDate`, a day), `linear_id`, `created_at`,
`changed_at`, `extra`.

### project_teams

`workspace_id`, `project_id`, `team_id`, `changed_at` (model: `project.teams`, by key).

### issues

| Column | Meaning |
| --- | --- |
| `id` | text, 10 to 40 characters |
| `team_id` (`team`) | its team; changed only by `move_issue_to_team()` |
| `number` (`number`) | given out by the `b_number` trigger; unique per team; shown as `ENG-12` |
| `title`, `description` | the description is Markdown |
| `status` | `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`, `duplicate` (`src/model/status.ts`) |
| `priority` | `0` none, `1` urgent, `2` high, `3` medium, `4` low |
| `assignee_id` (`assignee`) | a person of the workspace, or null |
| `project_id`, `parent_id` (`project`, `parent`) | null when none; `parent` makes it a sub-issue |
| `due_date` (`dueDate`) | a day, with no time: the same day for everyone |
| `estimate` | points; the app offers 1, 2, 3, 5 and 8 and keeps any other number |
| `sort_order` (`sortOrder`) | its place in lists and boards, a fractional index (compared byte by byte) |
| `duplicate_of` (`duplicateOf`) | for `duplicate` |
| `former_refs` (`formerRefs`) | the numbers it had before moving teams (`{WEB-2}`); old links and mentions find it |
| `created_by` (`createdBy`), `created_at`, `updated_at`, `completed_at` | set by the `a_stamp` trigger (`issue_times`); `completed_at` when it becomes Done |
| `archived_at`, `archived_by` (`archivedAt`, `archivedBy`) | archived: the trigger sets the time and who; null brings it back |
| `linear_id`, `changed_at`, `extra` | see Common columns |

`updated_at` is "last changed" as people see it: any field above, and a restore. Changing followers or labels doesn't
touch it. Deleting an issue deletes its labels, followers, comments, inbox notes and history; its sub-issues lose
their parent.

### issue_labels

`workspace_id`, `issue_id`, `label_id`, `changed_at` (model: `issue.labels`). Added and deleted, never changed.

### issue_followers

`workspace_id`, `issue_id`, `profile_id`, `following`, `changed_at`. `following = true` is someone who asked to follow
the issue (`subscribers`), `false` someone who asked not to (`unsubscribed`). People also follow without a row: the
creator, the assignee, commenters and everyone mentioned (`src/data/notify.ts`).

### comments

`id`, `workspace_id`, `issue_id` (`issue`), `author_id` (`author`, set by a trigger), `body` (Markdown, not blank),
`created_at`, `edited_at` (set when the body changes), `linear_id`, `changed_at`, `extra`. Everyone in the workspace
reads and adds; only the author edits or deletes, while still a member.

### views

`id`, `workspace_id`, `team_id` (`team`; null: a workspace view), `owner_id` (`owner`, set by a trigger), `name`,
`emoji`, `description`, `filters`, `display`, `created_at`, `linear_id`, `changed_at`, `extra`. A view belongs to
everyone: any member changes it. `filters` and `display` hold logins and team keys, as the app uses them:

```json
{
  "filters": { "statuses": ["todo", "in_progress"], "labels": ["01J9…"], "assignees": ["ania-k", null] },
  "display": { "layout": "board", "grouping": "status", "ordering": "priority", "showCompleted": false, "showSubIssues": true }
}
```

Filters left out match everything. Filters: `statuses`, `assignees` (`null` = no one), `subscribers` (people
following the issue), `priorities`, `labels` (ids), `projects` (ids; `null` = none), `teams` (keys). Inside one filter
any value matches; different filters must all match. `grouping`: `status`, `assignee`, `priority`, `project`, `none`.
`ordering`: `manual`, `priority`, `due`, `updated`, `created`. `layout`: `list`, `board`. `move_person` swaps logins
inside `assignees` and `subscribers` when a guest is linked.

### inbox

One note for one person. `id`, `workspace_id`, `recipient_id`, `actor_id` (`actor`, set by a trigger), `type`
(`assigned`, `mentioned`, `commented`, `status`), `issue_id` (`issue`), `comment_id` (`comment`: for `commented`, and
`mentioned` in a comment), `status` (for `status`: the new status), `at`, `read_at` (`readAt`, read one by one),
`changed_at`, `extra`. Written by whoever caused it (`actor_id` must be you), read, marked and deleted only by its
recipient. Deleting the issue or the comment deletes the note.

### read_state

One row per person and workspace: `profile_id`, `workspace_id`, `read_until` (`readUntil`: "Mark all as read", every
note up to then counts as read), `changed_at`, `extra`. Yours only. The one table written with an upsert, so you may
write every column.

### issue_events

The history, written only by triggers. `id` (a growing number), `workspace_id`, `issue_id`, `actor_id` (null: nobody
was signed in, such as the nightly archive), `at`, `changes`:

```json
{ "status": ["todo", "in_progress"], "assignee": [null, "<profile id>"], "title": ["Old", "New"],
  "description": true, "labels": { "added": ["01J…"] }, "team": ["WEB-2", "ENG-14"], "archived": true }
```

Each changed field is `[before, after]` (`title`, `status`, `priority`, `assignee`, `project`, `parent`, `dueDate`,
`estimate`); `description` only says it changed; `labels` is `{"added": [id]}` or `{"removed": [id]}`; `team` is the
old and new reference; `archived` or `restored` is `true`. `src/data/history.ts` turns them into lines.

### issue_numbers

`workspace_id`, `team_id`, `number`: every number a team ever gave out, filled by the number trigger and never emptied
(a deleted or moved issue leaves its number here). Members read it; nobody writes it.

### deletions

`id`, `workspace_id` (no foreign key: the rows outlive what they describe), `table_name`, `row_key` (the deleted row's
keys: `{"id": "…"}` or `{"issue_id": "…", "label_id": "…"}`), `deleted_at`. Written by the `forget` trigger for every
deleted shared row, cascades included, so a browser that catches up drops them too. Kept 45 days. A workspace that is
deleted leaves none.

### private.guest_emails

`profile_id` (a guest), `email`: the email a person from Linear had there. Never sent to browsers; admins read their
workspace's with `guest_emails()` and set them with `set_guest_email()`.

## Functions the app calls

Each runs as its owner (security definer), checks who is calling, and raises errors in plain words with a code the app
tells apart: `42501` not allowed, `P0002` not there, `23505` already taken, `23503` no such team, `22023` not valid,
`23514` a workspace needs an owner, `SP001` you already have a name, `SP002` the invite was used, `SP003` it expired,
`SP010` an import the database can't take (the detail says why). `src/backend/problem.ts` shows those messages as they
are and puts everything else in our own words.

| Function | Who | What it does |
| --- | --- | --- |
| `ensure_profile()` | signed in | Your profile; or a profile with your GitHub id that nobody has claimed; or a new one with your GitHub login when it's free. No rows: pick a name. |
| `create_profile(login, name)` | signed in, once | Your profile with the @handle you picked. |
| `create_workspace(name, team_key, team_name, team_emoji)` | with a profile | A workspace with you as owner, and a first team with you in it. |
| `invite_info(token)` | anyone, also not signed in | What the join page shows (see invites); the workspace id only to someone already in it. |
| `accept_invite(token)` | with a profile | Makes you a member (or brings you back), marks the invite used, turns an invited guest into you. |
| `leave_workspace(workspace)` | a member | You leave. The last owner can't. |
| `move_issue_to_team(issue, team)` | a member | Moves an issue to another team: a new number there, the old one in `former_refs`. |
| `link_person(workspace, guest, to)` | admins | This person from Linear is that member: everything moves over (`move_person`). |
| `set_guest_email(profile, email)` | admins | Keeps (or, empty, forgets) a guest's email. |
| `guest_emails(workspace)` | admins | The workspace's guests' emails. |
| `import_rows(workspace, table, rows)` | admins | Up to 1000 rows of one table, inserted or updated quietly (below). |

`import_rows` takes `profiles` (guests), `teams`, `team_members`, `labels`, `projects`, `project_teams`, `issues`,
`issue_labels`, `issue_followers`, `comments` and `views`, with the columns `private.import_spec` lists. Whatever the
rows say, they land in the given workspace; a row whose key is used in another workspace is refused, and so is a
person who isn't in the workspace. It keeps the numbers and times that came with the rows, writes no history, sends
no broadcast per row (one "catch up" message instead), never changes a comment written here, and a second run with the
same rows changes nothing. The caller sends the same columns in every row of a batch and every required column even
for rows that will only be updated (Postgres checks the proposed row before it finds the conflict).

## Private helpers

- `private.wiring`: the one list of shared tables, with their keys, workspace column, broadcast topic, standard
  policies, stamp trigger and whether deleting leaves a note. `private.wire(table)` sets a table up from it.
- `private.import_spec`: what `import_rows` may write per table.
- Who is asking: `my_profile_id()`, `my_workspaces()` (now, not the ones left), `my_admin_workspaces()`,
  `my_owner_workspaces()`, `my_people()`, `belongs(person, workspace)`, `actor_id()`.
- `valid_login`, `is_completed`, `take_number`, `swap_login`, `move_person`, and the nightly jobs.
- Three settings change what triggers do within one transaction: `sprawniej.importing` (imports and `move_person`:
  no history, no broadcast per row, keep the times and numbers that came), `sprawniej.trusted` (`accept_invite` and
  `leave_workspace`: skip the role guard) and `sprawniej.actor` (who the service role, the SQL editor or a job acts
  for). No function the browser calls puts its input into them.

New functions are closed by default: nobody runs one unless a migration grants it by name.

## Triggers

"Before" triggers on one event run in name order, hence the `a_`, `b_`, `c_` names.

- `a_stamp` on every table `private.wiring` gives a stamp (all but invites, history, used numbers and deletions): `changed_at` (`touch`); on issues also authors, times and who archived
  (`issue_times`); on comments the author and `edited_at` (`comment_times`). Imports keep the times they bring.
- `a_author` on views (`owner_id`), inbox (`actor_id`) and invites (`invited_by`): whoever is signed in.
- `b_number` on issues: the next number of the team (Issue numbers in docs/architecture.md).
- `c_check_note` on inbox: drops a note for someone who isn't a member now or for yourself, and a repeat of the same
  note about the same issue from the same person within ten minutes (notes about a comment always go).
- `c_people` on team members, issues (assignee), followers and projects (lead): the person must belong to the
  workspace (a member now or before, or one of its guests).
- `history` on issues and issue labels: writes `issue_events`.
- `forget` on every table marked in `private.wiring`: writes `deletions`.
- `live` on every broadcast table: Realtime (below).
- `a_guard` on workspace members: only an owner makes, unmakes or removes owners; nobody but an owner changes their
  own role; someone who left comes back only through an invite.
- `keep_an_owner` on workspace members: refuses a change that leaves the workspace without an owner (changes that
  could wait for each other on a lock per workspace).

## Rules (RLS) and column grants

Row-level security is on for every table. Not-signed-in visitors (`anon`) can read and write nothing; they may only
call `invite_info`. Signed-in people read a workspace's rows while they are a member of it, and the standard policies
let them add, change and delete them, except:

- teams: only admins and owners delete;
- comments: only the author edits and deletes, while a member;
- inbox: you read, mark and delete your own notes; you add notes only as their actor;
- read_state: yours only;
- workspaces: admins and owners rename, owners delete; creating is `create_workspace()`;
- workspace_members: admins and owners change roles and remove people;
- invites: admins and owners only;
- profiles: see the profiles table;
- issue_events, issue_numbers, deletions: read only.

On top of that, **column grants** list what people may write; everything else is filled in by the database
(`changed_at`, numbers, authors, times, `linear_id`). For example, issues take `title`, `description`, `status`,
`priority`, `assignee_id`, `project_id`, `parent_id`, `due_date`, `estimate`, `sort_order`, `duplicate_of`,
`archived_at` and `extra` on update, but not `team_id` or `number`. The full list is in
`supabase/migrations/20261019000005_rls.sql`, with a copy in `src/backend/changes.ts`.

## Realtime

Two private channels per open workspace: `ws:<workspace id>` for every shared table, and `me:<profile id>` for your
inbox notes and read marks. You may listen to `ws:` while you are a member, and to your own `me:`; browsers can't send
on either. Each message has the event `change` and

```json
{ "table": "issues", "op": "UPDATE", "row": { "id": "01J…", "status": "done", "changed_at": "…" } }
```

An `INSERT` sends the whole row, an `UPDATE` only the columns that changed plus the keys and `changed_at` (nothing at
all when only a team's counter changed), a `DELETE` the keys. A row over 200 kB comes without `description` or `body`
and with `"partial": true`; the app fetches it. A profile's change goes to every workspace the person is (or was) in.
Imports and `move_person` send `{"op": "catch_up"}` (with `"table"` for imports) once per batch instead. Invites,
history, used numbers and deletions are never broadcast. Access is checked when a browser joins, so someone removed
keeps hearing a workspace until they reconnect.

## Pictures

The bucket `pictures` is private, takes PNG, JPEG, GIF and WebP up to 10 MB, and keeps files as
`<workspace id>/<name>`, where the name is the first 24 hex digits of the picture's SHA-256 and its ending
(`3f2a…c1.png`). The Markdown says `/assets/<name>`. Members of the workspace see and add its pictures (the first
folder decides); nobody changes or deletes one. The database can't empty storage, so a reset keeps the bucket and its
files.

## Nightly jobs

| When (UTC) | Job | What it does |
| --- | --- | --- |
| 02:17 | `sprawniej-auto-archive` | Archives Done, Canceled and Duplicate issues untouched (the later of `completed_at` and `updated_at`) for longer than their team's `auto_archive` months |
| 02:27 | `sprawniej-tidy-inboxes` | Deletes read notes older than 30 days and unread ones older than 90 |
| 02:37 | `sprawniej-forget-deletions` | Deletes `deletions` rows older than 45 days |
