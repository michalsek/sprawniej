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
- 2026-10-19: Accepted advisor warnings: "signed-in users can execute SECURITY DEFINER function" for the 11 public functions (they are the API, each checks the caller, `anon` can't run them); leaked-password protection (paid plan); "insufficient MFA options" (no MFA in stage A).
- 2026-10-19: Work happens in the session's worktree; `main` is fast-forwarded to it after each step (the session
  can't write in the main checkout directly).

## Roadmap

Status: `todo`, `doing`, `done`.

| # | Phase | Status | Notes |
| --- | --- | --- | --- |
| 0 | Plan merged into `main`, Supabase CLI as a dev dependency | done | |
| 1 | Database schema, settings, DB tests (`supabase/`, `tests/db`, generated types) | done | 95beeff + fix round; 53/53 DB tests, QA attack scripts pass |
| 2 | Linear mapping returns rows (pure code, `linearMap.ts`) | done | 70b978b, be04249 and a last fix; QA and code review passed |
| 3 | Backend groundwork: `rows.ts`, `apply.ts`, registry, store additions | done | 2b367bd + fix round; QA probes re-run |
| 4 | Signing in and opening a workspace (read path, realtime, catch-up in memory) | doing | |
| 5 | Saving: `writes.ts` and `actions.ts` on rows | todo | after 4 |
| 6 | Linear import end to end (`import_rows`) | todo | after 2 and 5; parallel with 7, 8, 9 |
| 7 | History and pictures | todo | after 5 |
| 8 | Team features: invites, members and roles, people from Linear, ways to sign in | todo | after 5 |
| 9 | Read cache and catch-up from IndexedDB | todo | after 5 |
| 10 | Remove the old code, docs, CLAUDE.md, inactive backup workflow | todo | after 6 to 9 |
| 11 | Prove the runbook on a wiped project, GitHub Pages, release 2.0.0 | todo | last |

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
| P20 | roadmap planner | Redirect URLs need `http://localhost:4173` and the Pages URL with `/**`; `publicAppUrl()` is null on localhost so sign-in needs its own redirect helper | open | redirect URLs in config.toml (95beeff); sign-in redirect helper in phase 4; Pages URL in phase 11 |
| P21 | roadmap planner | Bucket insert needs `on conflict do nothing`; storage objects can't be deleted with plain SQL (wipe through the Storage API) | fixed | 95beeff: storage.sql; `db reset --linked` replaces wipe.sql |
| P22 | roadmap planner | Per-table policies and triggers the plan shows once: generate them in one loop, with a test that every table has them (except `issue_events`, `issue_numbers`) | fixed | 95beeff: helpers.sql `private.wiring` loops; tests/db/wiring.test.ts |
| P23 | roadmap planner | Realtime checks access at join: a removed member keeps receiving until they rejoin; acceptable for 8 people, document it | fixed | 95beeff: realtime.sql comment, supabase-setup.md |
| P24 | roadmap planner | The plan text still mentions pgTAP, `seed.sql`, the local stack and `importRepo.ts`; update it for the no-Docker decision | fixed | 95beeff: docs/supabase-plan.md updated |
| E1 | roadmap planner | `tsconfig.app.json:28` only includes `src`, so `tests/` are never type-checked by `tsc -b` | open | |
| E2 | roadmap planner | `package.json`: the `cn` package is unused (`src/lib/utils.ts` defines its own `cn`) | open | |
| E3 | roadmap planner | `ImportPage.tsx:78` subscribes to the whole store (`useData((s) => s)`), redrawing the wizard on every change | open | |
| E4 | roadmap planner | `ImportPage.tsx:304-306` a failed import still shows "done" with only a console warning | open | |
| E5 | roadmap planner | `actions.ts` `createLabel` accepts a duplicate name while `updateLabel` refuses it | open | |
| E6 | roadmap planner | `Markdown.tsx:24` runs `linkReferences`/`findByRef` (a scan of all issues per reference) in a store selector on every change | open | |
| E7 | roadmap planner | `linearMap.ts:74` the accent-stripping regex uses invisible literal combining characters instead of `\u0300-\u036f` | fixed | 70b978b (amendment A4) |
| E8 | roadmap planner | `joinLink.ts:17` + `config.ts:14`: no join link at all on localhost, so stage A can't make invite links | open | |
| E9 | phase 2 planner | `linearMap.ts:141-146,326` links are rewritten against Linear refs: after renumbering (ENG-2 to ENG-4) or a changed key, a link points at the wrong issue or isn't rewritten | open |  |
| E10 | phase 2 planner | `linearMap.ts:305` re-importing only some teams drops the other teams from a project's `teams` | open |  |
| E11 | phase 2 planner | `linearMap.ts:402` re-importing only some teams clears `parent` for sub-issues whose parent is in a team not picked this time | fixed | 2nd phase 2 commit (parent falls back to issues already here) |
| E12 | phase 2 planner | `linearMap.ts:415` the import archives by `completedAt ?? updatedAt`, `tidyArchive` by the later of the two | fixed | 70b978b (amendment A2) |
| E13 | phase 2 planner | `linearMap.ts:250` a team taking a different Linear team overwrites `linearId`, so the earlier one is no longer pre-picked | open |  |
| E14 | phase 2 planner | `linearMap.ts:275-279` a label matched by name never records its `linearId`, so a rename in Linear makes a second label | fixed | 70b978b (amendment A3) |
| E15 | phase 2 planner | `linearMap.ts:226` a guest's name and picture are never refreshed on re-import | open |  |
| E16 | phase 2 planner | `linearFilters.ts:15` circular import with `linearMap.ts` (works only because `mapStatus` is used at call time) | open |  |
| E17 | phase 2 planner | `linearApi.ts:205` (`labels(first: 50)`) and `:173` (`teams(first: 20)`) silently cut off longer lists | open |  |
| E18 | phase 2 planner | `src/lib/plain.ts:8` same invisible combining-character regex as E7 | fixed | 70b978b (amendment A4) |
| E19 | phase 2 planner | `tests/fixtures/linear.ts:1` mentions a browser test's pretend Linear that doesn't exist | open |  |
| E20 | phase 2 planner | `tests/linearImport.test.ts:123,274,283,295,302` invalid `now` values silently switch the archive rule off | fixed | 70b978b (amendment A5) |
| E21 | phase 1 planner | `vite.config.ts:20` the app's install description still says the workspace is kept in a GitHub repo | open | phase 10 |
| E22 | phase 1 planner | `src/data/select.ts:192` `isUnread` compares ISO strings, so database times must come in `toISOString` form (P19) | fixed | 2b367bd: `iso()` on every model time |
| E23 | phase 1 planner | `actions.ts` `createIssue`: an issue created as Done gets `completedAt: null`; the new trigger sets it (small behaviour change) | open | phase 5 |
| E24 | phase 1 planner | `actions.ts` `toldRecently` moves to the database (`check_note` trigger); delete it | open | phase 5 |
| E25 | phase 1 planner | `.github/workflows/pages.yml` runs `bun test`; safe only while `tests/db` stays gated on `SPRAWNIEJ_DB_TESTS` | open | document in supabase-setup.md |
| E26 | phase 1 planner | Labels added right after an issue is created will write history rows (today none); history folding or one-call create should hide them | open | phase 7 |
| E27 | phase 1 planner | Someone with a fresh profile who later links GitHub should have their old imported profile merged into theirs (needs a cross-workspace move) | open | phase 8 |
| E28 | phase 2 implementer | `linearMap.ts` `orderKeys`: when two Linear teams join one team here, their issues can get the same `sortOrder` | fixed | phase 2 fix round (F4) |
| E29 | phase 2 implementer | `linearMap.ts` comment loop: `archivedHere` doesn't check the team, so a comment on an archived issue of a team not chosen could be added (low risk) | open |  |
| E30 | phase 2 implementer | `ImportPage.tsx` saving/done stages, `doneText`, `saveState` and some imports are unreachable while Import is off | open | phase 6 |
| E31 | phase 2 implementer | `ImportPage.tsx` `existingFrom` turns `lastNumber` into 1..lastNumber, keeping the old rule until real used numbers come in | open | phase 6 |
| E32 | phase 2 code review | Row types accept misspelled keys because `.passthrough()` types have an index signature | fixed | phase 2 fix round (F3) |
| E33 | phase 2 code review | `isNew` and guest `email` travel inside rows though they aren't columns; an existing team re-sends its whole row | fixed | phase 2 fix round (F1) |
| E34 | phase 2 code review | The archive rule is copied between `linearMap.ts` and `actions.ts` `tidyArchive` | fixed | phase 2 fix round (F5) |
| E35 | phase 2 code review | Numbering logic (`existingFrom`) lives untested in `ImportPage.tsx`; used numbers marked twice | fixed | phase 2 fix round (F6) |
| E36 | phase 2 code review | `docs/linear-import.md` still describes files, parts of 300 files and archive files | fixed | phase 2 fix round (F11) |
| E37 | phase 2 code review | `ImportPage.tsx` builds the plan (with fresh ids) inside `useMemo` during render | fixed | phase 2 fix round (F9) |
| E38 | phase 2 code review | `importFiles` (`actions.ts`) and `relinkArchived` (`relink.ts`) have no callers | fixed | phase 2 fix round (F10) |
| E39 | phase 2 code review | `src/model/schema.ts` uses `.passthrough()`, deprecated in Zod 4 (`.loose()`) | open | phase 10 |
| E40 | phase 2 code review | `src/data/relink.ts:97` compares with key-order-sensitive `JSON.stringify` while `linearMap` has its own `same` | open | phase 10 (relink.ts mostly goes) |
| E41 | phase 2 QA | A new Linear issue sorting first makes every issue of its team come back as changed (sort keys rebuilt per run) | fixed | phase 2 fix round (F4) |
| E42 | phase 2 QA | Guest rows carry `githubId: 0` but `profiles.github_id` is unique; the client mapping must send null | fixed | 2b367bd: `rows.ts` maps githubId 0 to null |
| E43 | phase 2 QA | A team row can take a Linear id another team still holds (unique per workspace) | fixed | phase 2 fix round (F1) |
| E44 | phase 2 QA | `docs/supabase-plan.md` says `import_rows` upserts on `(workspace_id, linear_id)`; it must be the primary key | fixed | 95beeff (plan says primary key) |
| E45 | phase 2 QA | Change detection on re-import needs `rows.ts` to return the same text the import writes (times as `.000Z`) | fixed | 2b367bd: round trip tested with the real import |
| E46 | phase 2 QA | `setMonth` rolls past month end (Aug 31 minus 6 months is Mar 3), in both the import and `tidyArchive` | fixed | phase 2 fix round (F5, UTC with day clamp) |
| E47 | phase 2 QA | The renumbered note shows the key here, not Linear's identifier | fixed | phase 2 fix round (F7) |
| E48 | phase 2 QA | Import page copy says "Ready to import" and "run the import again later" while saving is off | fixed | phase 2 fix round (F9) |
| E49 | phase 2 implementer | `docs/user-guide.md:258` says the import can be run again later while Import is off | open | phase 6 (Import comes back) / phase 10 docs |
| E50 | phase 2 implementer | `tests/linearImport.test.ts` `native()` makes sort orders like `a50`, not valid fractional keys; a future test adding issues would throw | fixed | phase 2 QA re-check (`native()` makes valid keys) |
| E51 | phase 2 implementer | `monthsBefore` now uses UTC; the nightly cut-off moves by a few hours at most | won't do | a few hours either way is harmless, and UTC matches the database job |
| E52 | phase 2 QA re-check | Two teams here swapping their Linear teams emitted two non-null links, colliding on the unique Linear id | fixed | phase 2 last fix (release first) |
| E53 | phase 2 QA re-check | An invalid sort key in a team made the import wizard's Continue button silently do nothing | fixed | phase 2 last fix (error shown on the people step) |
| E54 | phase 1 implementer | Inbox notes must be inserted without asking for the rows back (`.select()` fails: the sender can't read others' notes) | open | phase 5 |
| E55 | phase 1 implementer | The realtime sign-in token must be set before joining a private channel, or the join is refused | open | phase 4 |
| E56 | phase 1 implementer | `db reset --linked` also deletes sign-in accounts: fine in development, a hazard anywhere else | open | phase 11 runbook |
| E57 | phase 1 implementer | Deletion notes of a deleted workspace stay until the 45-day job | won't do | harmless, nobody can read them, the job removes them |
| E58 | phase 3 planner | `project.ts:127` sorts comments by `createdAt` with no tiebreak | open | phase 3 reducer tiebreaks by id; project.ts goes in phase 10 |
| E59 | phase 3 planner | `select.ts` `isUnread` does `read.includes` per note (quadratic for unread counts) | open |  |
| E60 | phase 3 planner | `schema.ts:14` `iso = z.string()` checks nothing, so a `+00:00` time passes silently | open |  |
| E61 | phase 3 planner | `actions.ts` `markAllRead` takes the newest `at` by string compare; right only while all times are in Z form | fixed | 2b367bd: all times in Z form |
| E62 | phase 3 planner | `docs/supabase-plan.md` `broadcast()` text differs from the shipped one (keys in updates, `last_number` skipped, profiles loop) | open | phase 10 docs |
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
| E83 | phase 1 review | The team key pattern is copied three times and the login pattern four times in the app | open | phase 10 |
| E84 | phase 1 review | `src/data/store.ts:61` issue references match `[A-Z][A-Z0-9]*`, looser than team keys | open |  |
| E85 | phase 4 planner | Sign-out leaves other `sprawniej:` keys and comment drafts on a shared computer | open | phase 4 |
| E86 | phase 4 planner | `session.toured` is never read (the tour uses its own key) | open | phase 4 |
| E87 | phase 4 planner | `Crash.tsx:37` and docs/design.md promise changes are kept on this device | open | phase 5 / 10 |
| E88 | phase 4 planner | `Step.tsx:33` `Problem` uses a raw red instead of a theme colour | open |  |
| E89 | phase 4 planner | `Tour.tsx:28-33` queries the page on every animation frame while a tip is open | open |  |
| E90 | phase 4 planner | `updates.ts:50-52` adds an interval and listeners on every registration and never removes them | open |  |
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
| E101 | phase 3 review | `select.ts:65` `PRIORITY_RANK.get(...)!` gives NaN for an unknown priority | open |  |

## Waiting on the user

| What | Status |
| --- | --- |
| GitHub OAuth app for sign-in (homepage `https://michalsek.github.io/sprawniej/`, callback `https://wkqofiacqfuxowavuqxj.supabase.co/auth/v1/callback`); id and secret stay in the user's shell | asked 2026-10-19 |
| `bunx supabase login` once, so the CLI can push the schema and auth settings | done 2026-10-19 |
| Realtime "Allow public access" off (dashboard, Realtime, Settings) | done 2026-10-19 |
| Run the Linear import with your own Linear key (phase 6) | later |
| Database password for `db push`, approve the final wipe (phase 11) | later |
| Switch on GitHub Pages for the fork, repository variables for the build (phase 11) | later |
