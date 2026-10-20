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
   A fixed list copied into SQL gets a marker comment (`-- @list …`) for `tests/statusLists.test.ts`.
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
| `login` (`login`) | the hidden key everything points at (filters, history, assignees, the app's `people`): letters, digits and dashes, up to 39, not starting with a dash (`private.valid_login`). Unique among people with accounts, case aside. A guest's starts with `~` and is unique within its workspace. Never changes. It is also the @handle until the person picks another. |
| `handle` (`handle`) | the @handle the person changed to (`set_handle()`); null: the same as `login`. Same rule as a login; a guest has none. What people see, `coalesce(handle, login)`, is unique among people with accounts, case aside (`profiles_handle`). Nothing is kept for anyone: once someone moves off a handle (or off their login), anyone may take it as their handle. The app reads it only when it isn't the login. |
| `github_id` (`githubId`) | set when the profile was made from (or waits for) a GitHub sign-in; unique |
| `name`, `avatar_url` (`name`, `avatarUrl`) | what teammates see |
| `name_set_here` (`nameSetHere`) | they typed their name in Sprawniej, so GitHub's doesn't replace it |
| `guest_of` | for a guest: their workspace |
| `linear_ids` (`linearId`, `linearIds`) | the Linear people this profile stands for, so later imports match them. A guest has one, shown to the app as `linearId`. An account gets them when a guest is linked to it or joins through a guest's invite (`move_person`); the app shows `linearIds` only when there are any. |

Made by `ensure_profile()` or `create_profile()` (accounts) and `import_rows` (guests). You see yourself, everyone who
is or was in a workspace you are in now, and those workspaces' guests. You change your own `name`, `avatar_url`,
`name_set_here` and `extra`, and your `handle` through `set_handle()` only.

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
30 after `created_at`), `accepted_by`, `accepted_at`. Only the workspace's admins and owners see and change them; an
invite for a guest must name a guest of that workspace. Never broadcast.

