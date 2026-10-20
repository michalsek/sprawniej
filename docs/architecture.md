# How Sprawniej works

Sprawniej is a web page and one Supabase project. The page is a static PWA on GitHub Pages; the project holds the
work: a Postgres database with row-level security (RLS), sign-in (Supabase Auth), Realtime broadcasts, Storage for
pictures and nightly jobs (pg_cron). There is no server of our own besides that project.

Every call to Supabase lives in `src/backend/`. The rest of the app talks to it through `src/data/actions.ts` (to
change something) and the data store (to show it).

## The big picture

```
Browser (Sprawniej, a PWA on GitHub Pages)
  React screens
     |  call
     v
  src/data/actions.ts           the only code that changes data: works out which rows change
     |
     v
  src/backend/writes.ts         shows the change at once (applyRows, "local"), then sends
     |                          only the changed columns (PostgREST), a moment later
     v
Supabase project
  Postgres: RLS policies, column grants, triggers (numbers, authors, times, history, inbox checks)
     |  a "live" trigger on every shared table
     v
  Realtime broadcast: ws:<workspace id> (shared rows), me:<profile id> (your inbox and read marks)
     |
     v
Browser
  src/backend/workspace.ts -> applyRows (src/backend/apply.ts) -> data store (zustand) -> screens redraw

  and in this browser: a copy of each workspace in IndexedDB (sprawniej-cache), so opening is quick
```

Opening a workspace shows the copy kept in this browser at once, then reads only what changed since it (catching
up). Without a copy, it reads everything except the archive.

## Signing in

- **Email and password** (at least 8 characters), or **GitHub**, when its OAuth app is set up in the project
  (docs/supabase-setup.md). `src/backend/auth.ts` puts every sign-in problem into plain words (`friendlyAuthError`).
  Google is ready in the code but not switched on.
- The client uses PKCE. Routes live in the address's hash (`#/team/ENG/issues/active`), so a GitHub sign-in leaves
  from, and comes back to, the page itself (`authRedirectUrl` in `src/config.ts`) with `?code`. Before leaving, the
  route you were on goes to sessionStorage (`sprawniej:return-to`); `takeReturnedUrl` puts it back first thing and
  turns a sign-in that didn't finish into a message.
- After sign-in, `ensure_profile()` finds your profile. For a GitHub sign-in with no profile yet, it first claims a
  profile with the same GitHub id that has no account (one brought from an older workspace), and otherwise makes one
  from the GitHub login when that handle is free. Otherwise you pick a name and an @handle (`PickLogin.tsx`, `create_profile()`). Handles follow
  GitHub's rule (letters, digits and dashes, up to 39, not starting with a dash).
