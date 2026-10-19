# Setting up a Supabase project for Sprawniej

Everything Sprawniej needs from Supabase is in this repo: `supabase/migrations` (tables, rules, functions, the
pictures bucket, realtime, nightly jobs) and `supabase/config.toml` (sign-in settings). These steps set up any project,
in any account. No Docker is needed. Commands run from the repo folder.

## A new project

1. **Create a project** in the Supabase dashboard (any organization, any region). Write down its ref, the part before
   `.supabase.co` in its address.
2. **Connect the CLI** to it:
   ```sh
   bunx supabase login
   bunx supabase link --project-ref <ref>
   ```
3. **Make the database**: `bunx supabase db push`. It asks for the database password you picked in step 1.
4. **Sign-in settings**:
   ```sh
   cp supabase/.env.example supabase/.env
   bunx supabase config push --project-ref <ref>
   ```
   Read the changes it shows before you say yes: it pushes every section of `config.toml`.
   Once GitHub sign-in is switched on, make a GitHub OAuth app for this project (its callback is
   `https://<ref>.supabase.co/auth/v1/callback`; GitHub allows one callback per app, so each project needs its own) and
   give its id and secret for that one command only, never in a file:
   ```sh
   SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID=... SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET=... bunx supabase config push --project-ref <ref>
   ```
5. **Tell the app where it is**: write `.env.local` (it is not saved in git) with the project's address and its
   publishable key (Dashboard, Project Settings, API keys). The publishable key is public; it only works within the
   database rules.
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_KEY=sb_publishable_...
   ```
6. **Check it**: `bun run test:db` (below).

## Database tests

`bun run test:db` runs `tests/db` against the project in `.env.local`. They sign up throwaway accounts
(`dbtest-<run>-<name>@mailinator.com`), make their own workspaces (`dbtest <run> ...`) and check the rules, numbers,
history, deletions, realtime and pictures through the same API the app uses.

- They need **email confirmations off** (`enable_confirmations = false` in `config.toml`, pushed with step 4, or
  Dashboard, Authentication, Email, "Confirm email"). With confirmations on, a sign-up gets no session and the tests
  stop with a message saying so.
- Supabase refuses example and test email domains. If it also refuses the default one, pick another real domain:
  `SPRAWNIEJ_TEST_EMAIL_DOMAIN=<domain> bun run test:db`.
- A run signs up four accounts. Sign-ups are limited per 5 minutes; `config.toml` raises the limit so a few runs in a row
  work.
- Plain `bun test` (and the GitHub Pages workflow, which runs it) skips `tests/db`: those tests only run when
  `SPRAWNIEJ_DB_TESTS` is set, which `test:db` does. Keep it that way, so building never touches a database.
- **Clean up** afterwards: `bunx supabase db query --linked -f supabase/dev/cleanup-tests.sql` (or paste the file into
  the SQL editor). It removes the test workspaces, profiles and accounts. Test pictures stay in the `pictures` bucket;
  they are tiny, delete them in Storage if you like.

Never run the database tests against a project where a team works.

## Checking the advisors

After a change to the migrations, look at Dashboard, Advisors (security and performance), or ask the Supabase MCP
server for `get_advisors`. Fix every error. The warnings we accept, with the reason, are listed in
`docs/supabase-work.md`.

## Starting a development project over

Only for a project with no real data (the development project only holds a copy of Linear tasks that can be imported
again).

```sh
bunx supabase db reset --linked
```

It removes everything in the database, sign-in accounts included, and applies every file in `supabase/migrations`
again, in order. The `pictures` bucket and its files stay (Supabase doesn't let the database delete them); empty and
delete the bucket in Storage if you want them gone. Applying the migrations again works either way.

Apply migrations only with the CLI (`db push`, `db reset`), so the list of applied migrations matches the file names.
The Supabase MCP server's `apply_migration` records the time it ran instead; if a project was changed that way, reset
it or run `bunx supabase migration repair --status applied <version>` for each file (the version is the number at the
start of the file name).

## Good to know

- **Removed members hear changes until they reconnect.** Realtime checks who may listen when a browser joins a
  channel. Someone removed from a workspace keeps getting its changes until their browser reconnects (a reload, a
  dropped connection). Everything they try to read or change is refused at once. For a team of eight, that is fine.
- **Imports** go through `import_rows(workspace, table, rows)`, admins only. The caller sends the same columns in every
  row of a batch (a column missing from one row becomes empty, not its default) and reuses the id of every row that came
  over before (rows are matched on their id; a new id with an old Linear id fails on purpose). Imports keep their
  numbers and times, write no history and send one "catch up" message per batch instead of one per row. A second run
  with the same rows changes nothing.
- **Upsert needs every column.** A write that might insert or update (an upsert) needs permission to update every
  column it sends. Only read marks (`read_state`) allow that; everything else is an insert or an update.
- **Don't ask for notes back.** You can't read the inbox notes you send (they belong to the person they're for), so
  inserting them with `.select()` fails. Insert notes without asking for the rows back.
- **Pictures** are named `<workspace id>/<hash>.<ext>`. Upload with upsert off and treat "already there" as done.
- **Times** come back from the database with microseconds. Keep them when comparing "newer than", or catching up can
  miss a change.
