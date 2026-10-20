# Setting up a Supabase project for Sprawniej

Everything Sprawniej needs from Supabase is in this repo: `supabase/migrations` (tables, rules, functions, the
pictures bucket, realtime, nightly jobs; docs/data-format.md describes them) and `supabase/config.toml` (sign-in
settings). These steps set up any project, in any account, and publish the app. Commands run from the repo folder.

## What you need

- The Supabase CLI, which comes with the repo (`bunx supabase`, a dev dependency). **No Docker** and no local
  Supabase: development, tests and the team all use hosted projects.
- A Supabase account, and the GitHub CLI (`gh`) for publishing.

## A new project

1. **Create a project** in the Supabase dashboard (any organization, any region). Write down its ref, the part before
   `.supabase.co` in its address, and the database password you pick.
2. **Connect the CLI** to it:
   ```sh
   bunx supabase login
   bunx supabase link --project-ref <ref>
   cat supabase/.temp/project-ref      # the project the CLI now works on
   ```
3. **Make the database**:
   ```sh
   bunx supabase db push
   bunx supabase migration list --linked   # every local file has the same version on the remote side
   ```
   If it asks for the database password, give the one from step 1.
4. **Sign-in settings**:
   ```sh
   cp supabase/.env.example supabase/.env
   bunx supabase config diff --project-ref <ref>
   ```
   In `supabase/.env`, `SPRAWNIEJ_SITE_URL` is where the app runs: `http://localhost:5173` for a development project,
   the published address (`https://michalsek.github.io/sprawniej/`) for the one a team uses. Sign-in sends people back
   there; `additional_redirect_urls` in `config.toml` lists the other addresses it may send them to (the local ports
   used for development and checks). For the published project, add the published address there too:
   `"https://michalsek.github.io/sprawniej/"` and `"https://michalsek.github.io/sprawniej/**"`.

   **Always read `config diff` before `config push`.** `config push` sends more than sign-in settings and asks about
   each part; say yes only to the changes you expect.

   **GitHub sign-in** is switched on in `config.toml` (`[auth.external.github] enabled = true`), with its id and
   secret read from the environment. Make a GitHub OAuth app for this project: homepage the site address, callback
   `https://<ref>.supabase.co/auth/v1/callback` (GitHub allows one callback per app, so each project needs its own).
   Then push with the app's id and secret for that one command only, never in a file:
   ```sh
   SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID=... SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET=... bunx supabase config push --project-ref <ref>
   ```
   **No OAuth app yet?** Push everything else from a copy where GitHub is off, so the project doesn't get GitHub
   switched on without an id. Never commit that copy:
   ```sh
   W=$(mktemp -d); mkdir -p "$W/supabase"; cp supabase/config.toml supabase/.env "$W/supabase/"
   # in "$W/supabase/config.toml", under [auth.external.github]: enabled = false, client_id = "", secret = ""
   bunx supabase config diff --workdir "$W" --project-ref <ref>
   bunx supabase config push --workdir "$W" --project-ref <ref>
   ```
   Afterwards `config diff` from the repo shows only the GitHub part. The app hides **Continue with GitHub** while
   GitHub is off.
5. **Realtime: private channels only.** In the dashboard, Realtime, Settings, switch off "Allow public access".
   `config.toml` can't hold this setting (it is only in the dashboard and the Management API: `private_only` on
   `PATCH /v1/projects/<ref>/config/realtime`). Sprawniej only uses private channels, so this keeps anyone from
   opening public ones on the project.
