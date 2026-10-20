# GitHub: pull requests move issues

When a pull request that mentions an issue (`ENG-12`) opens or becomes ready for review, the issue moves to
In Review. When it is merged, the issue moves to Done. The change is written as the person who opened the pull
request, so the issue's history and their teammates' Inbox show them, with a link to the pull request.

Status: **design, waiting for agreement.** Nothing here is built yet.

## The pieces

```
GitHub ──(signed webhook)──▶ Edge Function github-webhook ──(service role, 2 calls)──▶ Postgres
                                 │  checks the signature            github_lookup(): who, which issues, followers
                                 │  finds ENG-12 in the PR          github_apply():  moves them as that person,
                                 │  works out notes (notify.ts)                       adds Inbox notes
Settings › GitHub (admins) ──────────────────────────────────────▶ github_repos (which repository feeds which workspace)
```

No new server: one Edge Function in the same Supabase project, two SQL functions only it may call, and one table.
The function never calls GitHub back, so it needs no private key and no GitHub token: GitHub sends everything it
needs in the webhook.

## 1. The GitHub App (made by hand, once)

Made by the owner of the account or organisation whose repositories it should watch (GitHub › Settings › Developer
settings › GitHub Apps › New GitHub App):

| Setting | Value |
| --- | --- |
| Name | `Sprawniej` (or `Sprawniej <team>`; it has to be unique on GitHub) |
| Homepage URL | `https://michalsek.github.io/sprawniej/` |
| Callback URL, Setup URL, "Request user authorization" | empty / off (nobody signs in through the App) |
| Webhook | Active. URL `https://<project ref>.supabase.co/functions/v1/github-webhook` |
| Webhook secret | a long random string (`openssl rand -hex 32`), kept only in your shell and in Supabase |
| Repository permissions | **Pull requests: Read-only**, Metadata: Read-only (always on). Nothing else. |
| Subscribe to events | **Pull request** only |
| Where can it be installed | **Only on this account** |

