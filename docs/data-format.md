# The database

Every workspace lives in one Supabase project: Postgres tables in the `public` schema (read and written by the app
through the API), helpers in `private` (never exposed through the API), a private Storage bucket for pictures and
four nightly jobs. This page describes all of it. The files in `supabase/migrations/` are the truth; keep this page in
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
   A fixed list copied into SQL gets a marker comment (`-- @list …`, `-- @seed …`) for `tests/statusLists.test.ts`.
   A new function the app calls: `grant execute … to authenticated` in the migration, a row in the functions table
   below, and if the writer sends it as a change, a case of `Call` (`src/backend/changes.ts`) and the same function in
   the pretend database (`tests/support/fakeDb.ts`). A rule the app also works out itself (like finding checklist
   items) gets shared test cases in `tests/fixtures`, run against both.
6. `bun run test:db` on a development project (docs/supabase-setup.md), then the advisors (Dashboard, Advisors).
7. Update this page.

A change that older versions of the app can't live with is a MAJOR release, and the migration goes in before the app
that needs it is published.

## Common columns

- **Ids.** Issues, comments, labels, projects, views and inbox notes have text ids the app makes:
  [ULIDs](https://github.com/ulid/spec), random and sortable by time, so a new row shows before it is saved. Issues
  that came from Linear keep Linear's id. Workspaces, profiles, teams and invites have uuids. The database makes
  them, except team ids, which the app (a new team) and the import may send so the team shows at once.
- **`workspace_id`** on every shared row: the workspace it belongs to. Most policies start from it; the ones for the
  inbox, read marks, profiles and workspaces start from you or from the workspace's own id (Rules, below).
- **`changed_at`**: set by the `a_stamp` trigger on every insert and update (`clock_timestamp()`, to the
  microsecond), whatever the browser sent. Catching up asks for rows changed after a mark, and newer wins per column
  (`src/backend/rows.ts` keeps it exact; it never goes through `toISOString`).
- **`extra`** (jsonb, `{}` by default): the app's fields that have no column of their own. The app's types come from
  zod schemas (`src/model/schema.ts`), but nothing parses rows at runtime: `src/backend/rows.ts` puts every field it
  doesn't know (anything not in its `KNOWN` lists) here and reads it back, so a field a newer app adds survives an
  older app's write.
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

A person, one of three kinds:

- someone with an account (`user_id` set);
- a person from Linear who hasn't joined (a guest: `guest_of` set, no account);
- a profile with no account yet that waits to be claimed (`user_id` and `guest_of` both null, `github_id` set):
  the first GitHub sign-in with that GitHub id takes it over (`ensure_profile()`). Sprawniej makes none of these
  today; they are for people brought from an older workspace.

| Column | Meaning |
| --- | --- |
| `id` | uuid |
| `user_id` | the sign-in account (`auth.users`); null for a guest |
| `login` (`login`) | the hidden key everything points at (filters, history, assignees, the app's `people`): letters, digits and dashes, up to 39, not starting with a dash (`private.valid_login`). Unique among people with accounts, case aside. A guest's starts with `~` and is unique within its workspace. Never changes. It is also the @handle until the person picks another; someone who signs up with a handle that is only another person's login (they moved off it) gets a login of their own instead, the handle with a short random ending (`create_profile()`). |
| `handle` (`handle`) | the @handle the person changed to (`set_handle()`); null: the same as `login`. Same rule as a login; a guest has none. What people see, `coalesce(handle, login)`, is unique among people with accounts, case aside (`profiles_handle`). Nothing is kept for anyone: once someone moves off a handle (or off their login), anyone may take it as their handle. The app reads it only when it isn't the login. |
| `github_id` (`githubId`) | set when the profile was made from (or waits for) a GitHub sign-in; unique |
| `name`, `avatar_url` (`name`, `avatarUrl`) | what teammates see |
| `name_set_here` (`nameSetHere`) | they typed their name in Sprawniej, so GitHub's doesn't replace it |
| `contact_email` (`contactEmail`) | the contact email they show teammates (profile_emails, below), or null for none. Filled by the database only (`show_email()` and the triggers on profile_emails); nobody may write it. The app reads it only when it isn't null and never sends it. |
| `guest_of` | for a guest: their workspace |
| `linear_ids` (`linearId`, `linearIds`) | the Linear people this profile stands for, so later imports match them. A guest has one, shown to the app as `linearId`. An account gets them when a guest is linked to it or joins through a guest's invite (`move_person`); the app shows `linearIds` only when there are any. |

Made by `ensure_profile()` or `create_profile()` (accounts) and `import_rows` (guests). You see yourself, everyone who
is or was in a workspace you are in now, and those workspaces' guests. You change your own `name`, `avatar_url`,
`name_set_here` and `extra`, and your `handle` through `set_handle()` only. Everyone who sees a profile sees its
`contact_email`, people who were in a workspace with the person before included, so they see later changes too.

### profile_emails

A person's contact emails: up to 5 emails teammates may write to. How they sign in doesn't change, and nothing here
reads the sign-in email. Nobody checks these addresses and nothing is sent to them.

| Column | Meaning |
| --- | --- |
| `id` | uuid |
| `profile_id` | whose it is; set by a trigger (the person signed in), never sent by the browser (its default, `my_profile_id()`, only lets the generated types leave it out) |
| `email` | trimmed, case kept as typed, up to 254 characters, shaped like `name@domain.tld` with no spaces (`private.valid_email`, the same rule as `EMAIL_PATTERN` in `src/model/contactEmail.ts`). The same email twice for one person is refused, case aside; two people may use the same one. |
| `visible` | the one teammates see; at most one per person. Changed only by `show_email()`. A new email starts hidden. |
| `created_at`, `changed_at` | when it was added and last changed |

Only its owner reads, adds, changes (the `email`) and deletes them. Not in `private.wiring`: it belongs to a person,
not a workspace, so it isn't loaded with a workspace, kept in the browser's copy or broadcast. The app reads it with
awaited calls (`src/backend/profiles.ts`). The shown one is copied onto `profiles.contact_email`, and teammates get it
from there: editing the shown one's text changes the copy, deleting it clears the copy (teammates see none). A
sixth one is refused (`23514`, "You can keep up to 5 emails. Remove one first."), under a lock on the person's
profile, so two adds at once can't both take the last place. Locks are always taken in one order, the person's email
rows first and then their profile row, so two tabs can't wait for each other. The rows go with the profile, and with
the account: when an account is deleted its profile stays (`user_id` becomes null, so the name stays on old work), but
its contact emails are deleted and `contact_email` is cleared in the same change (the `account_gone` triggers). A later
GitHub sign-in that claims that profile starts with an empty list. Guests can't have any;
their emails from Linear stay in `private.guest_emails`, separate and for admins only.

### workspace_members

`workspace_id`, `profile_id`, `role` (`owner`, `admin` or `member`), `joined_at`, `removed_at` (left or removed; the
name still shows on old work), `changed_at`. Read by the workspace's members (model: `members`, by login). Joining is
`accept_invite()` (or `create_workspace()` for its owner), leaving `leave_workspace()`. Admins and owners update
`role` and `removed_at`, within what `guard_members` and `keep_an_owner` allow (Triggers, below).

### invites

`id`, `workspace_id`, `token` (36 random hex digits), `for_login` (the app doesn't write it, but people may still
write it and `invite_info` still returns it), `for_email` (so the admin
remembers where to send it), `for_profile` (a guest: whoever accepts becomes them; set to null when the guest goes),
`role` (`admin` or `member`), `invited_by` (set by a trigger), `created_at`, `expires_at` (14 days by default, at most
30 after `created_at`), `max_uses` (how many people may join with it: `1`, the default, is one person, up to `1000`,
or null for anyone with the link; an invite for a guest is always `1`), `ended_at` (an admin ended it early with
`end_invite`; it can't be undone), `accepted_by`, `accepted_at` (set only for a link for one person, when it is
accepted). Only the workspace's admins and owners see them, and change `for_login`, `for_email`, `role` and
`expires_at`; `max_uses` is set when the link is made, `ended_at` only by `end_invite`. An invite for a guest must name
a guest of that workspace. Never broadcast.

A link is, in this order (`private.invite_state`, one rule for joining, the join page and new accounts):
`used` (a link for one person that was accepted), `ended`, `full` (as many people joined as `max_uses` allows),
`expired`, `left` (it was made before you left the workspace or were removed: coming back takes a newer link) or
`open`.

What someone holding the link sees comes from `invite_info(token)`, one row (none for an unknown token):
`workspace_id` (only to someone already in it), `workspace_name`, `invited_by_name`, `invited_by_login` (their
@handle now), `invited_by_avatar`, `for_login` and `for_name` (the guest's name, for an invite made for one), `role`,
`state` (`member`: you're already in, or one of the states above) and `people` (up to 8 names and pictures of
members, as `[{"name", "avatarUrl"}]`). Only an `open` link, or one for someone already in, gives `people`,
`for_login` and `for_name`. Never the token, never an email.

### invite_uses

Who joined with which link, one row per person: `invite_id`, `workspace_id`, `profile_id`, `at`. Written only by
`accept_invite` (someone already in writes none); the migration that made the table wrote one for every invite
accepted before whose person is still here (one whose profile was deleted has none, and stays used through
`accepted_at`). Admins and owners read them; nobody writes, changes or deletes one. Deleting an invite deletes its
rows, and so does deleting the person's profile. Never broadcast.

### teams

`id` (uuid), `workspace_id`, `key` (a capital letter, then up to six capitals or digits; unique per workspace; never
changes), `name`, `emoji`, `last_number` (`lastNumber`: the highest number ever given out, see "Issue numbers" in docs/architecture.md),
`auto_archive` (`autoArchive`: months after which finished issues are archived; 0 never; 6 by default), `linear_id`,
`created_at`, `changed_at`, `extra`. Members add and change teams; only admins and owners delete them (with their
issues, comments and views).

### team_members

`workspace_id`, `team_id`, `profile_id`, `changed_at` (model: `team.members`). Members add and delete rows; the person
must belong to the workspace.

### labels

`id`, `workspace_id`, `name` (unique per workspace, case aside), `color`, `linear_id`, `changed_at`, `extra`.

### statuses

The workspace's own statuses: a name and a colour within one fixed **category** (docs/architecture.md, "Categories
and statuses"). Shared by every kind of thing that has a status: `kind` says which (`issue` or `project`).

| Column | Meaning |
| --- | --- |
| `id` | text, 10 to 40 characters: a ULID from the app, a uuid for the ones a workspace starts with |
| `kind` | `issue` or `project`; never changes |
| `category` | one of the kind's fixed categories (issues: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`, `duplicate`; projects: as `projects.status`); never changes |
| `name` | 1 to 40 characters, not blank; unique per workspace and kind, case aside (hidden ones too; an issue status and a project status may share one) |
| `color` | `#rrggbb`, lower case (the app offers `STATUS_COLORS`: two greys and the label colours) |
| `position` | its place within its category, a fractional index (compared byte by byte) |
| `hidden` | not offered when picking; things that have it keep it and show it |
| `changed_at`, `extra` | see Common columns |

Statuses show in category order, then by `position`, then by `id`. The **default status** of a category is its first
shown one: where an issue or a project lands when only its category is known (an older version of the app, GitHub,
the import). Every workspace starts with one per category, named and coloured as before: seven for issues, six for
projects (Backlog, Planned, In progress, Paused, Completed, Canceled), from `private.status_defaults`, copied by the
`seed_statuses` trigger when a workspace is made, also by an older app. Every member adds and changes them (`name`,
`color`, `position`, `hidden`, `extra`); nobody deletes one, and each category keeps at least one shown status
(`c_keep_a_status`, `23514`: "Each group needs at least one status that isn't hidden. Add or show another one
first."). Broadcast on `ws:`.

### projects

| Column | Meaning |
| --- | --- |
| `id`, `workspace_id`, `name`, `emoji`, `description` | as their names say |
| `status` | its **category**, one of `backlog`, `planned` (the column default), `in_progress`, `paused`, `completed`, `canceled`: what decides something (grouping issues by project leaves out completed and canceled ones). Older apps read and write only this |
| `status_id` (`statusId`) | its status, one of the workspace's project statuses of that category; never null. Kept in step with `status` by the `a_category` trigger (below) |
| `sort_order` (`sortOrder`) | its place in its board column, a fractional index (compared byte by byte, collate "C"); null for a project an older app made, which shows after the others, by name, until someone drops a project next to it |
| `lead_id` (`lead`), `target_date` (`targetDate`, a day) | null when none |
| `linear_id`, `created_at`, `changed_at`, `extra` | see Common columns |

The app sends `status_id` and not `status` (the database fills it in); only while the workspace's statuses aren't
loaded yet does it send `status` alone. Issues send both (`status` when the category changes); either way the trigger
keeps them in step. When the project statuses came
(`20261021180000_project_statuses.sql`), every project got the status of its category, and `sort_order` in name order
per workspace (`a0` … `az`, `b10` …), so each column started in the order the list showed.

### project_teams

`workspace_id`, `project_id`, `team_id`, `changed_at` (model: `project.teams`, by key).

### issues

| Column | Meaning |
| --- | --- |
| `id` | text, 10 to 40 characters |
| `team_id` (`team`) | its team; changed only by `move_issue_to_team()` |
| `number` (`number`) | given out by the `b_number` trigger; unique per team; shown as `ENG-12` |
| `title`, `description` | the description is Markdown; ticking a checklist item in it goes through `set_checklist_item()` |
| `status` | its **category**: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`, `duplicate` (`src/model/status.ts`). Whatever decides something (tabs, `completed_at`, the nightly archive, GitHub) reads this |
| `status_id` (`statusId`) | its status, one of the workspace's issue statuses of that category; never null. Kept in step with `status` by the `a_category` trigger (below) |
| `priority` | `0` none, `1` urgent, `2` high, `3` medium, `4` low |
| `assignee_id` (`assignee`) | a person of the workspace, or null |
| `project_id`, `parent_id` (`project`, `parent`) | null when none; `parent` makes it a sub-issue |
| `due_date` (`dueDate`) | a day, with no time: the same day for everyone |
| `estimate` | points; the app offers 1, 2, 3, 5 and 8 and keeps any other number |
| `sort_order` (`sortOrder`) | its place in lists and boards, a fractional index (compared byte by byte) |
| `duplicate_of` (`duplicateOf`) | for `duplicate` |
| `former_refs` (`formerRefs`) | the numbers it had before moving teams (`{WEB-2}`); old links and mentions find it |
| `created_by` (`createdBy`), `created_at`, `updated_at`, `completed_at` | set by the `a_stamp` trigger (`issue_times`); `completed_at` when its category becomes Done (Done to another done status keeps it) |
| `archived_at`, `archived_by` (`archivedAt`, `archivedBy`) | archived: the trigger sets the time and who; null brings it back |
| `linear_id`, `changed_at`, `extra` | see Common columns |

`updated_at` is "last changed" as people see it. The trigger moves it only when one of these changes: `title`,
`description`, `status`, `status_id`, `priority`, `assignee_id`, `project_id`, `parent_id`, `due_date`, `estimate`, `sort_order`,
`duplicate_of`, `team_id` or `extra`, and on a restore. Archiving, `former_refs`, followers and labels don't touch it. Deleting an issue deletes its labels, followers, comments, pull requests, inbox notes and history; its sub-issues lose
their parent.

### issue_labels

`workspace_id`, `issue_id`, `label_id`, `changed_at` (model: `issue.labels`). Added and deleted, never changed.

### issue_followers

`workspace_id`, `issue_id`, `profile_id`, `following`, `changed_at`. `following = true` is someone who asked to follow
the issue (`subscribers`), `false` someone who asked not to (`unsubscribed`). People also follow without a row: the
creator, the assignee, commenters and everyone mentioned (`src/data/notify.ts`).

### issue_pull_requests

The GitHub pull requests that mention an issue, shown under its title (model: `pullRequests`, by issue id, in the
store; docs/github-app.md): `workspace_id`, `issue_id`, `pull_request_id` (GitHub's number for the pull request, as
text), `repo` (`owner/name`), `number`, `title` (up to 300 characters), `url`, `state` (`open`, `draft`, `merged` or
`closed`), `author_id` (the member who opened it; set null if their profile goes), `github_updated_at` (GitHub's time
for this state), `created_at`, `changed_at`. Key: `issue_id` and `pull_request_id`. Members read them; **only
`github_apply` writes them**, so there is no write grant and no other policy. A row is kept only when the pull
request's author is a member with GitHub (the same rule as moving issues). An older delivery never replaces a newer
state, and a pull request that no longer mentions an issue (a ref taken out of its title) leaves it, unless the issue
is archived. Broadcast on `ws:`, leaves deletion notes, read with the issue (open or archived) it belongs to.

### comments

`id`, `workspace_id`, `issue_id` (`issue`), `author_id` (`author`, set by a trigger), `body` (Markdown, not blank),
`created_at`, `edited_at` (set when the body changes), `linear_id`, `changed_at`, `extra`. Everyone in the workspace
reads and adds; only the author edits or deletes, while still a member.

### views

`id`, `workspace_id`, `team_id` (`team`; null: a workspace view), `owner_id` (`owner`, set by a trigger), `name`,
`emoji`, `description`, `filters`, `display`, `created_at`, `linear_id`, `changed_at`, `extra`. Unique by
`(workspace_id, id)` too, so favourites can point at a view within its workspace. A view belongs to everyone: any
member changes it. `filters` and `display` hold logins and team keys, as the app uses them:

```json
{
  "filters": { "statuses": ["todo", "in_progress"], "statusIds": ["01JT…"], "labels": ["01J9…"], "assignees": ["ania-k", null] },
  "display": { "layout": "board", "grouping": "status", "ordering": "priority", "showCompleted": false, "showSubIssues": true }
}
```

Filters left out match everything. Filters: `statuses` (categories), `statusIds` (a refinement: within a category in
`statuses` that one of these statuses belongs to, only those statuses; categories none of them belongs to keep all
their statuses; without `statuses` it means nothing, so older versions, which read only `statuses`, show the same
issues or more), `assignees` (`null` = no one), `subscribers` (people
following the issue), `priorities`, `labels` (ids), `projects` (ids; `null` = none), `teams` (keys). Inside one filter
any value matches; different filters must all match. `grouping`: `status`, `assignee`, `priority`, `project`, `none`.
`ordering`: `manual`, `priority`, `due`, `updated`, `created`. `layout`: `list`, `board`.
`properties` (optional): what rows and cards show, as yes or no per key: `id`, `priority`, `assignee`, `labels`,
`project`, `dueDate`, `estimate`, `created`, `progress` (`{"project": true, "created": false}`). Only what someone
switched is there; a key left out follows the layout's default (`PROPERTY_DEFAULTS` in `src/data/displays.ts`: all on
but `project`, and on a board `created` off too), so a view without it looks as it always did. A switch writes the
whole `properties` object, keeping keys this version doesn't know. The database doesn't check `display`, so this
needed no migration.

**Groups (`filters.tree`).** What the flat keys can't say (an "or", groups, "is not", Me, project status, dates,
the same field twice) is kept in `tree`: a group `{"join": "and" | "or", "items": [...]}` whose items are conditions
`{"field", "op": "is" | "not", "values": [...]}` or more groups, three levels deep at most (the app's limit; deeper
ones still work). Fields are the seven flat keys plus `projectStatuses` (the workspace's project status ids, the one
a project shows; an issue with no project never "is" one; a project status added later is not in a condition that
lists all the others, unlike Status, which keeps whole categories). A `statuses` condition holds categories, like the flat
`statuses`, and may carry `statusIds`, the same refinement as the flat `statusIds`. `is` means any of the values, `not`
none of them; for `labels` and `subscribers` that is "includes any" and "includes none". `@me` in `assignees` or
`subscribers` is whoever is looking (no login or handle can start with `@`).

**Dates in the tree.** A date condition has a shape of its own, `{"field", "op", "amount"?, "unit"?, "date"?}`
(`src/data/dateFilters.ts`, `dateConditionSchema`):

| Key | Values |
| --- | --- |
| `field` | `created` (`created_at`), `updated` (`updated_at`), `completed` (`completed_at`), `due` (`due_date`) |
| `op` | `within` (in the last `amount` `unit`s), `ago` (more than that long ago), `next` (in the next, that day included: `due` only), `overdue` (due before today: `due` only), `before` / `after` (a day: before it starts, after it ends), `empty`, `set` (`completed` and `due` only) |
| `amount`, `unit` | for `within`, `ago`, `next` only, and both: a whole number from 1 up to ten years of the unit (8760 hours, 3650 days, 520 weeks, 120 months), and `hours`, `days`, `weeks` or `months` (no `hours` on `due`) |
| `date` | for `before`, `after` only: a day, `"2026-10-31"` |

```json
{ "statuses": ["done"],
  "tree": { "join": "and", "items": [
    { "field": "statuses", "op": "is", "values": ["done"] },
    { "field": "completed", "op": "within", "amount": 1, "unit": "days" } ] } }
```

Times are worked out when a list is shown, against that moment (an open list that says "in the last" or
"overdue" is worked out again every minute); days are the browser's days (a due date is a plain day, the same for
everyone). An issue with no completed time or due date never matches a time or a day, only `empty`.

The app reads a date condition only when it is exactly one of these: the keys above and no others, an `op` its
`field` offers, and for that `op` just the amount and unit (in range) or just a day. Anything else (another key, an
`op` or `unit` it doesn't know, an amount of 0 or 1.5, `"2026-10-31T12:00"`) is from a newer version and is kept as
it is. So a newer version can add a key, or a new `op`, without an older one misreading it. Only a condition missing
its amount, unit or day is one still being filled in (the builder's draft; it isn't saved).

These fields are not flat keys and have no `values`, so a version before dates (2.14) reads such a condition as one
from a newer version, keeps it, and leaves that line out of its group: inside an "and" it shows more issues, inside
an "or" it may show fewer. This version is stricter: a line it can't read inside an "or" makes the whole "or" let
every issue through. The flat copy leaves date conditions out.

```json
{ "statuses": ["in_progress", "in_review"],
  "tree": { "join": "and", "items": [
    { "field": "statuses", "op": "is", "values": ["in_progress", "in_review"] },
    { "join": "or", "items": [
      { "field": "assignees", "op": "is", "values": ["@me"] },
      { "field": "labels", "op": "is", "values": ["01J9…"] } ] } ] } }
```

The app writes the simplest shape that says the filter (`src/data/filterTree.ts`, `storedFilters`):

- One "and" group with at most one `is` condition per flat field, and no `@me`: only the flat keys, no `tree`. Older
  versions read it as they always did.
- Anything else: `tree`, plus the flat keys as a rougher copy for older versions, which may show more issues but
  never fewer: the `is` conditions right in a top "and" group, without ones that name `@me`, and without `statusIds`.
  Two conditions on one field keep the values they share (for `labels` and `subscribers`, the first one's). A top
  "or" has no copy.

When `tree` is there it wins and the flat keys are ignored. A condition or group the app can't read (a field or `op`
from a newer version) is kept as it is when the filter changes, and says nothing when matching: an "and" leaves it
out, and an "or" with one lets every issue through (2.14 left it out of the "or" too, which could show fewer). Other keys inside `filters`
are kept too. An older app that changes a chip changes only the flat keys and keeps `tree`; its "Clear all" removes
both. Nothing checks the shape in SQL. `move_person` swaps logins inside `assignees`, `subscribers` and `tree` when a
guest is linked (`swap_login`).

### inbox

One note for one person. `id`, `workspace_id`, `recipient_id`, `actor_id` (`actor`, set by a trigger), `type`
(`assigned`, `mentioned`, `commented`, `status`), `issue_id` (`issue`), `comment_id` (`comment`: for `commented`, and
`mentioned` in a comment), `status` (for `status`: the new status's category), `status_id` (`statusId`, for `status`:
the new status; no foreign key, the `b_status` trigger puts it right), `at`, `read_at` (`readAt`, read one by one),
`changed_at`, `extra`. Written by whoever caused it (`actor_id` must be you), read, marked and deleted only by its
recipient. Deleting the issue or the comment deletes the note. A note about an issue made from a Notion page has
`"from": "notion"` in `extra` (the model's `from`), and no actor when the page's author isn't a member: the Inbox shows
it as from Notion.

### read_state

One row per person and workspace: `profile_id`, `workspace_id`, `read_until` (`readUntil`: "Mark all as read", every
note up to then counts as read), `changed_at`, `extra`. Yours only. The one table written with an upsert, so you may
write every column.

### favourites

The projects and views someone starred, kept in their sidebar in their own order. One row per person and starred
thing, in one workspace:

| Column | Meaning |
| --- | --- |
| `profile_id` | whose favourite it is |
| `workspace_id` | the workspace of the project or view |
| `kind` (`kind`) | `project` or `view` |
| `item_id` (`id`) | the project's or view's id |
| `sort_order` (`sortOrder`) | its place in your list: a fractional key, compared as plain text, like an issue's |
| `project_id`, `view_id` | generated from `kind` and `item_id` (the id in the column of its kind, null in the other), only so each kind has a real foreign key; the app never sends or reads them |
| `changed_at`, `extra` | as everywhere |

Key `(profile_id, item_id)`: the app makes it, so starring again after unstarring is the same row, and starring in two
tabs at once makes one (it is added unless there). `(workspace_id, project_id)` points at `projects` and
`(workspace_id, view_id)` at `views`, both deleting the favourite along with what it stars (deleting a team deletes its
views, and so their favourites). Deleting the person or the workspace deletes them too.

Yours only, and only while you are a member: nobody else reads, adds, changes or deletes them. Only `sort_order` and
`extra` change; to star something else, unstar and star again. They come and go on your own channel (`me:`), and
deleting one leaves no `deletions` row (it would tell every member what you unstarred), so a browser compares its
favourites' keys every time it catches up. Leaving a workspace keeps them, out of reach; joining again brings them
back, minus whatever was deleted meanwhile. Imports and `move_person` don't touch them.

### issue_events

The history, written only by triggers. `id` (a growing number), `workspace_id`, `issue_id`, `actor_id` (null: nobody
was signed in, such as the nightly archive), `at`, `changes`:

```json
{ "status": ["todo", "in_progress"], "statusId": ["<status id>", "<status id>"], "assignee": [null, "<profile id>"], "title": ["Old", "New"],
  "description": true, "labels": { "added": ["01J…"] }, "team": ["WEB-2", "ENG-14"], "archived": true }
```

A change a pull request made also has `"via": {"pullRequest": {"repo": "acme/web", "number": 12, "url": "…"}}`.

Creating an issue writes no event (its own fields say who and when), except one made through an integration: an issue
made from a Notion page gets `{"created": true, "via": {"notion": {"url": "https://www.notion.so/…"}}}`, by its author
or by nobody (docs/notion.md). Older apps show no line for it.

Each changed field is `[before, after]` (`title`, `status`, `statusId`, `priority`, `assignee`, `project`, `parent`,
`dueDate`, `estimate`). `statusId` is written whenever the status changes, `status` (the categories) only when the
category changes too, so a move within one category has only `statusId`; events from before statuses have only
`status`; `description` only says it changed; `labels` is `{"added": [id]}` or `{"removed": [id]}`; `team` is the
old and new reference; `archived` or `restored` is `true`. `src/data/history.ts` turns them into lines.

### issue_numbers

`workspace_id`, `team_id`, `number`: every number a team ever gave out, filled by the number trigger and never emptied
(a deleted or moved issue leaves its number here). Members read it; nobody writes it.

### deletions

`id`, `workspace_id` (no foreign key: the rows outlive what they describe), `table_name`, `row_key` (the deleted row's
keys: `{"id": "…"}` or `{"issue_id": "…", "label_id": "…"}`), `deleted_at`. Written by the `forget` trigger, cascades
included, so a browser that catches up drops them too, but only for the tables `private.wiring` marks with
`forget = true`: workspace members, teams, team members, labels, statuses (which are never deleted, except with their
workspace), projects, project teams, issues, issue labels, followers, pull requests, comments and views, plus profiles of guests (a profile with an account belongs to no workspace, so it
leaves none). Workspaces, invites, invite uses, inbox notes, read marks and favourites leave none; a browser compares
its inbox notes and favourites instead.
Nothing is noted while the whole workspace is going. Kept 45 days.

### github_repos

Which GitHub repository feeds which workspace (docs/github-app.md): `id`, `workspace_id`, `repo` (`owner/name` as an
admin typed it; unique per workspace, case aside), `repository_id` (GitHub's number, filled when the first pull
request comes; from then on the repository is found by it, and `repo` follows a rename), `added_by` (set by a
trigger), `created_at`, `last_event_at` and `last_event` (what the latest pull request did, for Settings:
`{"number", "url", "title", "login", "to", "refs", "moved", "skipped": "author"}`), `changed_at`. Only admins and owners
read, add and delete them; nobody updates one (only `github_apply` writes the rest). Never broadcast. Two workspaces
may connect the same repository.

### notion_connections

The workspace's Notion connection, at most one (docs/notion.md): `id` (part of the address Notion sends pages to),
`workspace_id` (unique), `team_id` (where pages become issues; set null when that team is deleted), `secret_hash` (the
sha256 of the secret in the address; the secret itself is never kept), `secret_set_at` (when the address was made or
replaced), `added_by` (set by a trigger), `created_at`, `last_event_at` and `last_event` (the latest page, for
Settings: `{"title", "ref", "new": true, "author": login}` (the author's hidden login, which never changes; a screen
shows their handle now), `{"title", "ref", "new": false}`, `{"title", "problem": "team"}` or `{"problem": "busy"}`),
`changed_at`. Only admins and owners read it, change its team and delete it;
`notion_connect()` makes it and `notion_new_secret()` replaces the secret (no insert grant, and `team_id` is the one
column people may update). Never broadcast.

### private.notion_pages

Which Notion page made which issue, so the same page sent again keeps its issue: `workspace_id`, `page_id` (Notion's
id, 32 lower-case hex digits), `issue_id`, `connection_id` (set null when Notion is disconnected: the row stays, so
connecting again still finds the page), `url`, `created_at`. One per workspace and page. Deleting the issue deletes it
(the page may then be sent again); archiving keeps it. Never sent to browsers; only `notion_apply` writes it.

### private.guest_emails

`profile_id` (a guest), `email`: the email a person from Linear had there. Never sent to browsers; admins read their
workspace's with `guest_emails()` and set them with `set_guest_email()`. Nothing to do with contact emails
(profile_emails), which only people with an account have.

## Who may make an account (sign-up codes)

A new account needs a **sign-up code** or an **invite link** that still has room. Whoever looks after Sprawniej makes codes in the
SQL editor (recipes in docs/supabase-setup.md, "Sign-up codes"); there is no screen for them in the app.

**Where it is checked.** Two places, one rule (`private.let_in`):

1. **Email and password: before the account exists.** Supabase Auth's *before user created* hook (on the free plan)
   runs `private.before_user_created(event)` just before a new account is written, also for a direct call to the
   sign-up endpoint. On no, the account is never made. `config.toml` switches the hook on
   (`[auth.hook.before_user_created]`, pushed with `config push`, docs/supabase-setup.md), so a new project gets it
   the same way.
2. **GitHub: before the account gets a profile.** GitHub sign-in can't carry a code, so the hook lets GitHub accounts
   through. Such an account can't get a profile (the `a_let_in` trigger on `profiles` refuses with `SP004`), and
   without a profile it can see and do nothing. On the name step the app asks for a code (or uses the invite link it
   came from) and calls `use_signup_code()`. Accounts that never give one are deleted after 7 days (nightly job).

Signing in to an account that already exists runs neither, so nobody is locked out of their own account. Accounts
made before sign-up codes were let in by the migration.

**What it looks at.** The app sends `signup_code` (what the person typed) or `invite` (the invite link's token) in the
new account's metadata (`signUp(..., { data })`), or to `use_signup_code(code, invite)`. An account is let in when:

- `invite` names an invite that is `open` (not used, ended, full or expired) and still has a place for an account:
  `max_uses` is null (anyone with the link), or the people who joined with it plus the accounts made with it that
  aren't in the workspace yet are fewer than `max_uses`. An account made with it that was deleted since frees its
  place (one made in the last ten minutes always holds it, as the hook runs before the account is written), and so
  does one that got into the workspace another way. A sign-up with the same email as a waiting one is that person
  trying again (after Auth failed), so it doesn't count against itself. So a link for one person makes one account,
  as before, and the link still has to be accepted with `accept_invite` afterwards. Joining counts only who joined,
  so an account that never joins can't keep a real person out. An open link for several people whose places are all
  held this way refuses with its own sentence ("no places left right now"); a link for one person keeps the old one,
  which older apps know. The invite's row lock makes two sign-ups at once wait
  for each other; or
- `signup_code` matches a code that is not switched off, not expired and not used up. Case, spaces and dashes don't
  matter (`k7qx m2pa 9rtd` is `K7QX-M2PA-9RTD`). Using it adds one to `uses`, under a row lock, so two sign-ups at once
  can't both take the last use.

Anything else is refused with a plain sentence the app shows as it is (`SIGNUP_REFUSALS` in `src/backend/auth.ts`;
each one in the SQL has a `-- @message signup` marker, and `tests/signupMessages.test.ts` compares them). Being let in
is written down in `private.signups`.

### private.signup_codes

| Column | Meaning |
| --- | --- |
| `id` | uuid |
| `code` | 12 capital letters and digits, without the look-alikes `0 O 1 I L` (about 59 bits, random), unique; stored without dashes, shown as `K7QX-M2PA-9RTD` |
| `note` | who it's for, for whoever looks after Sprawniej |
| `created_at` | when it was made |
| `expires_at` | after this it no longer works |
| `max_uses` | how many accounts it may make (at least 1) |
| `uses` | how many it made |
| `switched_off_at` | switched off by hand: it stops working at once |

### private.signups

One row per account that was let in (by the hook, by `use_signup_code()`, or by the migration for older accounts): `id`, `at`, `user_id` (the new account; no foreign key, the account is written
just after the hook says yes), `email`, `provider`, and either `code_id` (the sign-up code) or `invite_id` (the
invite link). Deleting a code or an invite keeps the row (the link becomes null). This is the record of who used
which code, and when.

Neither table is readable or writable from browsers (the `private` schema isn't exposed, and only the hook and the SQL
editor use them). The helpers `private.make_signup_code(note, days, uses)` and `private.switch_off_signup_code(code)`
are for the SQL editor only.

## Functions the app calls

Each runs as its owner (security definer) unless the table says otherwise, checks who is calling, and raises errors
in plain words with a code the app tells apart: `42501` not allowed, `P0002` not there, `23505` already taken, `23503` no such team, `22023` not valid,
`23514` a workspace needs an owner (or too many contact emails), `SP001` you already have a name, `SP002` the invite was used, `SP003` it expired,
`SP004` a sign-up code is needed first, `SP005` that sign-up code or invite can't let you in (the message says why),
`SP006` the invite link was ended, `SP007` it is full, `SP008` it was made before you left the workspace,
`SP010` an import the database can't take (the detail says why), `SP020` a Notion address that was replaced (only
`notion_apply` raises it, for the webhook). `src/backend/problem.ts` shows those messages as they
are and puts everything else in our own words.

| Function | Who | What it does |
| --- | --- | --- |
| `ensure_profile()` | signed in | Your profile (given your GitHub id if it had none and you added GitHub as a way to sign in); or a profile with your GitHub id that nobody has claimed; or a new one with your GitHub login when it's free (nobody's login or @handle now). No rows: pick a name. `SP004`: not let in yet (give a sign-up code first). |
| `create_profile(login, name)` | signed in, once, let in | Your profile with the @handle you picked; `23505` when someone shows as that @handle now, case aside. When it is only someone's login (they moved off it), your login is the handle with a short random ending and `handle` is what you picked. |
| `set_handle(handle)` | with a profile | Changes your @handle and returns your profile; your login stays. Your own login stores null, and a change of case only is allowed. `22023`: not a handle; `23505`: someone else has it now, case aside. Your old one is free for anyone from then on. |
| `signup_code_needed()` | signed in | True while you have no profile and weren't let in (a GitHub sign-up without a code). |
| `use_signup_code(code, invite)` | signed in | Lets your account in with a sign-up code or the token of an invite link that still has room (`SP005` with the reason when it can't). Nothing to do if you're in already. |
| `create_workspace(name, team_key, team_name, team_emoji)` | with a profile | A workspace with you as owner, and a first team with you in it. |
| `invite_info(token)` | anyone, also not signed in | What the join page shows (see invites); the workspace id only to someone already in it. |
| `accept_invite(token)` | with a profile | Makes you a member (or brings you back) and writes down that you joined with it (`invite_uses`); marks a link for one person used; turns an invited guest into you. Someone already in gets the workspace and uses no place. Refuses with `SP002` used, `SP006` ended, `SP007` full, `SP003` expired, `SP008` made before you left. Two people at the last place wait for the invite's row lock: one joins, the other gets `SP007`. |
| `end_invite(invite)` | admins | Ends a link now: nobody new joins or makes an account with it. Who joined stays written down. Ending twice keeps the first time. `P0002` for a link that isn't there or isn't yours to end. |
| `leave_workspace(workspace)` | a member | You leave. The last owner can't. |
| `move_issue_to_team(issue, team)` | a member | Moves an issue to another team: a new number there, the old one in `former_refs`. |
| `set_checklist_item(issue, item, text, checked)` | whoever may change the issue (security invoker: the usual rules decide) | Ticks (or unticks) one checklist item of the description by changing only its box character, and returns the issue. The item is number `item` (from 0) if it still says `text`, else the only item that says it; neither: `P0001` "That checklist item changed meanwhile…". Items are lines like `- [ ] text`, `* [x] text` or `> + [X] text` (any of `-`, `*`, `+`, also in quotes), never inside a ``` or ~~~ code block (also one indented in a list or inside a quote; Windows line ends work too): the same rule as `src/data/checklist.ts`, checked with the cases in `tests/fixtures/checklists.ts`. Already that way: nothing is written (no history line). A missing argument: `22023`. |
| `link_person(workspace, guest, to)` | admins | This person from Linear is that member: everything moves over (`move_person`). |
| `set_guest_email(profile, email)` | admins | Keeps (or, empty, forgets) a guest's email. |
| `guest_emails(workspace)` | admins | The workspace's guests' emails. |
| `show_email(email)` | with a profile | Picks which of your contact emails teammates see (an id from profile_emails); none, or null, shows none. Copies it onto your profile, which sends one message per workspace. `P0002`: that email isn't yours (or is gone). |
| `import_rows(workspace, table, rows)` | admins | Up to 1000 rows of one table, inserted or updated quietly (below). |
| `github_lookup(repository_id, repo, author, refs)` | the service role only (the Edge Function `github-webhook`) | For each workspace that connected the repository: the author's profile if they are a member there now (by `github_id`), the members' logins and @handles (`handle`, null when it is the login), and the issues the refs name (by number or an old number, not archived) with their followers and comments. |
| `github_apply(connection, repository_id, repo, actor, via, moves, notes, event, pull)` | the service role only | Moves the issues as `actor` (a member now), only from the categories each move allows, to a category (so they land on its default status), adds the notes for the issues that moved, and records the repository's number, name and `last_event`. `pull` (`{"id", "repo", "number", "title", "url", "state", "updated_at", "issues": [ids]}`, optional) keeps the pull request on those issues in `issue_pull_requests` and takes it off the ones it no longer mentions. Without an `event` (a pull request event that moves nothing) `last_event` stays as it was. Without an actor it only records the repository. |
| `notion_connect(workspace, team)` | admins | Connects the workspace to Notion: pages become issues in `team`. Gives `{"id", "secret"}`; the secret is shown once and only its sha256 is kept. `23505`: already connected. |
| `notion_new_secret(connection)` | admins | A new secret (given back once); the old address stops working at its next delivery. |
| `notion_lookup(connection, secret_hash, emails, team)` | the service role only (the Edge Function `notion-webhook`) | `{"state": "unknown"}` or `{"state": "wrong_key"}`, and nothing else, unless the hash matches. Then: the workspace, the team (the page's Team property by key or name, else the connection's) with the smallest `sort_order` of its open issues, the members (each with `handle`, null when it's their login, as `github_lookup` gives them), the members whose confirmed sign-in email is one of `emails` (at most 20), and the labels. |
| `notion_apply(connection, secret_hash, page, actor, issue, notes)` | the service role only | Checks the hash again (`SP020` when the address was replaced). A page that made an issue before gives `{"issue": ref, "new": false, "archived"}` and makes nothing. Otherwise makes the issue as `actor` (a member now, or null: nobody) with `sprawniej.via` set to the page, its labels (only this workspace's, at most 20), the page row and the notes (`assigned`, `mentioned`; `extra.from = "notion"`), and gives `{"issue": ref, "new": true}`. Tidies what doesn't fit (a blank title is Untitled, an unknown status Todo, a priority outside 0 to 4 none, a date that isn't one none, an assignee who isn't a member nobody; the title is cut at 500 characters and the description at 50,000). `{"problem": "team"}` without a team of this workspace, `{"problem": "busy"}` after 100 new pages in 10 minutes. Either way the connection's `last_event` says what happened. |

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
- `private.import_spec`: what `import_rows` may write per table. Issues go in with their category (`status`) only:
  a new one gets the category's default status, an updated one keeps its status while the category stays. Projects
  go in with `status_id` too (a Linear status matched by name, then by kind: docs/linear-import.md; empty means the
  category's default), and with `sort_order`, which is written only for a new project, so a second import keeps the
  order people arranged here.
- Statuses: `private.status_defaults` (what every workspace starts with, per kind and category), `seed_statuses(ws,
  kind)` (copies them; every kind when null), `seed_new_workspace` (the trigger), `default_status(ws, kind, category)`
  (the first shown status of a category), `follow_status` (the trigger that keeps a category and a status in step),
  `keep_a_status` and `note_status` (the triggers below).
- Who is asking: `my_profile_id()`, `my_workspaces()` (now, not the ones left), `my_admin_workspaces()`,
  `my_owner_workspaces()`, `my_people()`, `belongs(person, workspace)`, `actor_id()`.
- `valid_login`, `is_completed`, `take_number`, `swap_login`, `move_person`, `notion_page_issue` (the issue a Notion
  page made, for `notion_apply`), and the nightly jobs.
- Invites: `invite_state(invite, person)`, the state of a link (see invites).
- Contact emails: `valid_email` (the check on profile_emails, run as whoever writes), `limit_emails` (up to 5),
  `refresh_contact_email(profile)` (copies the shown email onto the profile, only when it differs, so nothing is sent
  when nothing changed), `contact_email_changed` (the triggers that call it) and `account_gone` (a deleted account).
- Sign-up codes: `let_in` (the one rule), `before_user_created` (the Auth hook; only `supabase_auth_admin` may run it),
  `must_be_let_in` (the profiles trigger), and for the SQL editor `make_signup_code`, `switch_off_signup_code`.
- Four settings change what triggers do within one transaction: `sprawniej.importing` (imports and `move_person`:
  no history, no broadcast per row, keep the times and numbers that came), `sprawniej.trusted` (`accept_invite` and
  `leave_workspace`: skip the role guard) and `sprawniej.actor` (who the service role, the SQL editor or a job acts
  for) and `sprawniej.via` (what a change came through, copied into its history event: the pull request, set by
  `github_apply`, or the Notion page an issue is made from, set by `notion_apply`, which builds it itself; both set
  `sprawniej.actor` with it). No function the browser calls puts its input into them.

New functions are closed by default: nobody runs one unless a migration grants it by name.

## Triggers

"Before" triggers on one event run in name order, hence the `a_`, `b_`, `c_` names.

- `a_stamp` on every table `private.wiring` gives a stamp (all but invites, invite uses, history, used numbers and deletions): `changed_at` (`touch`); on issues also authors, times and who archived
  (`issue_times`); on comments the author and `edited_at` (`comment_times`). Imports keep the times they bring.
- `a_category` on issues (before `a_stamp`, so the times see the final category; `follow_status('issue')`) and on
  projects (`follow_status('project')`): a new `status_id` sets `status` to its category (a status of another
  workspace or kind: `22023` "That status isn't in this workspace."; hidden ones are allowed); `status` changed alone
  (an older app, GitHub, the import) moves `status_id` to that category's default; an insert without `status_id` gets
  its category's default. Both sent: `status_id` wins.
- `a_author` on views (`owner_id`), inbox (`actor_id`), invites (`invited_by`), github_repos and notion_connections
  (`added_by`) and profile_emails (`profile_id`): whoever is signed in. profile_emails also gets its own `a_stamp`
  (`touch`), though it isn't in `private.wiring`.
- `b_limit` on profile_emails (insert): up to 5 per person.
- `contact_email_edited` (the shown email's text changed) and `contact_email_gone` (the shown email was deleted) on
  profile_emails: copy what is shown now onto the profile (`refresh_contact_email`).
- `b_account_gone` and `account_gone` on profiles, when `user_id` becomes null (the account was deleted): clear
  `contact_email` (in the same message as `user_id`) and delete the person's contact emails.
- `b_number` on issues: the next number of the team (Issue numbers in docs/architecture.md).
- `b_status` on inbox (`note_status`): a status note sent with `status_id` gets that status's category (an id that
  isn't one of the workspace's issue statuses is dropped); one sent with only `status` (an older app, `github_apply`)
  gets the issue's own `status_id` when the issue is of that category. Other notes get no `status_id`.
- `c_check_note` on inbox: drops a note for someone who isn't a member now or for yourself, and a repeat of the same
  note (same status too) about the same issue from the same person within ten minutes (notes about a comment always
  go).
- `seed_statuses` on workspaces (after insert): the new workspace's statuses.
- `c_keep_a_status` on statuses (after insert or a change of `hidden`): each category keeps a shown status; two people
  hiding the last two at once wait for each other on a lock per workspace, kind and category, and the second is
  refused.
- `c_people` on team members, issues (assignee), followers and projects (lead): the person must belong to the
  workspace (a member now or before, or one of its guests).
- `history` on issues and issue labels: writes `issue_events`.
- `history_created` on issues (insert): the `created` event, only while `sprawniej.via` is set (an issue made from a
  Notion page). Issues made in the app or by an import write none.
- `forget` on every table marked in `private.wiring`: writes `deletions`.
- `live` on every broadcast table: Realtime (below).
- `a_guard` on workspace members: only an owner makes, unmakes or removes owners; nobody but an owner changes their
  own role; someone who left comes back only through an invite. `removed_at` is the database's time: set once when
  they leave or are removed (whatever the app sends), and kept as it is while they're out.
- `a_let_in` on profiles (insert): a profile for an account needs the account to be let in (`private.signups`);
  `SP004` otherwise. Guests have no account and aren't checked.
- `keep_an_owner` on workspace members: refuses a change that leaves the workspace without an owner (changes that
  could wait for each other on a lock per workspace).

## Rules (RLS) and column grants

Row-level security is on for every table. Not-signed-in visitors (`anon`) can read and write nothing; they may only
call `invite_info`. Signed-in people read a workspace's rows while they are a member of it, and the standard policies
let them add, change and delete them, except:

- teams: only admins and owners delete;
- statuses: nobody deletes them (no delete grant either; they are hidden);
- comments: only the author edits and deletes, while a member;
- inbox: you read, mark and delete your own notes; you add notes only as their actor;
- read_state: yours only;
- favourites: yours only, while you are a member;
- workspaces: admins and owners rename, owners delete; creating is `create_workspace()`;
- workspace_members: admins and owners change roles and remove people;
- invites, github_repos and notion_connections: admins and owners only;
- invite_uses: admins and owners read them; nobody writes them (only `accept_invite`);
- profiles: see the profiles table;
- profile_emails: yours only, whatever workspace you are in; you add and change `email` and delete rows, and nothing
  else (`profile_id` and `visible` are the database's);
- issue_events, issue_numbers, deletions, issue_pull_requests: read only.

On top of that, **column grants** list what people may write; everything else is filled in by the database
(`changed_at`, numbers, authors, times, `linear_id`). For example, issues take `title`, `description`, `status`,
`status_id`, `priority`, `assignee_id`, `project_id`, `parent_id`, `due_date`, `estimate`, `sort_order`, `duplicate_of`,
`archived_at` and `extra` on update, but not `team_id` or `number`; projects take `status_id` and `sort_order` on
top of `status` (which older apps still send). The list is in
`supabase/migrations/20261019000005_rls.sql` and the migrations that add tables or columns since (GitHub, statuses,
project statuses),
with a copy in `src/backend/changes.ts`.

## Realtime

Two private channels per open workspace: `ws:<workspace id>` for every shared table, and `me:<profile id>` for your
inbox notes, read marks and favourites (from all your workspaces: the app keeps the open one's). You may listen to `ws:`
while you are a member, and to your own `me:`; browsers can't send on either. Each message has the event `change` and

```json
{ "table": "issues", "op": "UPDATE", "row": { "id": "01J…", "status": "done", "changed_at": "…" } }
```

An `INSERT` sends the whole row, an `UPDATE` only the columns that changed plus the keys and `changed_at` (nothing at
all when only a team's counter changed), a `DELETE` the keys. A row over 200 kB comes without `description` or `body`
and with `"partial": true`; the app fetches it. A profile's change goes to every workspace the person is (or was) in;
that is how a new contact email reaches teammates (`{"id", "contact_email", "changed_at"}`). Contact email lists
(profile_emails) are never broadcast.
Imports and `move_person` send `{"op": "catch_up"}` (with `"table"` for imports) once per batch instead. Invites,
invite uses, history, used numbers and deletions are never broadcast. Access is checked when a browser joins, so someone removed
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
| 02:17 | `sprawniej-auto-archive` | Archives issues of the Done, Canceled and Duplicate categories (whatever their status) untouched (the later of `completed_at` and `updated_at`) for longer than their team's `auto_archive` months |
| 02:27 | `sprawniej-tidy-inboxes` | Deletes read notes older than 30 days and unread ones older than 90. Read means `read_at` is set, or the note is no newer than the person's `read_until` ("Mark all as read") |
| 02:37 | `sprawniej-forget-deletions` | Deletes `deletions` rows older than 45 days |
| 02:47 | `sprawniej-forget-strangers` | Deletes accounts older than 7 days that were never let in and have no profile (a GitHub sign-up that never gave a sign-up code) |