6. **Tell the app where it is**: write `.env.local` (it is not saved in git) with the project's address and its
   publishable key (Dashboard, Project Settings, API keys). The publishable key is public; it only works within the
   database rules.
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_KEY=sb_publishable_...
   ```
   Without them the app says "Sprawniej isn't set up yet".
7. **Check it**, on a development or throwaway project only: `bun run test:db`, then the cleanup (below).

## Sign-up codes

Nobody can make an account without a **sign-up code** or an invite link that still has room (docs/data-format.md, "Who
may make an account"). For email and password, Supabase Auth's *before user created* hook checks it before the account exists; it
is switched on in `config.toml` and pushed with step 4 (after `db push`, which makes the function it calls). To see
that it is on: Dashboard, Authentication, Auth Hooks, "Before User Created" pointing at
`private.before_user_created`. Someone who signs up with GitHub is asked for the code on the next screen, and gets
nowhere without it; such accounts are deleted after 7 days.

To switch on only the hook, without touching any other setting, push a `config.toml` that declares nothing else
(`config push` leaves settings the file doesn't declare as they are):

```sh
W=$(mktemp -d); mkdir -p "$W/supabase"
printf 'project_id = "sprawniej"\n\n[auth.hook.before_user_created]\nenabled = true\nuri = "pg-functions://postgres/private/before_user_created"\n' > "$W/supabase/config.toml"
bunx supabase config diff --workdir "$W" --project-ref <ref>    # only auth.hook.before_user_created changes
bunx supabase config push --workdir "$W" --project-ref <ref>
```

**Your own first account:** make a code (below), open Sprawniej, choose **Create an account** and type it in.

Everything else happens in the Dashboard, SQL editor:

```sql
-- make a code: who it's for, days it works, how many accounts it may make
select private.make_signup_code('Ania and Bartek', 7, 2);

-- every code, newest first, and who used it
select c.code, c.note, c.uses || ' of ' || c.max_uses as used, c.expires_at, c.switched_off_at,
       coalesce(string_agg(s.email || ' (' || to_char(s.at, 'YYYY-MM-DD HH24:MI') || ')', ', ' order by s.at), '') as used_by
  from private.signup_codes c left join private.signups s on s.code_id = c.id
 group by c.id order by c.created_at desc;

-- switch a code off at once (accounts already made with it stay)
select private.switch_off_signup_code('K7QX-M2PA-9RTD');
```

Codes are 12 letters and digits; case, spaces and dashes don't matter when people type them. An account made by hand
in the dashboard (Authentication, Users, Add user) has no code, so the hook may refuse it: make a code and sign up in
the app instead. To give a code a few more days or uses: `update private.signup_codes set expires_at = now() + interval '7 days',
max_uses = 5 where code = 'K7QXM2PA9RTD';` (without dashes). To remove an account someone made, use Authentication,
Users in the dashboard.

## Publishing

The app is published to GitHub Pages by hand; nothing is published on a push.

1. In the GitHub repository: Settings, Pages, Source: **GitHub Actions**.
2. Settings, Secrets and variables, Actions, **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (the publishable
   key) and `VITE_PUBLIC_URL` (the published address, which invite links use). They are public values; never put a
   secret key there.
3. Push `main`, then run the workflow and watch it:
   ```sh
   git push origin main
   gh workflow run pages.yml -R <owner>/<repo> --ref main
   gh run list -R <owner>/<repo> -w pages.yml -L 1      # its headSha must be main's
   gh run watch <run id> -R <owner>/<repo> --exit-status
   ```
4. The published address goes into `SPRAWNIEJ_SITE_URL` and `additional_redirect_urls` (step 4 above), pushed with
   `config push`, or sign-in can't send people back to it.

Migrations reach the project before the app that needs them is published.

## GitHub: pull requests move issues

Optional. docs/github-app.md has the design; these are the steps for a project.

1. **Make a GitHub App** on the account or organisation that owns the repositories (GitHub, Settings, Developer
   settings, GitHub Apps, New GitHub App):
   - Homepage URL: the site address. Callback URL and Setup URL empty; "Request user authorization" off.
   - Webhook: active, URL `https://<ref>.supabase.co/functions/v1/github-webhook`, and a secret you make with
     `openssl rand -hex 32`. Keep it in your shell only.
   - Repository permissions: **Pull requests: Read-only** (Metadata: Read-only comes with it). Nothing else.
   - Subscribe to events: **Pull request** (any others are answered at once and ignored). Where can it be installed:
     **Only on this account**.
2. **Give the function the same secret**, never in a file (`read -s` keeps it out of the screen and the history):
   ```sh
   read -rs GITHUB_WEBHOOK_SECRET          # paste the secret (it doesn't show), then Enter
   bunx supabase secrets set "GITHUB_WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET" --project-ref <ref>
   unset GITHUB_WEBHOOK_SECRET
   bunx supabase secrets list --project-ref <ref>   # its digest must not be e3b0c442…, the digest of nothing
   ```
   (On one line, `GITHUB_WEBHOOK_SECRET=... bunx supabase secrets set "GITHUB_WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET"`
   sets it to nothing: the shell fills in the variable before the prefix applies.)
   The function also reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase gives every function.
