# Supabase migration: work log

Tracks the implementation of [supabase-plan.md](supabase-plan.md). There is no ticket system for this work, so this
file is the ticket: roadmap, status, findings and questions. Every finding ends as **fixed** or **canceled / won't do**
with a reason.

## Decisions made while building

- 2026-10-19: **No Docker, no local stack.** Development and tests run against `sprawniejapp` itself; it only holds a
  copy of Linear tasks that can be imported again. Database tests are bun tests that talk to the project through its
  API with throwaway test accounts (they never run in plain `bun test`). The runbook for a new project needs no Docker
  either (`supabase db push`, `supabase config push`).
- 2026-10-19: Deleting: only admins and owners delete **teams**; every member can delete labels, projects, views and
  issues, as today.
- 2026-10-19: Backups: the pg_dump workflow is written but **inactive** (manual trigger only, no schedule); the user
  decides later whether to switch it on.
- 2026-10-19: Invites are links people send themselves; everyone picks their own @handle (a GitHub sign-in gets its
  GitHub login when free).
- 2026-10-19: The schema is applied with the CLI (`bunx supabase db reset --linked` while developing, `db push` later); the Supabase MCP refuses SQL with `delete`/`drop` without a confirmation this app can't show. `db reset --linked` replaced `wipe.sql`, and SQL for cleanup runs with `bunx supabase db query --linked`.
- 2026-10-19: `import_rows` matches rows on the primary key (`unique (workspace_id, linear_id)` stays as a guard); `views` got `linear_id`; `invites.for_profile` is `on delete set null`; `ensure_profile`/`create_profile` return a set (no rows = pick a name); one catch-up message per import batch; workspaces leave no deletion notes.
- 2026-10-19: Accepted advisor warning: `anon` can run the SECURITY DEFINER `invite_info` (needs the 144-bit link token; faces only for open links; the workspace id only to members).
- 2026-10-19: Two owners acting at once take a per-workspace lock (`keep_an_owner`), so a workspace always keeps an owner.
- 2026-10-19: Accepted advisor warnings: "signed-in users can execute SECURITY DEFINER function" for the 11 public functions (they are the API, each checks the caller, `anon` can't run them); leaked-password protection (paid plan); "insufficient MFA options" (no MFA in stage A).
- 2026-10-19: Sign-out keeps only `sprawniej-chrome` (whether the sidebar is open): it says nothing about the person or the work.
- 2026-10-19: GitHub Pages is on for the fork (source: GitHub Actions, https://michalsek.github.io/sprawniej/). The build's public settings are repository variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (publishable key) and `VITE_PUBLIC_URL`. The user approved releasing 2.0.0 and starting the Pages build once everything is green.
- 2026-10-19: Catching up reads every changed row, archived ones too, so an open archive gets imported or archived issues without reading the archive again.
- 2026-10-19: Release 2.0.0: `sprawniejapp` was wiped and rebuilt from the 10 migration files with `db reset --linked` (history matched, `db push` up to date with no database password asked, generated types identical, only accepted advisor warnings), then 90/90 database tests passed and the test data was removed. GitHub sign-in is off at release (the button is hidden until the OAuth app is pushed).
- 2026-10-19: Work happens in the session's worktree; `main` is fast-forwarded to it after each step (the session
  can't write in the main checkout directly).
- 2026-10-20: Sign-up codes (2.1.0). The user wanted control over who can make an account, codes managed in the SQL
  editor, invite links counting as permission, and GitHub sign-up kept. Email sign-ups are checked by the free
  "before user created" Auth hook (`private.before_user_created`, switched on with a `config push` of a config.toml
  that declares only the hook, so the remote GitHub keys and other settings stay); GitHub can't carry a code, so its
  accounts get no profile (trigger `a_let_in`) until `use_signup_code()`, and are deleted after 7 days without one.
- 2026-10-20: GitHub pull requests move issues (2.2.0, the "Later" item of plan section 11; design in
  docs/github-app.md). The App is "Gitniej (Sprawniej)", private to the account; the Edge Function `github-webhook`
  never calls GitHub (no private key), reaches the database only through `github_lookup`/`github_apply` (service role),
  and moves issues only for authors who are members with GitHub linked. Other events the App is subscribed to get 204
  unread. Pull request links on the issue page are left for later.
  The hook's refusal reaches supabase-js as status 403, code `unknown`, with our sentence as the message, so the app
  recognises the sentences themselves (`SIGNUP_REFUSALS`). Accepted advisor warning, as above, for the two new
  signed-in functions `signup_code_needed` and `use_signup_code`.
- 2026-10-20: Invite links for several people (`max_uses` and `ended_at` on invites, `invite_uses`, one rule in
  `private.invite_state`). Accepted advisor warning, as above, for the new signed-in function `end_invite`: it checks
  that you are an admin or owner of the link's workspace itself.

## Roadmap

Status: `todo`, `doing`, `done`.

| # | Phase | Status | Notes |
| --- | --- | --- | --- |
| 0 | Plan merged into `main`, Supabase CLI as a dev dependency | done | |
| 1 | Database schema, settings, DB tests (`supabase/`, `tests/db`, generated types) | done | 95beeff + fix round; 53/53 DB tests, QA attack scripts pass |
| 2 | Linear mapping returns rows (pure code, `linearMap.ts`) | done | 70b978b, be04249 and a last fix; QA and code review passed |
| 3 | Backend groundwork: `rows.ts`, `apply.ts`, registry, store additions | done | 2b367bd + fix round; QA probes re-run |
| 4 | Signing in and opening a workspace (read path, realtime, catch-up in memory) | done | 537747e + fix round; 23/23 browser scenarios, 59/59 DB tests |
| 5 | Saving: `writes.ts` and `actions.ts` on rows | done | 80d144b + fix round; QA's Q1-Q15 and 22 browser cases pass |
| 6 | Linear import end to end (`import_rows`) | done | cf67730 + fix round, merged in 38797db; 88/88 DB tests; every step-kind failure recovers |
| 7 | History and pictures | done | 773dc82 + fix round, merged in cca59f9 |
| 8 | Team features: invites, members and roles, people from Linear, ways to sign in | done | 632eef6 + fix round, merged; 82/82 DB tests, browser cases pass |
| 9 | Read cache and catch-up from IndexedDB | done | 5770657 + fix round, merged in 80b8021; a reload reads 0 issue rows |
| 10 | Remove the old code, docs, CLAUDE.md, inactive backup workflow | done | 035d3db + fix round; final full-app QA passed (26 scenarios) |
| 11 | Prove the runbook on a wiped project, GitHub Pages, release 2.0.0 | done | 48a4db6 published to https://michalsek.github.io/sprawniej/ (Pages run 39316971275) |

## Two people at once (checked in phase 5, browser)

| What two people do at the same time | What happens now |
| --- | --- |
| Comment on the same issue | Both comments appear |
| Edit different fields of one issue | Both stay |
| Change the same field | The later save wins |
| Add or remove labels on one issue | Both apply (one row each) |
| Edit a description at the same moment | Merged in the editor while you type; if both saves cross, the later whole text wins |
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

## Released, and what's left for you

2.0.0 is published at https://michalsek.github.io/sprawniej/ (commit 48a4db6). Checked on the published site without
signing in: the page loads, it knows where workspaces live (not "isn't set up"), the GitHub button is hidden while
GitHub sign-in is off, no console errors. The same build passed the two-person smoke test on localhost (sign up,
workspace, issue, reload, invite and join, live changes, sign out and in). The project `sprawniejapp` is empty.

1. **First sign-in on the published site** (not done by the agents: it means making an account on a real address).
   Open the site, create your account, pick your handle, create the workspace.
2. **Linear import:** Settings › Import from Linear, with your own Linear key.
3. **GitHub sign-in (optional):** from this repo's folder, with your OAuth app's values:
   `SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID=… SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET=… bunx supabase config push --project-ref wkqofiacqfuxowavuqxj`
   (`supabase/.env` needs `SPRAWNIEJ_SITE_URL=https://michalsek.github.io/sprawniej/`; run `bunx supabase config diff` first.)
4. **Backups (when you want them):** add the repository secrets `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE`, run
   *Back up the database* once by hand, then remove the `#` in front of its schedule. A restore hasn't been tried yet
   (docs/supabase-setup.md, Backups).
5. **Once teammates work in `sprawniejapp`:** database tests need a separate development project from then on.

## Findings

Anything wrong or worth improving that turned up along the way, in this work or in the existing code.

| # | Found by | What | Status | Reason / where fixed |
| --- | --- | --- | --- | --- |
| P1 | roadmap planner | Definition order: `private.my_profile_id()` is used as a column default and reads `profiles`, so helpers must come right after `workspace_members`, before the other tables | fixed | 95beeff: tables.sql, triggers.sql (authors stamped by triggers) |
| P2 | roadmap planner | Function permissions: grant on `private` functions only covers existing ones; public security-definer RPCs are callable by `anon` unless revoked | fixed | 95beeff: helpers.sql and each file's closing revokes |
| P3 | roadmap planner | Upsert vs number trigger: BEFORE INSERT fires on `on conflict do update`, so a re-import collides in `issue_numbers`; a second run must touch nothing (`is distinct from excluded`) | fixed | 95beeff: triggers.sql `next_issue_number`; functions.sql `import_rows` |
| P4 | roadmap planner | `import_rows` is security definer and generic: must pin `workspace_id`, whitelist tables/columns, only insert/update guest profiles of that workspace | fixed | 95beeff: functions.sql `import_rows`, `import_spec` |
| P5 | roadmap planner | Guest logins unique across all workspaces would collide on a second workspace; use partial unique indexes and forbid `~` for real accounts | fixed | 95beeff: tables.sql (login check, partial unique indexes) |
| P6 | roadmap planner | Clients can set server-only columns (`changed_at`, `last_number`, `linear_id`, `created_by`) on tables without column grants; force `changed_at` by trigger everywhere and add column grants | fixed | 95beeff: rls.sql column grants; triggers.sql `a_stamp` |
| P7 | roadmap planner | Owners: admins can make themselves owner or demote the owner; the last-owner trigger isn't written | fixed | 95beeff: triggers.sql `guard_members`, `keep_an_owner` |
| P8 | roadmap planner | Casts in realtime and storage policies throw on bad input instead of denying; compare as text | fixed | 95beeff: realtime.sql, storage.sql (text comparison) |
| P9 | roadmap planner | `invites` must not be broadcast (tokens would reach every member) | fixed | 95beeff: helpers.sql wiring (no topic for invites) |
| P10 | roadmap planner | Turning a guest into a member must also move `issue_events.actor_id`, ids inside `changes`, and logins in `views.filters`; guest deletion tombstone uses `guest_of` | fixed | 95beeff: functions.sql `move_person`, `swap_login` |
| P11 | roadmap planner | Removed members can still edit their comments; add the membership check to comment update/delete | fixed | 95beeff: rls.sql comment policies |
| P12 | roadmap planner | One non-member recipient fails a whole inbox insert; filter in the trigger, restrict insert columns | fixed | 95beeff: triggers.sql `check_note` |
| P13 | roadmap planner | The update-times trigger must skip its logic during imports, or re-imports overwrite Linear's times | fixed | 95beeff: triggers.sql `issue_times`, `comment_times` |
| P14 | roadmap planner | `move_issue_to_team`: use `if not found`, grant to `authenticated` only | fixed | 95beeff: functions.sql `move_issue_to_team` |
| P15 | roadmap planner | Imports are silent (no broadcast); send one catch-up message at the end | fixed | 95beeff: functions.sql (one catch-up message) |
| P16 | roadmap planner | `remember_deletion` on `workspaces` must use `id`, not `workspace_id`; pass the column as an argument | fixed | 95beeff: triggers.sql `remember_deletion` (workspaces leave no notes) |
| P17 | roadmap planner | Nightly auto-archive must match `tidyArchive` (greatest(completed_at, updated_at), skip 0) | fixed | 95beeff: cron.sql `auto_archive` |
| P18 | roadmap planner | Catch-up must include archived rows; index `(workspace_id, changed_at)` without the `archived_at is null` predicate | fixed | 95beeff: tables.sql catch-up indexes |
| P19 | roadmap planner | Newer-only comparisons must keep microsecond precision of `changed_at`, not `toISOString()` | fixed | 2b367bd: `rows.ts` keeps raw `changed_at` and compares microseconds |
| P20 | roadmap planner | Redirect URLs need `http://localhost:4173` and the Pages URL with `/**`; `publicAppUrl()` is null on localhost so sign-in needs its own redirect helper | fixed | phase 11 (redirect list and site address pushed; local sign-in still allowed) |
| P21 | roadmap planner | Bucket insert needs `on conflict do nothing`; storage objects can't be deleted with plain SQL (wipe through the Storage API) | fixed | 95beeff: storage.sql; `db reset --linked` replaces wipe.sql |
| P22 | roadmap planner | Per-table policies and triggers the plan shows once: generate them in one loop, with a test that every table has them (except `issue_events`, `issue_numbers`) | fixed | 95beeff: helpers.sql `private.wiring` loops; tests/db/wiring.test.ts |
| P23 | roadmap planner | Realtime checks access at join: a removed member keeps receiving until they rejoin; acceptable for 8 people, document it | fixed | 95beeff: realtime.sql comment, supabase-setup.md |
| P24 | roadmap planner | The plan text still mentions pgTAP, `seed.sql`, the local stack and `importRepo.ts`; update it for the no-Docker decision | fixed | 95beeff: docs/supabase-plan.md updated |
| E1 | roadmap planner | `tsconfig.app.json:28` only includes `src`, so `tests/` are never type-checked by `tsc -b` | fixed | phase 10 (tsconfig.test.json; tests type-checked) |
| E2 | roadmap planner | `package.json`: the `cn` package is unused (`src/lib/utils.ts` defines its own `cn`) | fixed | phase 10 |
| E3 | roadmap planner | `ImportPage.tsx:78` subscribes to the whole store (`useData((s) => s)`), redrawing the wizard on every change | fixed | phase 6 (merged in 38797db) |
| E4 | roadmap planner | `ImportPage.tsx:304-306` a failed import still shows "done" with only a console warning | fixed | phase 6 (merged in 38797db) |
| E5 | roadmap planner | `actions.ts` `createLabel` accepts a duplicate name while `updateLabel` refuses it | fixed | phase 5: returns the existing same-name label |
| E6 | roadmap planner | `Markdown.tsx:24` runs `linkReferences`/`findByRef` (a scan of all issues per reference) in a store selector on every change | fixed | phase 10 (ref index) |
| E7 | roadmap planner | `linearMap.ts:74` the accent-stripping regex uses invisible literal combining characters instead of `\u0300-\u036f` | fixed | 70b978b (amendment A4) |
| E8 | roadmap planner | `joinLink.ts:17` + `config.ts:14`: no join link at all on localhost, so stage A can't make invite links | fixed | phase 8 (merged) |
| E9 | phase 2 planner | `linearMap.ts:141-146,326` links are rewritten against Linear refs: after renumbering (ENG-2 to ENG-4) or a changed key, a link points at the wrong issue or isn't rewritten | fixed | phase 6 (merged in 38797db) |
| E10 | phase 2 planner | `linearMap.ts:305` re-importing only some teams drops the other teams from a project's `teams` | fixed | phase 6 (merged in 38797db) |
| E11 | phase 2 planner | `linearMap.ts:402` re-importing only some teams clears `parent` for sub-issues whose parent is in a team not picked this time | fixed | 2nd phase 2 commit (parent falls back to issues already here) |
| E12 | phase 2 planner | `linearMap.ts:415` the import archives by `completedAt ?? updatedAt`, `tidyArchive` by the later of the two | fixed | 70b978b (amendment A2) |
| E13 | phase 2 planner | `linearMap.ts:250` a team taking a different Linear team overwrites `linearId`, so the earlier one is no longer pre-picked | won't do | the database allows one Linear id per team; ticking the other team again works |
| E14 | phase 2 planner | `linearMap.ts:275-279` a label matched by name never records its `linearId`, so a rename in Linear makes a second label | fixed | 70b978b (amendment A3) |
| E15 | phase 2 planner | `linearMap.ts:226` a guest's name and picture are never refreshed on re-import | fixed | phase 6 (merged in 38797db) |
| E16 | phase 2 planner | `linearFilters.ts:15` circular import with `linearMap.ts` (works only because `mapStatus` is used at call time) | fixed | phase 6 (merged in 38797db) |
| E17 | phase 2 planner | `linearApi.ts:205` (`labels(first: 50)`) and `:173` (`teams(first: 20)`) silently cut off longer lists | won't do | raising the nested list sizes multiplies the cost of every Linear query; no team here has that many labels or teams per item |
| E18 | phase 2 planner | `src/lib/plain.ts:8` same invisible combining-character regex as E7 | fixed | 70b978b (amendment A4) |
| E19 | phase 2 planner | `tests/fixtures/linear.ts:1` mentions a browser test's pretend Linear that doesn't exist | fixed | phase 6 (merged in 38797db) |
| E20 | phase 2 planner | `tests/linearImport.test.ts:123,274,283,295,302` invalid `now` values silently switch the archive rule off | fixed | 70b978b (amendment A5) |
| E21 | phase 1 planner | `vite.config.ts:20` the app's install description still says the workspace is kept in a GitHub repo | fixed | phase 10 (manifest) |
| E22 | phase 1 planner | `src/data/select.ts:192` `isUnread` compares ISO strings, so database times must come in `toISOString` form (P19) | fixed | 2b367bd: `iso()` on every model time |
| E23 | phase 1 planner | `actions.ts` `createIssue`: an issue created as Done gets `completedAt: null`; the new trigger sets it (small behaviour change) | fixed | phase 5 |
| E24 | phase 1 planner | `actions.ts` `toldRecently` moves to the database (`check_note` trigger); delete it | fixed | phase 5 (the `check_note` trigger) |
| E25 | phase 1 planner | `.github/workflows/pages.yml` runs `bun test`; safe only while `tests/db` stays gated on `SPRAWNIEJ_DB_TESTS` | fixed | phase 10 (documented in supabase-setup.md) |
| E26 | phase 1 planner | Labels added right after an issue is created will write history rows (today none); history folding or one-call create should hide them | fixed | phase 7 (merged in cca59f9) |
| E27 | phase 1 planner | Someone with a fresh profile who later links GitHub should have their old imported profile merged into theirs (needs a cross-workspace move) | won't do | no import from a GitHub workspace in this run, so no such profiles exist |
| E28 | phase 2 implementer | `linearMap.ts` `orderKeys`: when two Linear teams join one team here, their issues can get the same `sortOrder` | fixed | phase 2 fix round (F4) |
| E29 | phase 2 implementer | `linearMap.ts` comment loop: `archivedHere` doesn't check the team, so a comment on an archived issue of a team not chosen could be added (low risk) | won't do | comments are only read for the picked teams, so it can't happen |
| E30 | phase 2 implementer | `ImportPage.tsx` saving/done stages, `doneText`, `saveState` and some imports are unreachable while Import is off | fixed | phase 6 (merged in 38797db) |
| E31 | phase 2 implementer | `ImportPage.tsx` `existingFrom` turns `lastNumber` into 1..lastNumber, keeping the old rule until real used numbers come in | fixed | phase 6 (merged in 38797db) |
| E32 | phase 2 code review | Row types accept misspelled keys because `.passthrough()` types have an index signature | fixed | phase 2 fix round (F3) |
| E33 | phase 2 code review | `isNew` and guest `email` travel inside rows though they aren't columns; an existing team re-sends its whole row | fixed | phase 2 fix round (F1) |
| E34 | phase 2 code review | The archive rule is copied between `linearMap.ts` and `actions.ts` `tidyArchive` | fixed | phase 2 fix round (F5) |
| E35 | phase 2 code review | Numbering logic (`existingFrom`) lives untested in `ImportPage.tsx`; used numbers marked twice | fixed | phase 2 fix round (F6) |
| E36 | phase 2 code review | `docs/linear-import.md` still describes files, parts of 300 files and archive files | fixed | phase 2 fix round (F11) |
| E37 | phase 2 code review | `ImportPage.tsx` builds the plan (with fresh ids) inside `useMemo` during render | fixed | phase 2 fix round (F9) |
| E38 | phase 2 code review | `importFiles` (`actions.ts`) and `relinkArchived` (`relink.ts`) have no callers | fixed | phase 2 fix round (F10) |
| E39 | phase 2 code review | `src/model/schema.ts` uses `.passthrough()`, deprecated in Zod 4 (`.loose()`) | fixed | phase 10 (`.loose()`) |
| E40 | phase 2 code review | `src/data/relink.ts:97` compares with key-order-sensitive `JSON.stringify` while `linearMap` has its own `same` | fixed | phase 10 (relink.ts deleted) |
| E41 | phase 2 QA | A new Linear issue sorting first makes every issue of its team come back as changed (sort keys rebuilt per run) | fixed | phase 2 fix round (F4) |
| E42 | phase 2 QA | Guest rows carry `githubId: 0` but `profiles.github_id` is unique; the client mapping must send null | fixed | 2b367bd: `rows.ts` maps githubId 0 to null |
| E43 | phase 2 QA | A team row can take a Linear id another team still holds (unique per workspace) | fixed | phase 2 fix round (F1) |
| E44 | phase 2 QA | `docs/supabase-plan.md` says `import_rows` upserts on `(workspace_id, linear_id)`; it must be the primary key | fixed | 95beeff (plan says primary key) |
| E45 | phase 2 QA | Change detection on re-import needs `rows.ts` to return the same text the import writes (times as `.000Z`) | fixed | 2b367bd: round trip tested with the real import |
| E46 | phase 2 QA | `setMonth` rolls past month end (Aug 31 minus 6 months is Mar 3), in both the import and `tidyArchive` | fixed | phase 2 fix round (F5, UTC with day clamp) |
| E47 | phase 2 QA | The renumbered note shows the key here, not Linear's identifier | fixed | phase 2 fix round (F7) |
| E48 | phase 2 QA | Import page copy says "Ready to import" and "run the import again later" while saving is off | fixed | phase 2 fix round (F9) |
| E49 | phase 2 implementer | `docs/user-guide.md:258` says the import can be run again later while Import is off | fixed | phase 6 (merged in 38797db) |
| E50 | phase 2 implementer | `tests/linearImport.test.ts` `native()` makes sort orders like `a50`, not valid fractional keys; a future test adding issues would throw | fixed | phase 2 QA re-check (`native()` makes valid keys) |
| E51 | phase 2 implementer | `monthsBefore` now uses UTC; the nightly cut-off moves by a few hours at most | won't do | a few hours either way is harmless, and UTC matches the database job |
| E52 | phase 2 QA re-check | Two teams here swapping their Linear teams emitted two non-null links, colliding on the unique Linear id | fixed | phase 2 last fix (release first) |
| E53 | phase 2 QA re-check | An invalid sort key in a team made the import wizard's Continue button silently do nothing | fixed | phase 2 last fix (error shown on the people step) |
| E54 | phase 1 implementer | Inbox notes must be inserted without asking for the rows back (`.select()` fails: the sender can't read others' notes) | fixed | phase 5 (notes sent without `.select()`) |
| E55 | phase 1 implementer | The realtime sign-in token must be set before joining a private channel, or the join is refused | fixed | phase 4 (`setAuth()` before joining) |
| E56 | phase 1 implementer | `db reset --linked` also deletes sign-in accounts: fine in development, a hazard anywhere else | fixed | phase 10 runbook warning and project check; used in phase 11 |
| E57 | phase 1 implementer | Deletion notes of a deleted workspace stay until the 45-day job | won't do | harmless, nobody can read them, the job removes them |
| E58 | phase 3 planner | `project.ts:127` sorts comments by `createdAt` with no tiebreak | fixed | phase 10 (project.ts deleted) |
| E59 | phase 3 planner | `select.ts` `isUnread` does `read.includes` per note (quadratic for unread counts) | fixed | phase 10 |
| E60 | phase 3 planner | `schema.ts:14` `iso = z.string()` checks nothing, so a `+00:00` time passes silently | won't do | rows are no longer parsed by the schemas; `rows.ts` normalises every time with `iso()` |
| E61 | phase 3 planner | `actions.ts` `markAllRead` takes the newest `at` by string compare; right only while all times are in Z form | fixed | 2b367bd: all times in Z form |
| E62 | phase 3 planner | `docs/supabase-plan.md` `broadcast()` text differs from the shipped one (keys in updates, `last_number` skipped, profiles loop) | fixed | phase 10 (plan status and pointer) |
| E63 | phase 1 QA | CRITICAL: `import_rows` let an admin of their own workspace overwrite rows of any other workspace (issues, comments, teams, labels, projects, views, followers) | fixed | phase 1 fix round, commit after 62a9e22 (S1) |
| E64 | phase 1 QA | `import_rows` let an admin rewrite a member's comment, bypassing the author-only rule | fixed | phase 1 fix round, commit after 62a9e22 (S2) |
| E65 | phase 1 QA | People outside a workspace can be attached as assignee, team member, follower or project lead | fixed | phase 1 fix round, commit after 62a9e22 (S3) |
| E66 | phase 1 QA | An admin can bring back someone who left or was removed without an invite | fixed | phase 1 fix round, commit after 62a9e22 (S4) |
| E67 | phase 1 QA | Imported issue numbers have no bounds (a huge number breaks every later issue in the team) | fixed | phase 1 fix round, commit after 62a9e22 (S5) |
| E68 | phase 1 QA + review | Private functions created later are open to everyone unless each file revokes them (no default-privileges revoke) | fixed | phase 1 fix round, commit after 62a9e22 (S6) |
| E69 | phase 1 review | `import_rows` can't update part of a row (NOT NULL is checked before conflict handling); undocumented | fixed | phase 1 fix round, commit after 62a9e22 (Q1) |
| E70 | phase 1 review | The policy/trigger wiring loops only run once; a later table would get none | fixed | phase 1 fix round, commit after 62a9e22 (Q2) |
| E71 | phase 1 review | `import_spec` repeats `wiring` (and tests/db/support.ts a third time) | fixed | phase 1 fix round, commit after 62a9e22 (Q3) |
| E72 | phase 1 review | Repeated SQL logic: number hand-out, the import flag + catch-up dance, the login pattern, completed statuses | fixed | phase 1 fix round, commit after 62a9e22 (Q4) |
| E73 | phase 1 review | Generated types make `issues.number` required on insert though the trigger fills it | fixed | phase 1 fix round, commit after 62a9e22 (Q5) |
| E74 | phase 1 review | Some database error messages say "rows" or show table names, against the writing rules | fixed | phase 1 fix round, commit after 62a9e22 (Q6) |
| E75 | phase 1 review | Runbook gaps: how to switch GitHub on, the real site address, tests only on development projects, Realtime public access | fixed | phase 1 fix round, commit after 62a9e22 (Q7) |
| E76 | phase 1 review | DB tests aren't typed (`any`, casts) though generated types exist | fixed | phase 1 fix round, commit after 62a9e22 (Q8) |
| E77 | phase 1 review | `wiring.test.ts` doesn't cover every wired table; inbox keep times aren't checked against the app | fixed | phase 1 fix round, commit after 62a9e22 (Q9) |
| E78 | phase 1 review | Migration files are dated tomorrow, so a migration made today would sort before them | fixed | phase 1 fix round, commit after 62a9e22 (Q13) |
| E79 | phase 1 QA | `cleanup-tests.sql` deletes every profile starting with `dbt-`, which could hit a real person | fixed | phase 1 fix round, commit after 62a9e22 (Q16) |
| E80 | phase 1 review | Redundant indexes already covered by primary keys | won't do | the foreign-key advisor wants indexes that start with the foreign-key columns |
| E81 | phase 1 QA | Re-imports never update `archived_at` or `sort_order` | won't do | by design: archive state and order here are kept |
| E82 | phase 1 QA | Deleting a workspace also sends one message per guest profile | won't do | harmless |
| E83 | phase 1 review | The team key pattern is copied three times and the login pattern four times in the app | fixed | phase 10 |
| E84 | phase 1 review | `src/data/store.ts:61` issue references match `[A-Z][A-Z0-9]*`, looser than team keys | fixed | phase 10 |
| E85 | phase 4 planner | Sign-out leaves other `sprawniej:` keys and comment drafts on a shared computer | fixed | phase 4 fix round |
| E86 | phase 4 planner | `session.toured` is never read (the tour uses its own key) | fixed | phase 4 fix round |
| E87 | phase 4 planner | `Crash.tsx:37` and docs/design.md promise changes are kept on this device | fixed | phase 5 (Crash, chip tips, user guide) |
| E88 | phase 4 planner | `Step.tsx:33` `Problem` uses a raw red instead of a theme colour | fixed | phase 10 |
| E89 | phase 4 planner | `Tour.tsx:28-33` queries the page on every animation frame while a tip is open | won't do | the loop runs only while one of 4 first-visit tips is open |
| E90 | phase 4 planner | `updates.ts:50-52` adds an interval and listeners on every registration and never removes them | fixed | phase 10 |
| E91 | phase 3 QA | A big description can stay stale or empty for good (a small update clears the partial flag) | fixed | phase 3 fix round, commit after 62a9e22 (B1) |
| E92 | phase 3 QA + review | An unsaved edit of yours keeps a row on screen after a teammate deletes it, and asks to fetch an empty key; a failed insert leaves a ghost | fixed | phase 3 fix round, commit after 62a9e22 (B2) |
| E93 | phase 3 QA | Unsaved edits are matched by value, so A, B, A edits flicker | fixed | phase 3 fix round, commit after 62a9e22 (B3) |
| E94 | phase 3 QA | A missing person or team is fetched once only, never again after a failure | fixed | phase 3 fix round, commit after 62a9e22 (B4) |
| E95 | phase 3 QA | An inbox message from another workspace moves the catch-up mark | fixed | phase 3 fix round, commit after 62a9e22 (B5) |
| E96 | phase 3 QA | Re-delivered old child rows can come back after their parent was deleted | fixed | phase 3 fix round, commit after 62a9e22 (B6) |
| E97 | phase 3 review | `applyRows` is one 513-line function with 26 inner closures; the unsaved-changes rules aren't written down | fixed | phase 3 fix round, commit after 62a9e22 (C1, C2) |
| E98 | phase 3 review | Typed mirror thrown away (`as unknown as`), non-null assertions, untyped KNOWN sets | fixed | phase 3 fix round, commit after 62a9e22 (C3, C5) |
| E99 | phase 3 review | Write helpers send columns signed-in people can't write; `Change.fields` isn't limited to writable columns | fixed | phase 3 fix round, commit after 62a9e22 (C4) |
| E100 | phase 3 review | `src/config.ts:5` env reads have no types | fixed | phase 3 fix round, commit after 62a9e22 (C6) |
| E101 | phase 3 review | `select.ts:65` `PRIORITY_RANK.get(...)!` gives NaN for an unknown priority | fixed | phase 10 |
| E102 | phase 4 review | A failure while opening (channel join or a bad row) leaves the spinner up for good | fixed | phase 4 fix round |
| E103 | phase 4 review | Offline, the GitHub button says GitHub isn't switched on | fixed | phase 4 fix round |
| E104 | phase 4 review | Sign-out tells other tabs before the sign-in is gone (double reloads, timing-dependent) | fixed | phase 4 fix round |
| E105 | phase 4 review | The old `sprawniej-session` (with a GitHub key) stays until someone signs out | fixed | phase 4 fix round |
| E106 | phase 4 review | The chip says "Not saved yet" during a slow join or short drop with nothing waiting | fixed | phase 4 fix round |
| E107 | phase 4 review | `LiveWorkspace` lifecycle (open/close/catch-up/reopen) has no tests | fixed | phase 4 fix round |
| E108 | phase 4 review | A GitHub sign-in that fails to finish says nothing and leaves `sb_flow_id` in the address | fixed | phase 4 fix round |
| E109 | phase 4 review | New uses of the deprecated `FormEvent` type | fixed | phase 4 fix round |
| E110 | phase 4 review | A failed fetch of asked-for rows is never retried | fixed | phase 4 fix round |
| E111 | phase 4 review | Paging stops by comparing with 1000 rows, the server's row limit | fixed | phase 4 fix round |
| E112 | phase 4 implementer | `useHistory.ts:57` and `ImportPage.tsx:72` still read the old save status | fixed | phase 7 (merged in cca59f9) |
| E113 | phase 4 implementer | After a workspace goes away while open, the chip keeps saying Saved behind the dialog | fixed | phase 4 fix round |
| E114 | phase 5 planner | Settings: "Your GitHub profile stays as it is" / "Use your GitHub name" mean nothing now | fixed | phase 8 (merged) |
| E115 | phase 5 planner | TeamMenu offers "Delete team" and Settings an editable workspace name to members who can't | fixed | phase 8 (merged) |
| E116 | phase 5 planner | `Editor.tsx:26` imports `mergeText` from `src/sync/merge.ts` (deleted in phase 10) | fixed | phase 5 (`src/editor/mergeText.ts`) |
| E117 | phase 5 planner | `last_number` is never broadcast, so `team.lastNumber` goes stale (number guesses corrected by the saved row) | won't do | the saved row corrects the number; broadcasting every counter change is noise |
| E118 | phase 5 planner | Switching workspace has no "not saved yet" warning like signing out | fixed | phase 5 (`useSwitchWorkspace` asks) |
| E119 | phase 5 planner | docs/architecture.md and docs/design.md still describe file merging and changes kept on the device | fixed | phase 10 (docs rewritten) |
| E120 | phase 6 planner | Views can't change `team_id` through `import_rows` | won't do | a Linear view moving teams is rare; recreate it by hand |
| E121 | phase 6 planner | `loadTable` reloads only active issues, so a big catch-up misses archived rows | fixed | phase 9 (merged in 80b8021) |
| E122 | phase 6 planner | Existing teams never get newly matched people as members on re-import | fixed | phase 6 (merged in 38797db) |
| E123 | phase 7 planner | `statusOf` uses a non-null assertion: an unknown status crashes a screen | fixed | phase 7 (merged in cca59f9) |
| E124 | phase 7 planner | Every description save writes its own history row | won't do | folded on screen; about 100 bytes a row is fine for 8 people |
| E125 | phase 7 planner | The nightly archive doesn't take sub-issues along, while archiving by hand does | won't do | each finished issue goes on its own, as the old tidy-up did |
| E126 | phase 7 planner | Pictures nobody uses any more are never removed, and pictures aren't in any backup | won't do | unused pictures are tiny for 8 people (1 GB limit); pictures aren't in the dump, noted in backup.yml and architecture.md |
| E127 | phase 8 planner | Admins can set any invite expiry (years) | fixed | phase 8 (merged) |
| E128 | phase 8 planner | In stage B the email confirm link drops `#/join/<token>` | won't do | confirmations are off in stage A; written into the stage B checklist in supabase-setup.md |
| E129 | phase 8 planner | `invites.for_login` is no longer written | won't do | a harmless nullable column; dropping it needs a migration for no gain |
| E130 | phase 8 planner | GitHub added later never fills `github_id` or an empty avatar | won't do | no import from a GitHub workspace in this run, nothing to claim |
| E131 | phase 8 planner | There is no way in the app to delete a workspace | won't do | not needed for the first team; owners can ask |
| E132 | phase 9 planner | Catch-up reads changed profiles across all your workspaces and filters in the browser | fixed | phase 9 (merged in 80b8021) |
| E133 | phase 9 planner | Inbox deletions leave no note, so catch-ups in memory miss notes removed meanwhile | fixed | phase 9 (merged in 80b8021) |
| E134 | phase 9 planner | `profileId` isn't kept across reloads, so even a cached open waits for one request | won't do | one small request; keeping it adds a stale-profile case |
| E135 | phase 4 QA | A deep link is lost after signing in and picking a workspace | fixed | phase 4 fix round |
| E136 | phase 4 QA | Waiting screens repeat their title as their text | fixed | phase 4 fix round |
| E137 | phase 4 QA | The profile load error always blames the connection | fixed | phase 4 fix round |
| E138 | phase 4 QA | An issue page stays blank if loading the archive fails once | fixed | phase 4 fix round |
| E139 | phase 4 QA | Sidebar "Your GitHub profile" links to github.com/<handle>, but handles are free now | fixed | phase 4 fix round |
| E140 | phase 4 QA | `cleanup-tests.sql` wipes every dbtest workspace, also another run's in progress | fixed | each run cleans up only its own run when it ends (`tests/db/cleanup.ts`); `cleanup-all-tests.sql` is the everything option |
| E141 | phase 5 implementer | supabase-js writes had no timeout: a dead connection hung saving for good | fixed | phase 5 (`send.ts`, 30 s) |
| E142 | phase 5 implementer | PostgREST answers P0002 with HTTP 500, so retrying by status alone would retry a missing row forever | fixed | phase 5 (`problems.ts` reads the code first) |
| E143 | phase 5 implementer | `SetupWorkspace.tsx:29` dead GitHub-era screen ignores `startWorkspace`'s promise | fixed | phase 10 (deleted) |
| E144 | phase 5 implementer | `select.ts:214` `isUnread` still checks `read.includes` though `read` is always empty | fixed | phase 10 |
| E145 | phase 5 QA + review | A retried insert batched with fresh inserts makes the fresh ones undone (and fresh inbox notes silently dropped) | fixed | phase 5 fix round (W1) |
| E146 | phase 5 QA | Changes made while the workspace re-opens are lost (also typed text handed over on unmount) | fixed | phase 5 fix round (W2) |
| E147 | phase 5 QA | "Too far back" uses the newest row's time, so a quiet workspace re-opens on every catch-up | fixed | phase 5 fix round (W3) |
| E148 | phase 5 QA | A refused team delete still saves its view-filter changes | fixed | phase 5 fix round (W4) |
| E149 | phase 5 review | A failed reopen followed by Try again drops what's waiting | fixed | phase 5 fix round (W5) |
| E150 | phase 5 review + QA | The test fake isn't faithful (duplicates, foreign keys, column grants, note filters), so writer tests miss real failures | fixed | phase 5 fix round (W8) |
| E151 | phase 5 QA | "It was deleted meanwhile" doesn't say what was deleted | fixed | phase 5 fix round (W10) |
| E152 | phase 5 QA | Deleting test users leaves their profiles behind; the cleanup recipe in the briefs was incomplete | fixed | briefs now delete profiles first |
| E153 | phase 7 QA | Pasting a picture right after another replaces the first; only one of several pasted files is kept; a slow upload replaces a later selection | fixed | phase 7 (merged in cca59f9) |
| E154 | phase 7 review | A shown picture whose re-sign fails is asked for again every 30 ms (empty store updates wake every listener) | fixed | phase 7 (merged in cca59f9) |
| E155 | phase 7 QA + review | Pictures in comments never retry, and a page left open hands out expired addresses | fixed | phase 7 (merged in cca59f9) |
| E156 | phase 7 QA + review | History opened while offline never recovers once back online | fixed | phase 7 (merged in cca59f9) |
| E157 | phase 7 QA | A guest linked to a member reads as "someone" in history until a reload | fixed | phase 7 (merged in cca59f9) |
| E158 | phase 7 QA | Any change made with nobody signed in reads as "Archived automatically" | fixed | phase 7 (merged in cca59f9) |
| E159 | phase 7 review | The history signature claims reordering doesn't reload history, but `updatedAt` makes it | fixed | phase 7 (merged in cca59f9) |
| E160 | phase 7 QA | Clicking into a description and out saves a tidied version and writes a history line | fixed | phase 7 (merged in cca59f9) |
| E161 | phase 7 QA | After removal, signed picture addresses stay in memory for up to a day | fixed | phase 7 (merged in cca59f9) |
| E162 | phase 7 review | Every history line subscribes to the whole people/projects/labels/issues maps | won't do | one issue page at a time; the maps change rarely |
| E163 | phase 6 review | Database and network error text can reach the import screen | fixed | phase 6 (merged in 38797db) |
| E164 | phase 6 review | `carry` for Try again has two sources of truth and is lost on reload; a simpler rule exists | fixed | phase 6 (merged in 38797db) |
| E165 | phase 6 review | `buildImport` is ~360 lines; the kept-order rule is written twice | fixed | phase 6 (merged in 38797db) |
| E166 | phase 6 review | `paged` runs an exact count query on every page | won't do | the count saves a last empty request and is cheap at this size; noted for a bigger team |
| E167 | phase 5 fix round | `bunx supabase db query` sometimes fails to log in to the pooler under load (parallel runs); retrying works | won't do | a CLI hiccup, not app code; scripts retry |
| E168 | phase 5 fix round | Cleanup must delete workspaces before profiles (the last-owner rule refuses the other order) | fixed | briefs updated |
| E169 | phase 8 QA | Two owners stepping down or leaving at the same moment can leave a workspace with no owner | fixed | phase 8 (merged) |
| E170 | phase 8 QA | Long workspace names push the Join button off the screen on a phone | fixed | phase 8 (merged) |
| E171 | phase 8 review | Member dialogs read "Make undefined an owner?" while closing; a locked role's reason is only a hover title | fixed | phase 8 (merged) |
| E172 | phase 8 review | Messages and the role type are copied in two places; an import cycle between Gate and JoinFlow | fixed | phase 8 (merged) |
| E173 | phase 8 QA | Some malformed invite links show the normal welcome instead of "This invite link doesn't work" | fixed | phase 8 (merged) |
| E174 | phase 8 QA | A different person signing in after a reload inherits the previous person's last workspace | fixed | phase 8 (merged) |
| E175 | phase 8 review | `ConfirmDialog` always uses the red button, also for "Make owner" | fixed | phase 10 (ConfirmDialog `tone`) |
| E176 | phase 9 implementer | The 10 s look-back re-reads rows changed just before the mark (harmless, some egress) | won't do | small and it makes catching up safe; fine for 8 people |
| E177 | phase 6 QA | Try again after a partial import loses guests' emails, and after a reload leaves a new team with no members | fixed | phase 6 (merged in 38797db) |
| E178 | phase 6 QA | After a team swap, re-imports never settle (views re-sent every time) | fixed | phase 6 (merged in 38797db) |
| E179 | phase 6 QA + review | A dropped connection during the check step shows "Something went wrong: [object Object]" | fixed | phase 6 (merged in 38797db) |
| E180 | phase 6 QA | A teammate with the archive open sees only part of an imported archive until a reload | fixed | phase 6 (merged in 38797db) |
| E181 | phase 6 QA | The check step counts fewer comments on a second import (archived issues' comments left out) | fixed | phase 6 (merged in 38797db) |
| E182 | phase 9 review | Opening from the copy never loads the archive (archived issues stay "Loading") | fixed | phase 9 (merged in 80b8021) |
| E183 | phase 9 review | A copy that reads back but crashes blocks the workspace for good | fixed | phase 9 (merged in 80b8021) |
| E184 | phase 9 review | A tab that hasn't heard about the sign-out can write the copy back after it was deleted | fixed | phase 9 (merged in 80b8021) |
| E185 | phase 9 review | A copy that's too big is encoded again on every change | fixed | phase 9 (merged in 80b8021) |
| E186 | phase 6 fix round | `tests/actions.test.ts` "archiving takes sub-issues along" failed about 1 in 4 full runs before the merge | fixed | phase 10 (20 full runs pass; the old sync code it touched is gone) |
| E187 | phase 6 fix round | Leaving the import's done screen through Settings forgets the finished import | won't do | harmless: the import is saved; the done screen is only a summary |
| E188 | phase 9 fix round | `tests/workspace.test.ts:356` calls `.subscribe` on a store type without it (hidden because tests aren't type-checked) | fixed | phase 10 |
| E189 | phase 10 planner | Local main was far ahead of the fork's main on GitHub, so the Pages build would publish the old code | fixed | phase 11 (main pushed before publishing) |
| E190 | phase 10 planner | The repo is public, so backup artifacts must be encrypted | fixed | phase 10 (backup.yml encrypts, data only) |
| E191 | phase 10 planner | `pages.yml` builds without the repository variables (the site would say it isn't set up) | fixed | phase 11 (pages.yml reads the repository variables and stops without them) |
| E192 | phase 10 planner | No password reset without an email sender | won't do | stage B; the guide says what to do meanwhile |
| E193 | phase 10 code | 31 picture folders belong to workspaces that no longer exist | fixed | phase 11 (the wipe plus removing every leftover picture folder) |

## Waiting on the user

| What | Status |
| --- | --- |
| GitHub OAuth app for sign-in (homepage `https://michalsek.github.io/sprawniej/`, callback `https://wkqofiacqfuxowavuqxj.supabase.co/auth/v1/callback`); id and secret stay in the user's shell | when you like: one command above |
| `bunx supabase login` once, so the CLI can push the schema and auth settings | done 2026-10-19 |
| Realtime "Allow public access" off (dashboard, Realtime, Settings) | done 2026-10-19 |
| Run the Linear import with your own Linear key (phase 6) | ready: Settings › Import from Linear |
| First sign-in on the published site | yours |
| Database password for `db push`, approve the final wipe (phase 11) | not needed (the CLI login is enough); wipe approved and done 2026-10-19 |
| Switch on GitHub Pages for the fork, repository variables for the build (phase 11) | done 2026-10-19 |
