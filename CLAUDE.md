# Sprawniej: working rules

Sprawniej is our internal tool for planning and tracking work: issues, teams, projects and views with emojis, in a
list or on a board. It is a static web app on GitHub Pages. **Workspaces live in a Supabase project**: a Postgres
database with row-level security, sign-in, realtime updates and storage for pictures. There is no server of our own
besides that project. People sign in with an email and a password, or with GitHub.

Read before changing things:
- [docs/architecture.md](docs/architecture.md): how the pieces fit, how opening, live changes and saving work, two
  people at once
- [docs/data-format.md](docs/data-format.md): the database: every table, function, rule and nightly job
- [docs/supabase-setup.md](docs/supabase-setup.md): setting up a project, publishing, database tests, backups
- [docs/supabase-work.md](docs/supabase-work.md): the decisions and findings of the move to Supabase
- [docs/design.md](docs/design.md): how screens should look
- [docs/linear-import.md](docs/linear-import.md): what the Linear import brings over
- [docs/user-guide.md](docs/user-guide.md): the guide for teammates (also the in-app Help page)

## Golden rules
- **No Save buttons, ever.** Every change saves by itself. If something seems to need one, it needs auto-save instead.
- **Every change goes through `src/data/actions.ts`, and every call to Supabase lives in `src/backend/`.** Components
  never send changes, call the database client or set the data store themselves; nothing outside `src/backend` (and
  the database tests in `tests/db`) imports `@supabase/supabase-js`. One path keeps "always saved" true, and one
  folder keeps the backend replaceable. The one exception is `src/github`, the Edge Function: it isn't the app, and it
  reaches the database only through `github_lookup` and `github_apply`, with plain `fetch`.