3. **Deploy the function** (bundles `src/github` and deploys it without Docker; `config.toml` turns off the sign-in
   check for it, since GitHub signs its deliveries instead):
   ```sh
   bun run deploy:github
   ```
4. **Install the App** on the repositories (the App's page, Install App), then connect each one in the app:
   Settings › GitHub › Connect a repository. For the link on that screen, add the repository variable
   `VITE_GITHUB_APP_URL` (`https://github.com/apps/<name>`) before publishing.
5. **Check it**: the App's page, Advanced, Recent Deliveries shows each delivery and the function's answer
   (`{"moved": ["ENG-12"]}`); Redeliver sends one again. Settings › GitHub shows what the latest pull request did. The
   function's logs are in the dashboard (Edge Functions, github-webhook, Logs).

Pull requests only move issues for their author's own workspaces, and only when the author added GitHub as a way to
sign in, so GitHub sign-in (step 4 of "A new project") needs to be on.

## Notion: pages become issues

Optional. docs/notion.md has the design; these are the steps for a project. Notion needs no app of ours and the
function needs no secret: each workspace's address carries its own key, and the database keeps only its sha256.

1. **The migration** (`20261020160000_notion.sql`) goes in with `bunx supabase db push`, before the app that needs it.
2. **Deploy the function** (bundles `src/notion` and deploys it without Docker; `config.toml` turns off the sign-in
   check for it, since Notion sends no sign-in):
   ```sh
   bun run deploy:notion
   ```
   It reads only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase gives every function.
3. **Connect a workspace** in the app: Settings › Notion › Connect Notion, then paste the address into a Notion
   database button or automation ("Send webhook").
4. **Check it**: Settings › Notion shows what the latest page did. The function's logs are in the dashboard (Edge
   Functions, notion-webhook, Logs): one line per page, with the issue it became and whether it was new. They never
   show the address, emails or titles.

**Testing without Notion.** Notion's "Send webhook" needs a paid plan, but its request is easy to copy:
`tests/fixtures/notion-page.json` is shaped exactly like one. On a development project, with the migration pushed and
the function deployed, sign up a throwaway admin named like the database tests' (`dbtest-<run>-notion@…`), make a
workspace `dbtest <run> notion` with teams ENG and DES, connect Notion and copy the address. Then, keeping the
address in your shell only:

```sh
read -rs ADDR                                       # paste the address, then Enter
curl -s -X POST "$ADDR" -H 'Content-Type: application/json' --data @tests/fixtures/notion-page.json
# the same page again: {"issue": "ENG-1", "new": false}
curl -s -X POST "$ADDR" -H 'Content-Type: application/json' --data @tests/fixtures/notion-page.json
# a new page, in the trash, another team, the test accounts' emails
jq --arg id "$(uuidgen | tr A-Z a-z)" '.data.id = $id' tests/fixtures/notion-page.json | curl -s -X POST "$ADDR" -H 'Content-Type: application/json' --data @-
jq '.data.in_trash = true' tests/fixtures/notion-page.json | curl -s -X POST "$ADDR" -H 'Content-Type: application/json' --data @-
# the key in a header instead of the address
curl -s -X POST "${ADDR%%&k=*}" -H "X-Sprawniej-Secret: ${ADDR##*&k=}" -H 'Content-Type: application/json' --data @tests/fixtures/notion-page.json
unset ADDR
```

Expect 200 with the issue, 401 for a wrong or replaced key, 404 after Disconnect, 405 for anything but POST, 409 when
the team is gone, 413 over 1 MB, 400 for something that isn't a page, 429 after 100 new pages in 10 minutes. Clean up
with the usual SQL (below): deleting the workspaces takes their connections, issues and page rows with them.

**For a developer with a paid Notion plan**, once it works with curl:

1. Settings › Notion › Connect Notion, pick a team, copy the address.
2. Optionally point a test button at webhook.site first and send us the captured request with the emails taken out,
   to compare with `tests/fixtures/notion-page.json`.
3. In the Notion database, add the properties you want: Status, Priority, Assignee, Due, Description, Labels, Team, and
   **Created by**.
4. Add a database button "Send to Sprawniej" with the action Send webhook and the address as its URL. Or an automation
   (for example "Status is set to Ready") with the properties ticked.