- **The login never changes; the @handle can** (Handles, below).
- **A new account needs a sign-up code or an invite link** (docs/data-format.md, "Who may make an account"). The
  Create account form sends the code (or, in the invite flow, the link's token) with the sign-up, and the database
  refuses an email account without one before it exists. A GitHub sign-up can't carry a code: its account gets no
  profile until `PickLogin.tsx` asks for one (`signupCodeNeeded`, `giveSignupCode` in `src/backend/auth.ts`), or uses
  the invite link it came from. A code typed before pressing Continue with GitHub is kept in sessionStorage
  (`sprawniej:signup-code`) and filled in there.
- The sign-in stays in this browser (the Supabase client keeps it and renews it). If it runs out while you work,
  everything stays on screen and "Please sign in again" shows on top (`Gate.tsx`).
- **Signing out** (`src/app/signOut.ts`) first gives waiting changes a moment to go (the dialog has already asked about
  anything that can't), ends the sign-in in this browser, deletes the copies of your workspaces
  (`sprawniej-cache`), and forgets what the browser remembers for you (the tour, skipped teams, comment drafts, display
  choices). What stays says nothing about the person or the work: `sprawniej-chrome` (whether the sidebar is open),
  `sprawniej-session-v2` (emptied: no workspace open, none remembered), `sprawniej:old-copies-gone` (the earlier
  version's leftovers are already removed) and `sprawniej:signing-out`, the mark that tells the other tabs it was on
  purpose, so they start over too.
- At start, `forgetOldVersion()` removes once what the earlier version kept in this browser (its session with a
  GitHub key, and its copies of workspaces).

## Workspaces, members and roles

A workspace has members, each an **owner**, an **admin** or a **member** (`workspace_members.role`).

- Everyone reads and changes every issue, comment, label, project, view and team of the workspace, and makes teams.
- Admins and owners also invite people, change roles (not an owner's), remove people (not owners), rename the
  workspace, delete teams, import from Linear and look after people from Linear (invite or link them).
- Owners also make and unmake owners and remove them. Only owners delete the workspace (the database allows it; the
  app has no button for it yet).
- Nobody but an owner changes their own role. Someone who left or was removed comes back only with a new invite.

The database keeps these rules: policies on `workspace_members` and `workspaces`, the `guard_members` trigger, and
`keep_an_owner`, which refuses any change that would leave a workspace without an owner (two owners acting at once
wait for each other on a lock per workspace). `src/data/roles.ts` repeats the rules so Settings only offers what will
work; `tests/roles.test.ts` checks its messages against the database's.

**Leaving** is `leave_workspace()`. **Removing** someone sets `removed_at`: their name still shows on old work, they
can't read or change anything any more, and they get no inbox notes. Realtime checks access when a browser joins a
channel, so a removed member keeps hearing changes until their browser reconnects (a reload, a dropped connection).
For a team of eight that is fine.

## Invites

An invite is a link `#/join/<token>` with a random 144-bit token (`invites.token`). It works once, for 14 days
(`expires_at`, never more than 30 days after it was made), and only admins and owners see a workspace's invites (they
hold the tokens), so invites are never broadcast.

- `invite_info(token)` is what the join page shows before you sign in: the workspace's name, who invited you, the role
  and up to 8 faces. A used or expired link shows no faces and doesn't say whom it was for. Never the token, never an
  email. `anon` may call it (an accepted advisor warning, docs/supabase-work.md).
- `accept_invite(token)` makes you a member (or brings you back), marks the invite used, and, for an invite made for a
  person from Linear (`for_profile`), turns that person into you (`move_person`, below).
- Settings › Invite links makes the links (`InviteDialog.tsx`), with an optional email "so you remember where to send it"
  and a role (member or admin). People send them themselves: Sprawniej sends no email.
- Links point at the app's public address (`publicAppUrl` in `src/config.ts`: `VITE_PUBLIC_URL` at build time, or the
  address it is served from). On localhost a link only works on this computer, and the dialog says so.
- `JoinFlow.tsx` walks through it: the invite, **Join workspace**, an account if you have none (the press of Join is
  kept in this tab, so a trip to GitHub carries on), your name and @handle, and in.

## People from Linear

The Linear import brings everyone whose work it brings. People who haven't joined become **guest profiles**:
`profiles.guest_of` is the workspace, the login starts with `~` (`~jan-kowalski`, which no real handle can) and there
is no account behind them. Issues, comments and views point at them as at anyone; they get no inbox notes. Their
email from Linear, when known, is kept in `private.guest_emails`, which only admins read (`guest_emails()`).

Admins hand their work over in Settings › People from Linear:

- **Invite**: an invite with `for_profile` set. Whoever joins with it becomes that person.
- **Link** (`link_person()`): someone who already joined under another name. It can't be undone.

Both end in `private.move_person`: every reference (assignee, author, creator, project lead, view owner, inbox actor,
history, ids inside history, logins inside view filters, followers, team memberships) moves to the person who joined,
their Linear ids are added to theirs, and the guest is deleted. It is quiet (no history, no broadcast per row) and
ends with one "catch up" message.

## Opening a workspace

`LiveWorkspace.open()` (`src/backend/workspace.ts`):

1. Reads the copy this browser kept (`keep.ts`, `cache.ts`), if there is one that fits (the same project, person,
   app version and newest migration, `SCHEMA_ID`), and shows it at once.
2. Joins the two live channels. Messages that arrive meanwhile are held.
3. With a copy: catches up from the copy's mark. Without one: reads every table of the workspace (`Loader.all` in
   `load.ts`), page by page in key order, 1000 rows a request, saying how far it got ("Getting your team's issues:
   2,000 so far…"). Archived issues are left out.
4. Applies what was read, then the held messages, and catches up once more if anything was missed while joining.

**Catching up** asks for every row whose `changed_at` is after the mark (minus 10 seconds, so nothing that was being
saved at that moment slips through), archived rows too, plus the `deletions` since then, plus the labels, followers and
comments of issues that are new to this browser. It runs after the connection or the channels come back, after the
tab was hidden for more than a minute, after "catch up" messages (an import sends one per batch; they are gathered for
up to 10 seconds), and a few seconds after a team or project is deleted. When this browser last had everything more
than 44 days ago (deletions are kept 45 days), it reads everything again instead.

The **archive**, an issue's history and the comments of archived issues are read only when something needs them
(below).

If the workspace was deleted, or you were removed, a dialog says so and offers **Choose another workspace**.

## The copy in this browser

This browser keeps copies of the 3 workspaces you kept most recently, in one IndexedDB database, `sprawniej-cache`
(`cacheStore.ts`); keeping one drops any copy made for another person or another project. A copy
holds the database's rows only, never your changes still on their way, and the mark they are complete up to. It is
kept a few seconds after the rows change (3 s quiet, never more than 30 s), at once when the tab is hidden or closes,
and before the workspace closes. A copy longer than 20 million characters leaves the archive out; one still too long
isn't kept. A copy that can't be read or applied is dropped and everything is read instead. Signing out deletes the
whole database. A browser that won't keep anything (a private window, full disk) simply reads everything each time.

## Live changes

Every shared table has a `live` trigger (`private.broadcast`, `supabase/migrations/20261019000004_realtime.sql`) that
sends each change to `ws:<workspace id>` (shared rows) or `me:<profile id>` (your inbox notes and read marks). Both
channels are private: the database checks you may listen when you join (`realtime.messages` policy), so the app hands
over the sign-in first. An update sends only the columns that changed, plus the keys and `changed_at`; a delete sends
the keys. A row over 200 kB sends a nudge without its text (`partial`), and the app fetches the row. Imports and
`move_person` send one "catch up" message instead of one per row. Invites, history, used numbers and deletions are
not broadcast.

`applyRows` (`src/backend/apply.ts`, rules in `apply/state.ts`) takes in loads, fetched rows, messages, deletions and
your own changes. Newer wins, column by column (`changed_at`, compared to the microsecond). Your own changes still on
their way stay on top until each is saved or undone. An update for a row the app doesn't have makes it fetch that row;
so does a person or a team it hasn't seen yet. `derive.ts` works out again only what the rows touched, so screens
redraw only what changed.

## Saving (there is no Save button)

An action (`src/data/actions.ts`) works out the row changes, only the columns that changed, and hands them to the
writer (`src/backend/writes.ts`). The writer's rules, from its header:

- A change shows at once and goes on its row's queue. Each row sends one thing at a time, oldest first; a change that
  comes while an earlier one of the same row still waits joins it (quick typing makes one request, not ten).
- A row that points at one still being made (an issue's labels, a comment on a new issue) waits until that one is
  saved. Changes ready together go in as few requests as they can (up to 100 rows, 6 requests at a time).
- Saved: it gives way to the row the database sent back. Refused: it is undone and the person reads why, once
  (`writes/problems.ts`: "Only admins and owners can delete a team.", "It was deleted meanwhile, so your change wasn't
  saved." and so on).
- No answer at all (offline, a busy moment, 30 seconds without an answer): it is tried again after 1, 2, 5, 10 and
  20 s, then every 30 s, and at once when the connection comes back. Meanwhile the chip says so, and closing the tab
  asks first (`beforeunload`).
- Inbox notes, and changes that only make sense once the rest is saved (a view's filter without a deleted team), go
  last, once everything else in their batch is saved.

What the database fills in (issue numbers, authors, times, `changed_at`, history) is never sent: the column grants
refuse it. The app guesses it so it shows at once, and the saved row puts it right.

**The save chip** (`src/app/SaveStatus.tsx`, `src/backend/status.ts`): **Loading…** while opening, **Saving…**,
**Saved**, **Offline**, **Reconnecting…** (nothing of yours waiting, teammates' changes paused), **Not saved yet**
(changes wait for another try), **Signed out**, and **Closed**. Signing out, switching workspace and updating the app
first try to send what's waiting; if something can't go, a dialog asks before it's lost (`components/SignOut.tsx`).

## Two people at once

Nobody is ever asked to choose between versions. Things several people change at once are rows of their own (labels
on an issue, team members, followers, a project's teams), and a save sends only the columns that changed, so two
people's changes rarely touch the same thing. Checked in the browser in phase 5 (docs/supabase-work.md):

| What two people do at the same time | What happens |
| --- | --- |
| Comment on the same issue | Both comments appear |
| Edit different fields of one issue | Both stay |
| Change the same field | The later save wins |
| Add or remove labels on one issue | Both apply (one row each) |
| Edit a description at the same moment | Merged in the editor while you type (`src/editor/mergeText.ts`); if both saves cross, the later whole text wins |
| Edit one view | Field by field; the later save wins for the whole filters |
| Edit one project, team, label or the workspace name | Field by field; the same field: later save wins |
| Join or leave the same team | Both kept (one row each) |
| Create issues in one team | Different numbers; each person's page follows their own issue |
| One deletes an issue, the other edits it | The delete wins; the other is told it was deleted meanwhile |
| One moves an issue to another team, the other edits it | One issue, in the new team, with the edit |
| Mark inbox notes as read on two devices | Both stick |
| One archives an issue, the other edits it | The edit lands; the issue stays archived |
| Delete, archive or move issues away from one team | Numbers are never given out twice |
| Drag issues around | Only the moved issue changes; the same issue: later drop wins |

"Later save" means whichever change reaches the database second.

## Several tabs

Each tab is on its own: its own channels, its own writer and its own queue. They share the sign-in (a sign-out in one
reaches every tab) and the copies in `sprawniej-cache` (whichever tab keeps a copy last wins; a copy from a tab that
was asleep never replaces a fresher one). A tab hears its own saves and the other tabs' saves through the channels,
like a teammate's.

## Issue numbers

`ENG-12` is the team key and a number. The number is given out by the `b_number` trigger
(`private.next_issue_number`): it takes the next one from `teams.last_number`, locking the team's row, so two people
creating issues at the same moment get different numbers. `issue_numbers` remembers every number a team ever gave out
(deleted and moved issues included) and is never emptied, so no number is given twice and an old link never opens a
different issue. Imports keep Linear's numbers and move the counter past them.

The app guesses the next number so the issue shows at once (`nextNumber`); the saved row puts it right, and your page
follows your issue to its real number (`followNumber`). Moving an issue to another team is `move_issue_to_team()`: it
gets a number there and keeps its old one in `former_refs`, so links and mentions of the old number still open it.

## History

The database writes the history: `issue_events`, one row per saved change of an issue (every field that changed in
it, labels added or removed, archived, restored, moved to another team), by the `history` triggers on `issues` and
`issue_labels`. Creating an issue writes none; imports write none. `src/backend/history.ts` reads an issue's events
when its page opens, and only the ones after those already known afterwards. `src/data/history.ts` turns them into
lines ("moved it from Todo to In Progress") and folds a few changes of the same thing by the same person close
together into one (15 minutes for the title and description, 2 for the rest); labels put on while creating an issue
aren't a change. The nightly archive acts for nobody, so its line says "Archived automatically".

## Handles

What you pick at the start is your login (`profiles.login`): the hidden key that filters, history, assignees,
followers and the app's `people` use, and it never changes. (If what you pick is only someone else's login, because
they moved off it, `create_profile()` gives you a login of your own with a short random ending, and what you picked
as your handle.) People see and mention your @handle, `handle ?? login`
(`handleOf` in `src/model/schema.ts`). You change it in Settings › Profile (`MyHandle.tsx`, `changeHandle` in
`src/data/actions.ts`, `set_handle()`), on Enter or when you leave the field, so a half-typed handle never goes out.
The change reaches teammates like any profile change (the `ws:` broadcast and catching up).

Nothing is kept for anyone: once you move off a handle, anyone may take it, and old text that says the old one is
plain text from then on. Stored descriptions and comments are never rewritten. A mention counts (for notes, followers,
links and highlights) only by someone's handle now, case aside (`resolveHandle` in `src/data/mentions.ts`), so the
same text may mention whoever has that handle next. The editor highlights mentions the same way and draws them again
when someone's handle changes; typing @ suggests people by name and handle now and inserts their handle now.

## Inbox notes

Who hears about what is worked out in the browser by pure functions (`src/data/notify.ts`): the new assignee, anyone
newly @mentioned, and the issue's followers for comments and status changes (its creator, assignee, commenters and
everyone mentioned, plus `following = true` rows, minus `following = false`). Nobody hears about their own changes.
The notes are inserted with the change that caused them (last in their batch) and never read back: you can't read
other people's notes.

The database checks them (`c_check_note`): a note for someone who isn't a member now (a person from Linear, someone
who left, yourself) is dropped quietly, and the same note about the same issue from the same person isn't sent again
within ten minutes (notes about a comment always are). Read marks are `inbox.read_at` (one by one) and
`read_state.read_until` ("Mark all as read").
Every night read notes older than 30 days and unread ones older than 90 go; a note counts as read when its `read_at`
is set or it is no newer than `read_until`.

## GitHub

Pull requests move issues (docs/github-app.md). GitHub sends each pull request event, signed with a shared secret,
to the Edge Function `github-webhook` in the same Supabase project. The function is the code in `src/github`
(bundled by `bun run deploy:github`): it checks the signature, works out what the event means (opened or ready: In
Review; merged: Done) and which refs it mentions, and calls two SQL functions only the service role may run.
`github_lookup` finds the workspaces that connected the repository (`github_repos`, Settings › GitHub), the author's
profile there (by `github_id`, members only), the members' handles (for mentions) and the issues. The function works out the Inbox notes with
`src/data/notify.ts`, the same rules the app uses, and `github_apply` moves the issues in one transaction with
`sprawniej.actor` set to the author and `sprawniej.via` to the pull request, so the triggers write history in their
name with a link, the broadcast reaches open browsers and `c_check_note` checks the notes. Nothing moves backwards,
and nothing moves for authors who aren't members with GitHub linked. `ensure_profile` fills `github_id` from the
GitHub sign-in way when someone adds GitHub later.

The same call keeps the pull request itself on the issues it mentions (`issue_pull_requests`), also for events that
move nothing (a draft opened, closed without merging, renamed). Those rows come to browsers like any other shared
row (broadcast on `ws:`, read with their issue, kept in the read cache), and the issue page lists them under the
title (`src/features/issues/PullRequests.tsx`), with their state: Open, Draft, Merged or Closed.

## Archive

Archiving sets `issues.archived_at` (and `archived_by`): the issue stays in the same table, with its comments.
Archiving by hand takes the sub-issues along. Every night `private.auto_archive()` archives finished issues
(Done, Canceled, Duplicate) untouched for longer than their team's `auto_archive` months (6 unless the team picks
otherwise; 0 means never). Untouched is the later of `completed_at` and `updated_at`.

Archived issues aren't read when a workspace opens. `loadArchive()` reads them, with their labels, followers and
comments, when something needs them: the Archived tab, ⌘K search, a link to an archived issue, a project page and an
inbox note about one. Once read, they stay up to date like everything else (catching up reads archived rows too).

## Pictures

A pasted or dropped picture (PNG, JPEG, GIF or WebP, up to 10 MB) is named after its bytes (the first 24 hex digits
of its SHA-256, `src/data/assets.ts`) and uploaded to the private bucket `pictures` as `<workspace id>/<name>`. The
Markdown keeps the short form `/assets/<name>`. The same picture pasted twice is one file, and a file never changes
(upload with upsert off; "already there" counts as done). Only members of the workspace may see and add its pictures
(storage policies on the first folder). Showing one takes an address signed for a day; the addresses needed together
are asked for in one go, kept while the app is open and signed again an hour before they stop working
(`src/backend/pictures.ts`). Pictures are never removed, even when nothing uses them any more (fine at this size), and
they aren't in the backup.

## Ordering and drag-n-drop

Each issue has a `sortOrder` string made with [fractional-indexing](https://github.com/rocicorp/fractional-indexing).
Dropping an issue between two others gives it a key between theirs (`src/data/ordering.ts`), so only the moved issue
changes, and two people reordering at once never clash. List and board use the same order. Dropping into another
column or group also changes that field (status, assignee, priority or project), in the same change.

Dragging is done with dnd-kit (`src/features/issues/useIssueDrag.ts`). While you drag, the order on screen is local
state; nothing is saved until you drop. In a list, sub-issues sit under their parent, so a dropped issue gets its key
from the nearest issues at its own level (top-level issues among top-level ones, sub-issues among their siblings).
Reordering only means something in Manual order; under another ordering a drop can still change the group, and
otherwise we explain where to switch to Manual.

How a built-in page looks (grouping, ordering, what's hidden) is personal: it's kept in this browser per page
(`src/data/displays.ts`), never in the workspace. Filters set on a built-in page are personal too and last until you
leave the page. A saved view is different: its filters and display are columns of its row, so changing them on the
view's page changes the view for everyone.

## Nightly jobs

pg_cron runs three jobs (`supabase/migrations/20261019000008_cron.sql`), each with no signed-in person:

- 02:17 UTC `sprawniej-auto-archive`: archives finished issues (above);
- 02:27 UTC `sprawniej-tidy-inboxes`: read notes older than 30 days, unread ones older than 90;
- 02:37 UTC `sprawniej-forget-deletions`: `deletions` rows older than 45 days.

## Backups

`.github/workflows/backup.yml` makes a data-only dump with `pg_dump` (the rows of `public`, `private`, `auth` and
`storage`; the tables themselves come from the migrations), encrypts the dump with a passphrase (the repository is public, so anyone signed in to GitHub could download a plain
one) and keeps it as an Actions artifact. It is **not switched on**: it runs only when started by hand, and it needs
two repository secrets first, `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE`. docs/supabase-setup.md (Backups) says how to
switch it on and how a restore would go. Pictures aren't in the dump, and a restore hasn't been tried yet.

## Code layout

| Folder | What's inside |
| --- | --- |
| `src/app` | The frame (sidebar, top bar), the way in (`Gate.tsx`), routes, the save chip, sign-out, new versions |
| `src/model` | The app's shapes (zod), the fixed statuses and priorities, team keys |
| `src/data` | The store, pure selectors (filter, group, sort), `actions.ts`, inbox rules, history lines, roles |
| `src/backend` | Every call to Supabase: sign-in, profiles, workspaces and invites, opening, the copy in this browser, live changes, saving, pictures, history, saving imports |
| `src/backend/apply/` | `applyRows` in parts: the copy of the database's rows, taking things in, working out the store |
| `src/backend/writes/` | Sending saves: grouping requests, the transport, what a failure means |
| `src/github` | The GitHub webhook (runs as the Edge Function `github-webhook`, never in the browser): signature, refs, moves, notes |
| `src/editor` | TipTap editor for descriptions and comments, its Markdown, mentions, pictures and merging |
| `src/features/onboarding` | Sign-in, picking your handle, choosing and creating workspaces, joining with an invite |
| `src/features/*` | Screens, one folder per area (issues, views, projects, inbox, settings, import, help…) |
| `src/features/settings/pages.tsx` | The one list of settings pages: the routes, the settings menu and ⌘K follow it (rules in `nav.ts`) |
| `src/components` | Small shared pieces (avatar, empty state, segmented switch) |
| `src/ui` | shadcn/ui components |
| `src/lib` | Small helpers with no app knowledge (search that ignores Polish letters, `cn`, hooks) |
| `src/config.ts` | The app's public address (invite links) and where sign-in comes back to |
| `src/version.ts` | The version and the What's new notes (`CHANGELOG`) |
| `src/session.ts` | Which workspace is open and the ones you opened before (localStorage) |
| `supabase/` | `config.toml` (sign-in and function settings), `migrations/` (the database), `functions/github-webhook` (where the bundle goes), `dev/cleanup-tests.sql` |
| `tests` | `bun test` for the pure logic, with a pretend backend and database (`tests/support`) and test data (`tests/fixtures`: a sample workspace, pretend Linear answers) |
| `tests/db` | Database tests against a real project (`bun run test:db`) |

## Keeping it fast and on the free tier

- A save sends only the columns that changed, and a broadcast only the columns that changed.
- Reads ask for what the app needs, page by page; catching up asks only for what changed since the mark.
- The copy in this browser makes opening read almost nothing: a reload of a workspace that didn't change reads no issue
  rows at all.
- The archive, history and archived issues' comments are read only when needed.
- The store keeps a separate object per kind of thing, and `applyRows` copies only what changed, so a label change
  doesn't redraw issue lists. Sub-issue counters come from one index per version of the issues (`childIndex` in
  `src/data/select.ts`).
- The issue title saves a moment after you stop typing, not on every key.
- The editor and the Markdown formatter load on their own, after the rest of the app. Code blocks colour a short list
  of languages (`src/editor/languages.ts`).

## Main libraries

React 19, Vite, vite-plugin-pwa (the service worker), Tailwind v4, shadcn/ui (Radix), lucide icons, zustand, zod
(types only), supabase-js, ulid (ids), fractional-indexing (manual order), node-diff3 (the editor's line merge),
sonner (messages), TipTap (descriptions and comments, stored as Markdown), react-markdown (showing them),
highlight.js and lowlight (code blocks), react-day-picker (due dates), dnd-kit (drag-n-drop), frimousse (emoji
picker), cmdk (the ⌘K palette), wouter (routes).

## New versions

Sprawniej is a PWA: a service worker keeps the app's files in the browser, so the page itself opens quickly. A release
on GitHub Pages is downloaded in the background, then waits; on its own it would only take over once every Sprawniej
tab is closed. `src/app/updates.ts` asks for a new version every minute and whenever the tab comes back, and when one
is waiting shows a small toast once and an **Update available** button in the top bar (`UpdateButton.tsx`). Nothing
switches by itself. Updating sends whatever is still waiting to be saved, then lets the new version take over and
reloads. Another tab still running the old version recovers through the error screen (`Crash.tsx`), which reloads
once when a part of the old version can't be found any more.