What someone holding the link sees comes from `invite_info(token)`, one row (none for an unknown token):
`workspace_id` (only to someone already in it), `workspace_name`, `invited_by_name`, `invited_by_login` (their @handle
now),
`invited_by_avatar`, `for_login` and `for_name` (the guest's name, for an invite made for one), `role`, `state`
(`member`: you're already in, `used`, `expired` or `open`) and `people` (up to 8 names and pictures of members, as
`[{"name", "avatarUrl"}]`). A used or expired link gives no `people`, `for_login` or `for_name`. Never the token,
never an email.

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

`updated_at` is "last changed" as people see it. The trigger moves it only when one of these changes: `title`,
`description`, `status`, `priority`, `assignee_id`, `project_id`, `parent_id`, `due_date`, `estimate`, `sort_order`,
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

A change a pull request made also has `"via": {"pullRequest": {"repo": "acme/web", "number": 12, "url": "…"}}`.

Each changed field is `[before, after]` (`title`, `status`, `priority`, `assignee`, `project`, `parent`, `dueDate`,
`estimate`); `description` only says it changed; `labels` is `{"added": [id]}` or `{"removed": [id]}`; `team` is the
old and new reference; `archived` or `restored` is `true`. `src/data/history.ts` turns them into lines.

### issue_numbers

`workspace_id`, `team_id`, `number`: every number a team ever gave out, filled by the number trigger and never emptied
(a deleted or moved issue leaves its number here). Members read it; nobody writes it.

### deletions

`id`, `workspace_id` (no foreign key: the rows outlive what they describe), `table_name`, `row_key` (the deleted row's
keys: `{"id": "…"}` or `{"issue_id": "…", "label_id": "…"}`), `deleted_at`. Written by the `forget` trigger, cascades
included, so a browser that catches up drops them too, but only for the tables `private.wiring` marks with
`forget = true`: workspace members, teams, team members, labels, projects, project teams, issues, issue labels,
followers, pull requests, comments and views, plus profiles of guests (a profile with an account belongs to no workspace, so it
leaves none). Workspaces, invites, inbox notes and read marks leave none; a browser compares its inbox notes instead.
Nothing is noted while the whole workspace is going. Kept 45 days.

### github_repos

Which GitHub repository feeds which workspace (docs/github-app.md): `id`, `workspace_id`, `repo` (`owner/name` as an
admin typed it; unique per workspace, case aside), `repository_id` (GitHub's number, filled when the first pull
request comes; from then on the repository is found by it, and `repo` follows a rename), `added_by` (set by a
trigger), `created_at`, `last_event_at` and `last_event` (what the latest pull request did, for Settings:
`{"number", "url", "title", "login", "to", "refs", "moved", "skipped": "author"}`), `changed_at`. Only admins and owners
read, add and delete them; nobody updates one (only `github_apply` writes the rest). Never broadcast. Two workspaces
may connect the same repository.

### private.guest_emails

`profile_id` (a guest), `email`: the email a person from Linear had there. Never sent to browsers; admins read their
workspace's with `guest_emails()` and set them with `set_guest_email()`.

## Who may make an account (sign-up codes)

A new account needs a **sign-up code** or an open **invite link**. Whoever looks after Sprawniej makes codes in the
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

- `invite` names an invite that is not used and not expired, and no account was made with it yet (one account per
  link: the link still has to be accepted with `accept_invite` afterwards, as before); or
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

Each runs as its owner (security definer), checks who is calling, and raises errors in plain words with a code the app
tells apart: `42501` not allowed, `P0002` not there, `23505` already taken, `23503` no such team, `22023` not valid,
`23514` a workspace needs an owner, `SP001` you already have a name, `SP002` the invite was used, `SP003` it expired,
`SP004` a sign-up code is needed first, `SP005` that sign-up code or invite can't let you in (the message says why),
`SP010` an import the database can't take (the detail says why). `src/backend/problem.ts` shows those messages as they
are and puts everything else in our own words.

| Function | Who | What it does |
| --- | --- | --- |
| `ensure_profile()` | signed in | Your profile (given your GitHub id if it had none and you added GitHub as a way to sign in); or a profile with your GitHub id that nobody has claimed; or a new one with your GitHub login when it's free (nobody's login or @handle now). No rows: pick a name. `SP004`: not let in yet (give a sign-up code first). |
| `create_profile(login, name)` | signed in, once, let in | Your profile with the @handle you picked (`23505` when it is anyone's login, or anyone's @handle now). |
| `set_handle(handle)` | with a profile | Changes your @handle and returns your profile; your login stays. Your own login stores null, and a change of case only is allowed. `22023`: not a handle; `23505`: someone else has it now, case aside. Your old one is free for anyone from then on. |
| `signup_code_needed()` | signed in | True while you have no profile and weren't let in (a GitHub sign-up without a code). |
| `use_signup_code(code, invite)` | signed in | Lets your account in with a sign-up code or an open invite link's token (`SP005` with the reason when it can't). Nothing to do if you're in already. |
| `create_workspace(name, team_key, team_name, team_emoji)` | with a profile | A workspace with you as owner, and a first team with you in it. |
| `invite_info(token)` | anyone, also not signed in | What the join page shows (see invites); the workspace id only to someone already in it. |
| `accept_invite(token)` | with a profile | Makes you a member (or brings you back), marks the invite used, turns an invited guest into you. |
| `leave_workspace(workspace)` | a member | You leave. The last owner can't. |
| `move_issue_to_team(issue, team)` | a member | Moves an issue to another team: a new number there, the old one in `former_refs`. |
| `link_person(workspace, guest, to)` | admins | This person from Linear is that member: everything moves over (`move_person`). |
| `set_guest_email(profile, email)` | admins | Keeps (or, empty, forgets) a guest's email. |
| `guest_emails(workspace)` | admins | The workspace's guests' emails. |
| `import_rows(workspace, table, rows)` | admins | Up to 1000 rows of one table, inserted or updated quietly (below). |
| `github_lookup(repository_id, repo, author, refs)` | the service role only (the Edge Function `github-webhook`) | For each workspace that connected the repository: the author's profile if they are a member there now (by `github_id`), the members' logins and @handles (`handle`, null when it is the login), and the issues the refs name (by number or an old number, not archived) with their followers and comments. |
| `github_apply(connection, repository_id, repo, actor, via, moves, notes, event, pull)` | the service role only | Moves the issues as `actor` (a member now), only from the statuses each move allows, adds the notes for the issues that moved, and records the repository's number, name and `last_event`. `pull` (`{"id", "repo", "number", "title", "url", "state", "updated_at", "issues": [ids]}`, optional) keeps the pull request on those issues in `issue_pull_requests` and takes it off the ones it no longer mentions. Without an `event` (a pull request event that moves nothing) `last_event` stays as it was. Without an actor it only records the repository. |

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
- Sign-up codes: `let_in` (the one rule), `before_user_created` (the Auth hook; only `supabase_auth_admin` may run it),
  `must_be_let_in` (the profiles trigger), and for the SQL editor `make_signup_code`, `switch_off_signup_code`.
- Four settings change what triggers do within one transaction: `sprawniej.importing` (imports and `move_person`:
  no history, no broadcast per row, keep the times and numbers that came), `sprawniej.trusted` (`accept_invite` and
  `leave_workspace`: skip the role guard) and `sprawniej.actor` (who the service role, the SQL editor or a job acts
  for) and `sprawniej.via` (the pull request a change came through, copied into its history event; only
  `github_apply` sets it, with `sprawniej.actor`). No function the browser calls puts its input into them.

New functions are closed by default: nobody runs one unless a migration grants it by name.

## Triggers

"Before" triggers on one event run in name order, hence the `a_`, `b_`, `c_` names.

- `a_stamp` on every table `private.wiring` gives a stamp (all but invites, history, used numbers and deletions): `changed_at` (`touch`); on issues also authors, times and who archived
  (`issue_times`); on comments the author and `edited_at` (`comment_times`). Imports keep the times they bring.
- `a_author` on views (`owner_id`), inbox (`actor_id`), invites (`invited_by`) and github_repos (`added_by`): whoever is signed in.
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
- `a_let_in` on profiles (insert): a profile for an account needs the account to be let in (`private.signups`);
  `SP004` otherwise. Guests have no account and aren't checked.
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
- invites and github_repos: admins and owners only;
- profiles: see the profiles table;
- issue_events, issue_numbers, deletions, issue_pull_requests: read only.

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
| 02:27 | `sprawniej-tidy-inboxes` | Deletes read notes older than 30 days and unread ones older than 90. Read means `read_at` is set, or the note is no newer than the person's `read_until` ("Mark all as read") |
| 02:37 | `sprawniej-forget-deletions` | Deletes `deletions` rows older than 45 days |
| 02:47 | `sprawniej-forget-strangers` | Deletes accounts older than 7 days that were never let in and have no profile (a GitHub sign-up that never gave a sign-up code) |