5. Press it on a test page and check the issue, its first activity line and the link back.
6. Press it again: still one issue.
7. Replace the address in Settings and press again: Notion shows "!". Paste the new one and resume.
8. Try a page made by someone who isn't a member: "Created from Notion".

## Database tests

For a development or throwaway project only. Once a team works in a project, the tests need a separate development
project. `bun run test:db` runs `tests/db` against the project in `.env.local`. The tests sign up throwaway accounts
(`dbtest-<run>-<name>@mailinator.com`), make their own workspaces (`dbtest <run> ...`) and check the rules, numbers,
history, deletions, invites, imports, realtime, pictures, GitHub and Notion through the same API the app uses.

- They need the **Supabase CLI linked to the same project** (`bunx supabase link`): sign-ups need a sign-up code, and
  a run makes its own (noted `dbtest <run> …`) with `bunx supabase db query --linked`.
- They need **email confirmations off** (`enable_confirmations = false` in `config.toml`, pushed with step 4, or
  Dashboard, Authentication, Email, "Confirm email"). With confirmations on, a sign-up gets no session and the tests
  stop with a message saying so.
- Supabase refuses example and test email domains. If it also refuses the default one, pick another real domain:
  `SPRAWNIEJ_TEST_EMAIL_DOMAIN=<domain> bun run test:db`.
- A run signs up a few accounts. Sign-ups are limited per 5 minutes; `config.toml` raises the limit so a few runs in a
  row work.
- `SPRAWNIEJ_TEST_RUN=<name>` names the run (it is in every account, handle and workspace name it makes).
- Run one at a time: the cleanup removes every test run's leftovers, also a run still going.
- Plain `bun test` (and the GitHub Pages workflow, which runs it) skips `tests/db`: those tests only run when
  `SPRAWNIEJ_DB_TESTS` is set, which `test:db` does. Keep it that way, so building never touches a database.

**Clean up** afterwards, first the database, then the test pictures:

```sh
bunx supabase db query --linked -f supabase/dev/cleanup-tests.sql
# the picture folders of workspaces that are gone
bunx supabase db query --linked "select distinct (storage.foldername(name))[1] as dir from storage.objects where bucket_id = 'pictures' and (storage.foldername(name))[1] not in (select id::text from public.workspaces)"
bunx supabase storage rm -r ss:///pictures/<dir> --linked --experimental   # for each dir listed; never the bucket root
```

The SQL removes the test workspaces (with everything in them), the test profiles and accounts, their sign-up codes and
the record of what they made, and deletion notes of workspaces that are gone. Pictures need the Storage API; the database can't delete them.

## Checking the advisors

After a change to the migrations, look at Dashboard, Advisors (security and performance), or ask the Supabase MCP
server for `get_advisors`. Fix every error. The warnings we accept, with the reason, are listed in
`docs/supabase-work.md`. On an empty project, "unused index" notices are expected.

## Starting a project over

**This deletes everything in the database, sign-in accounts included.** Only for a development project with no real
data, never for a project a team works in. Check which project the CLI is linked to first:

```sh
cat supabase/.temp/project-ref
bunx supabase db reset --linked --yes
```

It applies every file in `supabase/migrations` again, in order (there is no seed). Afterwards:

- `bunx supabase migration list --linked`: every version matches;
- the types: `bunx supabase gen types typescript --linked --schema public` gives the same as
  `src/backend/database.types.ts` below its header;