- **One row per thing.** Things several people change at once (labels on an issue, team members, followers, a
  project's teams) are rows in a join table, never a list in a column. A save sends only the columns that changed
  (`src/backend/writes.ts`). That is what keeps two people's changes from undoing each other.
- **The database owns what it fills in.** Issue numbers, authors, `changed_at`, the created, updated and completed
  times and the history are set by triggers. The app may guess them so they show at once, but never sends them; the
  column grants refuse it. Inbox notes are worked out by the app (`src/data/notify.ts`) and checked by the database.
  Imports go through `import_rows` only.
- **The database schema is a promise.** It changes only through a new file in `supabase/migrations/`, named with a
  later timestamp; never edit a file that was applied anywhere. Apply it with the CLI (`bunx supabase db push`), never
  in the dashboard, the SQL editor or the MCP server's `apply_migration`. With every migration: regenerate
  `src/backend/database.types.ts`, set `SCHEMA_ID` in `src/backend/cache.ts`, run `bun run test:db`, check the
  advisors, update docs/data-format.md (its first section lists every step). A change that older app versions can't
  live with is a MAJOR release, and the migration goes in before the app that needs it is published. The app's types
  come from zod schemas (`src/model/schema.ts`); nothing parses rows at runtime. Unknown fields survive a read and
  write in each row's `extra` (`src/backend/rows.ts`, `KNOWN`).
- **Statuses and priorities are fixed** (`src/model/status.ts`). Don't add custom workflows. The SQL checks copy its
  lists, and `tests/statusLists.test.ts` compares them.
- **Sign in through Supabase Auth only.** No server of our own besides the Supabase project: database rules, a few SQL
  functions, nightly jobs, and later Edge Functions for webhooks. No proxy, no second backend.
- **No agents or AI features.**

## Code map
`src/app` frame and routes · `src/model` types, statuses, fixed rules (team keys, handles) · `src/data` store,
selectors, actions, inbox rules · `src/backend` every call to Supabase (sign-in, opening, the read cache, live changes,
saving, pictures, history, saving imports) · `src/features/<area>` screens · `src/components` small shared pieces ·
`src/editor` the description and comment editor · `src/ui` shadcn components (generated with
`bunx --bun shadcn@latest add <name>`; fix the `cn` import to `@/lib/utils` after adding) · `src/lib` small helpers
(search without Polish letters, `cn`, hooks) · `src/config.ts` the public address and where sign-in comes back ·
`src/version.ts` version and What's new · `src/session.ts` which workspace is open · `scripts/changelog.ts` writes CHANGELOG.md ·
`src/github` the GitHub webhook (the Edge Function `github-webhook`, never in the browser; docs/github-app.md) ·
`supabase/` config, migrations, functions, test cleanup · `tests/` logic tests, `tests/db` database tests.

## Releasing
`main` is what GitHub Pages serves, but publishing is **by hand**: push `main`, then run the *Deploy to GitHub Pages*
workflow (Actions tab, or `gh workflow run pages.yml -R michalsek/sprawniej`). Nothing is published on a push. The
build reads the repository variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` and `VITE_PUBLIC_URL`, and stops if the
first two are missing. Once the team uses it, treat `main` as what people get.
- Work on a branch (`git switch -c feat/<name>`); push to `main` only a complete, tested feature.
- Before merging: `bunx tsc -b`, `bun test`, `bun run lint`, `bun run build`, and drive the real flow in a browser.
  With a migration, also `bun run test:db` and the advisors.
- Migrations reach the team's project before the app that needs them is published.
- Every merge into `main` is a release. Pick the version bump in `src/version.ts` **before** merging, add an entry at
  the top of `CHANGELOG` there (date = the day it ships), mirror the version in `package.json`, and run
  `bun scripts/changelog.ts`. Notes are for the people using Sprawniej ("Drag issues between columns"), not commit titles.
  - PATCH: fixes, wording, speed. Nothing new to learn.
  - MINOR: a new feature, or a visible change to how something works.
  - MAJOR: the database changes in a way older versions of the app can't live with, or people's habits break.
- Source-only work (docs, tests, invisible refactors) doesn't bump anything.

## Commits
Title line only, plain words. No AI attribution trailers.

## Testing
- No Docker and no local Supabase: development and tests use a hosted project (docs/supabase-setup.md).
- `bun test` for logic (`tests/`): selectors, applying rows, saving, ordering, import mapping. Keep logic in plain
  functions so it can be tested. It never talks to a database: the writer and the actions run against a pretend
  backend (`tests/support/fakeBackend.ts`, `fakeDb.ts`).
- `bun run test:db` runs `tests/db` against the project in `.env.local` as throwaway accounts
  (`dbtest-<run>-<name>@…`) with their own workspaces (`dbtest <run> …`). Only on a development or throwaway project,
  never one where a team works. Clean up afterwards: the SQL, then the test pictures (docs/supabase-setup.md).
- Browser checks: **never drive the user's own Chrome.** Use a private headless browser: `bun add playwright-core`
  in a scratch folder, `chromium.launchPersistentContext('<scratch>/profile', { channel: 'chrome', headless: true,
  serviceWorkers: 'block' })` against `bunx vite preview --port 5299` of a fresh `bun run build`. Blocking the
  service worker stops the PWA cache from serving an older build. Sign up throwaway accounts named like the database
  tests' so the same cleanup removes them; never sign in as a real person.
- Two people: two browser profiles signed in as two test accounts. Also one person in two tabs, and a dropped
  connection (`context.setOffline(true)`, then back).
- `window.sprawniej` has `data` (the store), `actions` (everything a person can do), `backend` (`status`, the save
  chip's store: `status.getState()`; `pending()`; `flush()`; `catchUp()`, to fetch what changed at once instead of
  waiting; `debug`, `writes`, `history`, `pictures`, `saveCache` for checks) and `theme` (light or dark:
  `theme.getState()` gives `choice` and `resolved`), so a script can drive and check the app without clicking through
  every screen.
- Never write a Supabase secret key, a database password, a GitHub OAuth secret or a Linear key into a file. Pass it as
  an environment variable for one command. The project URL and the publishable key are public: they may be in
  `.env.local` and in the build.

## Design
Follow [docs/design.md](docs/design.md). Use a shadcn component before writing a new one. Bright colours are only for
meaning (statuses, priorities, labels); everything else is neutral grey.

## Writing
- Simple, friendly words everywhere: UI, docs, changelog. Many teammates are not technical.
- **Don't compare Sprawniej to other products** ("like in Linear") in the app, the user guide or the README. It is
  its own tool and should explain itself. The one exception is the Linear import, which has to name what it imports from.
- **No em dashes** anywhere. Use a comma, colon, parentheses or a new sentence.
- Screens that teammates see never say commit, push, pull, merge, repo, token, database, server, row, Supabase or
  sync. The GitHub parts (Settings › GitHub, the pull request link in history, the guide's GitHub section) may say
  "pull request", "merged" and "repository". Say "saved", "Saving…", "We can't reach Sprawniej right now. We'll keep trying", "your teammates' changes show
  up".
- Every new feature updates `docs/user-guide.md` (it is also the in-app Help page) and gives its empty list a helpful
  empty state (what goes here + one button).