Then install it (the App's page › Install App) on the repositories that should move issues, and give the secret to
the function from the repo folder, without writing it to a file:

```bash
GITHUB_WEBHOOK_SECRET=… bunx supabase secrets set GITHUB_WEBHOOK_SECRET --project-ref <project ref>
```

(`supabase secrets set NAME` with no `=value` reads it from the environment; if this CLI version doesn't, use
`bunx supabase secrets set "GITHUB_WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET"`.) The function reads `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, which Supabase gives every function.

## 2. The database (one migration)

`supabase/migrations/2026102000000x_github.sql`:

**`github_repos`**: which repository feeds which workspace.

| Column | Meaning |
| --- | --- |
| `id` | uuid |
| `workspace_id` | the workspace; deleting it deletes the connection |
| `repo` | `owner/name` as the admin typed it (checked against GitHub's pattern); unique per workspace, case aside |
| `repository_id` | GitHub's number for the repository, filled the first time a pull request arrives; after that it matches by number, so renaming the repository keeps working (`repo` follows the new name) |
| `added_by`, `created_at` | set by triggers |
| `last_event_at`, `last_event` | what happened with the latest pull request, for the Settings screen: `{"number": 12, "url": "…", "action": "merged", "moved": ["ENG-12"], "skipped": "author"}` |
| `changed_at` | as everywhere |

- A row in `private.wiring` with no broadcast topic (like invites): admins read it when Settings opens.
- Rules: **only admins and owners** of the workspace read, add and delete rows. Column grants: insert `workspace_id`
  and `repo`; nobody updates (`repository_id` and `last_event*` are written only by `github_apply`).
- Two workspaces may connect the same repository; each moves only its own issues.

**`github_lookup(repository_id, repo, author_github_id, refs[])`**, for the function only (granted to
`service_role`, not to `authenticated` or `anon`). For every workspace that connected the repository it returns: the
connection, **the author's profile if they are a current member of that workspace**, and the issues the refs name
(by team key and number, or by an old number in `former_refs`; archived issues are left alone) with what the notes
need (status, creator, assignee, description, followers, comments' authors and text, the members' logins).

**`github_apply(connection, actor, via, moves, notes, summary)`**, for the function only. In one transaction:
checks the actor is a current member, sets `sprawniej.actor` (and the new `sprawniej.via`) for the transaction,
updates each issue's status only if it still has a status it may move from (so two deliveries at once, or a
teammate's change in between, don't fight), adds the Inbox notes for the issues that really moved, and writes
`last_event` on the connection. Everything the database fills in still comes from the triggers: `updated_at`,
`completed_at`, `changed_at`, the history row with the actor, the broadcast to open browsers, `check_note` on the
notes.

**History says why.** `private.issue_history()` is replaced so that when `sprawniej.via` is set, the event gets
`"via": {"pullRequest": {"repo": "acme/web", "number": 12, "url": "https://github.com/…"}}`. The issue page shows
"Ania moved it to Done · pull request #12" with a link. Older app versions ignore the unknown key.

**`github_id` gets filled.** Today a profile has a `github_id` only when it was made by a GitHub sign-in (E130).
`ensure_profile()` is replaced so that a profile without one gets it from the person's GitHub sign-in way (the
`auth.identities` row, which GitHub vouched for) the next time they open Sprawniej, unless another profile already
has it. Nobody can type a GitHub id.

The usual steps go with the migration: types, `SCHEMA_ID`, the wiring lists in the tests, `bun run test:db`,
advisors, docs/data-format.md.

## 3. The Edge Function `supabase/functions/github-webhook`

`verify_jwt = false` in `config.toml` (GitHub sends no Supabase sign-in; the signature is the check).

1. **Signature.** Reads the body as raw bytes, computes HMAC-SHA256 with `GITHUB_WEBHOOK_SECRET` (Web Crypto) and
   compares it with `X-Hub-Signature-256` in constant time. Wrong or missing: 401, nothing read. No secret set: 500.
2. **Event.** `ping`: 200. Anything but `pull_request`: 204. A body over 1 MB: 413.
3. **What it means** (pure, unit-tested):

   | `pull_request` action | Moves to | Only from |
   | --- | --- | --- |
   | `opened` or `reopened`, not a draft | In Review | Backlog, Todo, In Progress |
   | `ready_for_review` | In Review | Backlog, Todo, In Progress |
   | `edited`, open and not a draft (a ref added to the title) | In Review | Backlog, Todo, In Progress |
   | `closed` and merged | Done | Backlog, Todo, In Progress, In Review |
   | `closed` without merging, drafts, anything else | nothing | |

   Nothing moves backwards: a Done, Canceled or Duplicate issue stays as it is.
4. **Refs.** From the branch name (any case: `eng-12-fix-login`), the title and the body (as written: `ENG-12`,
   skipping code). The pattern is the team key's (`src/model/schema.ts` `TEAM_KEY`), then `-` and a number, not
   inside a longer word. At most 50. A ref that is no issue in the workspace is ignored, so `UTF-8` is harmless unless
   there is a team `UTF`. Old numbers count: an issue moved from `WEB-2` to `ENG-14` is found by either.
5. **Who.** The pull request's author (`pull_request.user.id`), for every action, merges included. If they are not a
   current member of the workspace with GitHub as one of their ways to sign in, **nothing moves** in that
   workspace, and `last_event` says so (Settings shows "Not moved: @octocat isn't in this workspace with GitHub").
   This keeps bots and strangers out, and it means a workspace that connects someone else's repository gets nothing
   from it.
6. **Notes.** For each issue that will move, the function builds the issue as the app sees it and calls
   `issueNotes()` from `src/data/notify.ts`, the same rule the app uses: everyone following the issue hears about
   the new status, except the author. `github_apply` inserts them with the author as actor.
7. **Answer.** 200 with a short summary (`{"moved": ["ENG-12"]}`), which GitHub shows under Recent Deliveries.
   A failure is 500, and GitHub's "Redeliver" button tries again; moving twice changes nothing, and `check_note` drops
   a repeated note.

**Code layout.** The logic is plain TypeScript in `src/github/` (refs, actions, signature, notes, the handler with
`fetch` injected), unit-tested with `bun test` and type-checked with the app. `src/github/server.ts` is the Deno entry
(`Deno.serve`). `bun run deploy:github` bundles it with `bun build` into `supabase/functions/github-webhook/index.js`
(not in git) and runs `bunx supabase functions deploy github-webhook --use-api` (no Docker). It talks to the database
with `fetch` and the REST API, so `@supabase/supabase-js` stays inside `src/backend`.

## 4. The app

- **Settings › GitHub** (a new section, admins and owners):
  - Empty state: "Connect a repository and its pull requests move issues: In Review when one opens, Done when it's
    merged." and one button, **Connect a repository**, which opens a small dialog: `owner/name`, Connect.
  - Each connected repository: its name (a link to GitHub), "Waiting for the first pull request" or "Last: #12 moved
    ENG-12 to Done, 5 minutes ago" / "Last: #13 moved nothing: @octocat isn't in this workspace with GitHub", and a
    Remove button with a confirmation.
  - A line under it: "The repository also needs the Sprawniej GitHub App. Ask whoever set up Sprawniej to add it."
    (with a link to the App's install page when `VITE_GITHUB_APP_URL` is set).
  - Members see one line instead: "Your pull requests move your issues when GitHub is one of your ways to sign in."
- Changes go through `src/data/actions.ts` (`connectRepo`, `disconnectRepo`, admin checked) and
  `src/backend/github.ts` (the calls), like invite links.
- **History:** the `via` link on status lines (`src/data/history.ts`, the history line component).
- **docs/user-guide.md** and Help: a short "GitHub" part (how to mention an issue, what moves when, the author rule).
  **docs/supabase-setup.md**: making the App and setting the secret, in the runbook.

## 5. Tests

- `bun test`: refs (branch case, title, body, code skipped, former refs, limits), the action table, the signature
  (right, wrong, missing, other length), notes built from rows match `issueNotes`, the handler end to end with a fake
  `fetch`, history lines with `via`.
- `bun run test:db`: members can't see or add connections, admins can, the column grants hold; `authenticated` can't
  call `github_lookup` or `github_apply`; the lookup finds issues by number and old number and the author only when a
  member; apply moves only from allowed statuses, writes history with the actor and `via`, adds notes and refuses a
  non-member actor. (These two run through `bunx supabase db query --linked` as the service role would.)
- By hand: deploy, connect a throwaway repository, open a pull request mentioning a test issue, mark it ready, merge
  it, and watch the issue move in a browser.

## 6. Questions to agree on

1. **The author rule** (5 above): nothing moves for authors who aren't members with GitHub linked. The alternative
   (move anyway, written as nobody) lets anyone who can open a pull request in the repository move issues, and lets
   another workspace that connects the same repository read our pull requests' numbers and links.
2. **GitHub sign-in must be on** for the author rule to match anyone: the OAuth app from the 2.0.0 list, and each
   teammate adds GitHub in Settings › Your account. Until then nothing moves.
3. **Words.** Teammate screens must not say "pull" or "merge". This feature can't avoid "pull request" and "merged".
   Allow them in Settings › GitHub, the history link and the guide's GitHub part only?
4. **Links on the issue page** (an `issue_pull_requests` table: the pull requests that mention an issue, shown under
   its title, live). Left for later: the history link covers "why did this move".
5. **Release:** 2.1.0 (MINOR). The migration only adds and replaces two functions; older apps keep working.