- the advisors, and `bun run test:db` with its cleanup;
- the pictures: the bucket and its files stay (the database can't delete them), and every folder now belongs to a
  workspace that is gone. Remove them with the recipe above.

Apply migrations only with the CLI (`db push`, `db reset`), so the list of applied migrations matches the file names.
The Supabase MCP server's `apply_migration` records the time it ran instead; if a project was changed that way, reset
it or run `bunx supabase migration repair --status applied <version>` for each file (the version is the number at the
start of the file name).

## Backups

`.github/workflows/backup.yml` ("Back up the database") makes a **data-only** dump (`pg_dump --data-only`) of the
`public`, `private`, `auth` and `storage` schemas, leaving out `auth.schema_migrations` and `storage.migrations`
(they belong to Supabase's own setup, which a new project already has). The tables, functions and rules come from
`supabase/migrations`, not from the dump. It encrypts the dump with a passphrase (anyone signed in to GitHub can
download the artifacts of a public repository) and keeps it as an Actions artifact for 30 days. It also makes one
request to the project's API, so a scheduled run counts as activity (free projects pause after a week without any).
**It is not switched on.**

To switch it on:

1. Repository secrets (Settings, Secrets and variables, Actions, Secrets):
   - `SUPABASE_DB_URL`: the session pooler connection string with the database password (Project Settings, Database,
     Connect, Session pooler), `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`;
   - `BACKUP_PASSPHRASE`: a long random passphrase. Keep it in a password manager: without it a dump can't be read.
2. Run it once by hand (`gh workflow run backup.yml -R <owner>/<repo>`, or Actions, Back up the database, Run
   workflow) and check that the artifact is there.
3. To run it every night (03:17 UTC, after the nightly jobs), remove the `#` in front of the two `schedule` lines.
   GitHub turns off scheduled workflows in a public repository after 60 days without activity in it (a commit, say),
   so look at the Actions tab now and then, and switch it back on there when it says so.

Pictures are not in the dump: they stay in the `pictures` bucket and are not backed up yet.

**Restoring has not been tried yet.** Try it once on a throwaway project before relying on it, and write the exact
commands down here. The outline:

1. Download the artifact (`gh run download <run id> -R <owner>/<repo>`) and decrypt it:
   `gpg --decrypt sprawniej-<date>.dump.gpg > sprawniej.dump`.
2. A new project, set up with steps 1 to 5 above, **including `db push`**: the migrations make the tables, functions,
   rules, the bucket and the nightly jobs. Leave `.env.local` and publishing until the data is in.
3. Put the data back, data only, with triggers off, so nothing rewrites it on the way in (no new `changed_at`, issue
   numbers, authors or times, no history, no broadcasts). `session_replication_role = replica` does that, and it also
   lets the tables go in in any order:
   ```sh
   PGOPTIONS='-c session_replication_role=replica' pg_restore --data-only --no-owner --no-privileges      --dbname "<the new project's session pooler connection string>" sprawniej.dump
   ```
   What matters are `public` and `private` (all of it), `auth.users` and `auth.identities` (the accounts and how they
   sign in), and `storage.objects` and `storage.buckets`. Rows the migrations already made (`private.wiring`,
   `private.import_spec`, the `pictures` bucket) are refused as already there; that is expected, they are the same.
   The `storage.objects` rows only list the pictures: the files themselves aren't in the dump.
4. `bunx supabase migration list --linked`, the advisors, a sign-in with a test account, then `.env.local` or the
   repository variables, and publishing.

## Before the team joins

Stage A (now) keeps sign-up simple: no email is sent, so confirmations are off and there is no password reset. Before
the whole team joins:

- An email sender (SMTP) in the project, then **email confirmations on**. The confirm link must bring people back to
  their invite (`#/join/<token>`); today it would lose it (work log E128).
- Password reset by email, and a "Forgot your password?" in the app.
- Google sign-in, if wanted (the app is ready for it).
- Backups switched on, and a restore tried once.

## Good to know

- **Removed members hear changes until they reconnect.** Realtime checks who may listen when a browser joins a
  channel. Someone removed from a workspace keeps getting its changes until their browser reconnects (a reload, a
  dropped connection). Everything they try to read or change is refused at once. For a team of eight, that is fine.
- **Imports** go through `import_rows(workspace, table, rows)`, admins only. The caller sends the same columns in every
  row of a batch (a column missing from one row becomes empty, not its default), sends every required column in every
  row even when the row is already there and will only be updated (Postgres checks the whole row before it notices the
  row exists), and reuses the id of every row that came over before (rows are matched on their id; a new id with an
  old Linear id fails on purpose). A row whose id is used in another workspace is refused, and comments written here
  are never changed by an import. Imports keep their numbers and times, write no history and send one "catch up"
  message per batch instead of one per row. A second run with the same rows changes nothing.
- **Upsert needs every column.** A write that might insert or update (an upsert) needs permission to update every
  column it sends. Only read marks (`read_state`) allow that; everything else is an insert or an update.
- **Don't ask for notes back.** You can't read the inbox notes you send (they belong to the person they're for), so
  inserting them with `.select()` fails. Insert notes without asking for the rows back.
- **Pictures** are named `<workspace id>/<hash>.<ext>`. Upload with upsert off and treat "already there" as done.
- **Times** come back from the database with microseconds. Keep them when comparing "newer than", or catching up can
  miss a change.
