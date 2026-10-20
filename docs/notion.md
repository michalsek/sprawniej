# Notion: send a page to Sprawniej

A database button or an automation in Notion sends a page, and it becomes an issue: its title, a link back to the
page, and its status, priority, assignee, due date, labels and description when the page has them. When the page's
**Created by** person is a member, the issue is theirs; otherwise it was made by nobody, "from Notion". Sending the
same page again keeps the issue it made.

Status: **agreed and built** (the database, the function, history, Inbox, the issue page and Settings › Notion). The
user agreed the choices in section 7 on 2026-10-20. The steps for a project are in docs/supabase-setup.md (Notion:
pages become issues).

## The pieces

```
Notion database button / automation
  "Send webhook" POST JSON ──▶ Edge Function notion-webhook ──(service role, 2 calls)──▶ Postgres
  …/notion-webhook?c=<connection>&k=<secret>  │ answers anything but POST at once       notion_lookup(): checks the key's hash;
  (or the header X-Sprawniej-Secret)          │ hashes the key (sha256)                  team, members, matching emails, labels
                                              │ reads the page's properties             notion_apply(): checks the hash again;
                                              │ works out notes (notify.ts)               the same page: the issue it made,
                                              │                                           otherwise makes the issue as the author
                                              │                                           (or nobody), with labels, notes, history
Settings › Notion (admins) ── notion_connect / notion_new_secret / team / delete ──▶ notion_connections
                                                                                     private.notion_pages (page → issue)
```

No new server: one Edge Function, four SQL functions (two for admins, two only the service role may call), one table
and one private table. The function never calls Notion back, so it needs no Notion token, and it needs **no Supabase
secret** of its own: each workspace's secret lives in the database as its sha256.

## 1. What Notion sends (researched 2026-10-20)

Notion's help: https://www.notion.com/help/webhook-actions

- **Paid plans only** (Plus, Business, Enterprise; Enterprise owners can turn it off).
- "Send webhook" is an action in buttons, database buttons and database automations. Always `POST`, JSON. Up to five
  per automation.
- **Custom headers** can be added (key and value). Notion sends no sign-in or signature of its own, and sets
  `Content-Type` itself.
- Only the page's **properties** are sent, never its text. An automation sends the properties you tick; a database
  button sends all of them.
- No retry, timeout or answer rules are documented. A failed delivery marks the automation with "!" and **pauses
  it** until someone resumes it. `source.attempt` suggests Notion may send more than once.
- Notion shows no preview of the payload. Its shape below is what several working receivers see; it isn't documented.

```json
{
  "source": { "type": "automation", "automation_id": "<uuid>", "action_id": "<uuid>", "event_id": "<uuid>",
              "user_id": "<uuid: who pressed it>", "attempt": 1 },
  "data": {
    "object": "page", "id": "<page uuid>", "created_time": "…", "last_edited_time": "…",
    "created_by": { "object": "user", "id": "<uuid>" }, "last_edited_by": { "object": "user", "id": "<uuid>" },
    "parent": { "type": "data_source_id", "data_source_id": "<uuid>", "database_id": "<uuid>" },
    "archived": false, "in_trash": false, "is_locked": false,
    "properties": {
      "Task name":  { "type": "title", "title": [ { "type": "text", "plain_text": "…", "annotations": {…}, "href": null } ] },
      "Status":     { "type": "status", "status": { "name": "In progress" } },
      "Priority":   { "type": "select", "select": { "name": "High" } },
      "Assignee":   { "type": "people", "people": [ { "object": "user", "id": "…", "name": "…", "person": { "email": "…" } } ] },
      "Created by": { "type": "created_by", "created_by": { "object": "user", "id": "…", "person": { "email": "…" } } },
      "Due":        { "type": "date", "date": { "start": "2026-10-31", "end": null, "time_zone": null } },
      "Description":{ "type": "rich_text", "rich_text": [ … ] },
      "Labels":     { "type": "multi_select", "multi_select": [ { "name": "Bug" } ] }
    },
    "url": "https://www.notion.so/…", "public_url": null, "request_id": "<uuid>"
  }
}
```

People at the top level (`source.user_id`, `data.created_by`) carry only an id, **no email**. Emails appear only inside
person properties (`people`, `created_by`) as `person.email`. That is why the author comes from a **Created by**
property. `tests/fixtures/notion-page.json` is a full example with made-up ids.

## 2. The database (`supabase/migrations/20261020160000_notion.sql`)

Only adds, so older apps keep working.

**`notion_connections`**, one per workspace:

| Column | Meaning |
| --- | --- |
| `id` | uuid; part of the address (`?c=`) |
| `workspace_id` | unique: one connection per workspace; deleting the workspace deletes it |
| `team_id` | where pages become issues; set null when that team is deleted (then pages wait for another team) |
| `secret_hash` | sha256 (hex) of the secret in the address. The secret itself is never stored |
| `secret_set_at` | when the address was made or last replaced |
| `added_by`, `created_at` | set by triggers |
| `last_event_at`, `last_event` | the latest page, for Settings: `{"title", "ref", "new": true, "author"}`, `{"title", "ref", "new": false}`, `{"title", "problem": "team"}`, `{"problem": "busy"}` |
| `changed_at` | as everywhere |

- A row in `private.wiring` with no broadcast topic, like invites and `github_repos`.
- Rules: only admins and owners read, change and delete it. Column grants: `update (team_id)` and delete; no insert
  (`notion_connect()` makes it, with its secret). The hash sits in an ordinary column that only admins can read: it is
  the sha256 of 32 random bytes, so it gives nothing away.

**`private.notion_pages`**: which page made which issue. `(workspace_id, page_id)` is the key, so the same page in
the same workspace makes one issue, also after disconnecting and connecting again (`connection_id` is set null).
Deleting the issue deletes the row, so the page can be sent again; archiving keeps it. In `private`, never sent to
browsers.

**For admins** (granted to `authenticated`):

- `notion_connect(workspace, team)` gives `{"id", "secret"}` (`42501` not an admin, `23503` no such team in the
  workspace, `23505` already connected). The secret is `gen_random_bytes(32)` as hex; only its sha256 is stored.
- `notion_new_secret(connection)` is "Replace address": a new secret, given back once. The old one fails at its next
  use, because both functions below compare the hash, `notion_apply` under the connection's row lock.

**Only for the service role** (the Edge Function):

- `notion_lookup(connection, secret_hash, emails, team)`: `{"state": "unknown"}` or `{"state": "wrong_key"}` and
  nothing else, unless the hash matches. Then the workspace, the team (the page's Team property by key or name, never
  another workspace's, else the connection's) with `first_sort` (the smallest `sort_order` of its open issues), the
  members, the members whose confirmed sign-in email is one of `emails` (at most 20; the emails never leave the
  database except as that match) and the labels.
- `notion_apply(connection, secret_hash, page, actor, issue, notes)`, in one transaction:
  1. locks the connection and checks the hash (`42501` "This address was replaced.");
  2. checks the page id (32 hex digits) and the address (on notion.so or notion.site, otherwise one made from the id);
  3. **the same page**: answers `{"issue", "new": false, "archived"}` and makes nothing;
  4. **too many**: 100 or more pages made through this connection in 10 minutes: `{"problem": "busy"}`;
  5. **no team** (null, or not this workspace's): `{"problem": "team"}`;
  6. the actor must be a member now (`42501`), as in `github_apply`;
  7. tidies the rest: title whitespace, "Untitled", 500 characters; description 50,000; an unknown status Todo (the
     list has the `-- @list issue-statuses` marker); priority 0 to 4; a due date that is a real day; an assignee who is
     a member now, else nobody; labels of this workspace, at most 20;
  8. sets `sprawniej.actor` (when there is one) and `sprawniej.via` to `{"notion": {"url"}}`, which it builds itself;
  9. inserts the issue (the triggers fill the number, the author, the times, the `created` event, the broadcast),
     its labels, the page row and the notes (`extra = {"from": "notion"}`; `c_check_note` drops the rest);
  10. writes `last_event` and answers `{"issue", "new": true}`.

Each of 3 to 5 also writes `last_event`, so Settings can say why.

**History says where it came from.** A new trigger, `history_created` (after insert on issues), writes
`{"created": true, "via": {"notion": {"url"}}}` by the actor (or nobody) when `sprawniej.via` is set. Issues made in
the app or by an import still write none. `private.issue_history` is unchanged.

## 3. The Edge Function `notion-webhook`

`verify_jwt = false` in `config.toml`. The code is `src/notion` (`handler.ts` with `fetch` injected, `page.ts`,
`markdown.ts`, `notes.ts`, `key.ts`; `server.ts` is the Deno entry), bundled by `bun run deploy:notion`.

| # | Check | Answer |
| --- | --- | --- |
| 1 | not `POST` | 405, nothing read |
| 2 | `c` missing or not a uuid | 404, no database call |
| 3 | no key: `k` when it is 64 hex digits, otherwise the `X-Sprawniej-Secret` header's | 401 |
| 4 | the project settings missing | 500 |
| 5 | over 1 MB (by `content-length`, then by what arrived) | 413 |
| 6 | `notion_lookup` with the key's sha256 | `unknown` 404 ("Notion was disconnected"), `wrong_key` 401 ("This address was replaced") |
| 7 | not JSON, or not a page (said only after the key is checked; properties of a shape Notion never sends read as nothing) | 400 |
| 8 | the page is in the trash or archived | 200 `{"skipped": …}`, nothing made |
| 9 | `notion_apply` | 200 `{"issue": "ENG-12", "new": true}` or `"new": false`; `problem: team` 409; `problem: busy` 429 |
| 10 | a database call fails | 500 (`server.ts`) |

Notion pauses an automation on an answer that isn't 2xx. "Nothing to do" (a page sent before, a page in the trash) is
200; what someone has to fix (an old or wrong key, no team, flooding) isn't, so Notion's "!" tells them to look.

**Logs.** Our function never logs the address (it holds the key), the headers, the body, titles or emails. One line
per answer: `notion { issue, new }`, `{ skipped: 'trash' }`, `{ refused: 'not a page' }` or `{ problem }`, and the
error on a 500, which names the database call and its code, without the details (they can hold the title).

Supabase's own logs are another matter: **its invocation logs keep the full address of every request, key
included** (Dashboard, Edge Functions, notion-webhook, Invocations; and the API gateway's logs). Only the project's
owners see them, and they hold the service key anyway. Someone who would rather the key showed in no log at all uses
the header form instead: in Notion, the address without `&k=…` as the URL, plus a custom header
`X-Sprawniej-Secret` with the key as its value.

**What the page means** (`page.ts`; names and values compared with `plainName`, so case, accents, spaces and
punctuation don't count):

| Issue | Notion property | Rule |
| --- | --- | --- |
| title | the one of type `title`, whatever it's called | parts joined, on one line, "Untitled" when empty, 500 characters |
| status | `Status` (status or select), else the first of type status | backlog: Backlog, Icebox, Later · todo: Todo, To do, Not started, New, Open, Ready, Planned · in_progress: In progress, Doing, Started, WIP, Active · in_review: In review, Review, Reviewing, QA, Testing · done: Done, Complete, Completed, Finished, Shipped, Released · canceled: Canceled, Cancelled, Won't do, Dropped, Rejected · duplicate: Duplicate. Anything else Todo |
| priority | `Priority` (select or status) | Urgent, Critical, Highest, P0: 1 · High, P1: 2 · Medium, Normal, P2: 3 · Low, Lowest, P3, P4: 4 · anything else 0 |
| assignee | `Assignee`, `Assignees`, `Assigned to` or `Owner` (people) | the first person whose email is a member's |
| author | the first of type `created_by` | its email, when it's a member's; otherwise nobody |
| due date | `Due`, `Due date`, `Deadline` or `Due on` (date) | `start`'s day, when it is a real one |
| labels | `Labels`, `Label` or `Tags` (multi-select or select) | the workspace's labels with those names; never new ones; 20 at most |
| team | `Team` (select, status or text) | a team's key or name; otherwise the connection's |
| description | `Description`, `Details` or `Notes` (text) | Markdown, then a blank line and `[Notion page](url)` |

**Rich text** (`markdown.ts`): neighbouring parts with the same marks and link are joined first, so a word bold in
part reads right; then the text with bold (`**`), italic (`*`, which also works inside a word), strikethrough and code; an `https://` link becomes a
Markdown link (any other is dropped); underline and colour are dropped; a line break stays one, a blank line is a new
paragraph; mentions and equations are their text; `<` and `>` are escaped, so no HTML comes through. The description
is cut so that it and the link back fit in 50,000 characters. Titles and descriptions are cut by characters, never in
the middle of an emoji.

**The page's address** must be on notion.so or notion.site and hold nothing after the host that Markdown or HTML would
read (no spaces, parentheses, double quotes or angle brackets); otherwise it becomes `https://www.notion.so/<id>`. The
rule and the uuid and page id patterns are in `src/model/notion.ts`; `notion_apply` and `private.notion_pages` copy
them with `-- @regex notion-…` markers, which `tests/statusLists.test.ts` compares.

**Notes** (`notes.ts`): `issueNotes()` from `src/data/notify.ts` for a new issue, as the app does: the assignee
(unless they are the author) and every member @mentioned in the description. Each gets a ULID.

## 4. The app

- `src/backend/notion.ts`: `getNotion(ws)` (never the hash), `connectNotion(ws, team)`, `newNotionAddress(id)`,
  `setNotionTeam(id, team)`, `disconnectNotion(id)`, and the pure `notionAddress(base, id, secret)` and `readLast`.
  Errors in plain words (`RULES.notNotion`, "Notion is already connected.", "That team is gone. Pick another.").
- `src/data/actions.ts`: `connectNotion(teamKey)` (gives the address), `newNotionAddress(id)`, `setNotionTeam(id,
  teamKey)`, `disconnectNotion(id)` (`id`: the connection's, from `getNotion`), each for admins only.
  `window.sprawniej.actions` has them, for scripted checks.
- History (`src/data/history.ts`): `via` is a pull request or `{"notion": {"url"}}` (links on notion.so or notion.site
  only); `createdVia()` reads the `created` event; labels put on by nobody right after nobody made the issue are part
  of making it.
- The issue page: the first activity line says "**Ana** created the issue from [Notion]" or "Created from [Notion]"
  (with the Notion mark, `src/components/NotionMark.tsx`); the sidebar says "Created Oct 20" with no "by" when nobody
  made it.
- Inbox: `from: 'notion'` (kept in the row's `extra`): a note with no actor shows "Notion" with the mark.
- **Settings › Notion** (`src/features/settings/NotionSettings.tsx`, the page after GitHub in `pages.tsx`; its
  words for the last page are in `notionText.ts`):
  - admins, not connected: an empty state, "Notion isn't connected", "A button in Notion can send a page here, and it
    becomes an issue: its title and a link back, plus its description, status, priority, assignee and due date when
    the page has them." and **Connect Notion**, which asks for the team ("Pages become issues in", your first team
    first) and, after **Make the address**, shows the address once in a read-only field with **Copy** and how to paste
    it into a **Send webhook** action, then **Done**;
  - admins, connected: the team picker (saves at once: "Pages from Notion now go to Design."), the last page ("Waiting
    for the first page", "Last page: “Fix login” became ENG-12 · 5 min ago", "Last page was already ENG-12", "Last page
    wasn't added: pick a team", "Pages were coming too fast…"), "Address made 3 days ago", **Replace address** and
    **Disconnect**, each behind a confirmation; a missing team says "The team for Notion pages was deleted. Pick
    another.";
  - members: "Admins and owners can connect Notion so pages sent from it become issues."
  - read when the page opens, after a change and when the window gets focus, like the repositories; when it can't
    be read: "We couldn't load the Notion connection. Try again." with **Try again**.

## 5. Tests

- `bun test`: `tests/notion.test.ts` (reading a page, every property rule, rich text, notes, the key, the handler end
  to end with a pretend `fetch`: every answer, the hash and never the key in calls, the log line), `tests/history.test.ts`
  (`via.notion`, `createdVia`, labels by nobody), `tests/notionSettings.test.ts` (the address, `readLast`, the words),
  `tests/rows.test.ts` (`from` on a note).
- `bun run test:db`: `tests/db/notion.test.ts`: who connects and sees it, the grants, the lookup (keys, emails of
  members only, confirmed, the Team hint), replacing the address, making an issue with and without an author (history,
  labels, notes, the page row, the broadcast), the same page again, archived and deleted issues, a deleted team, a
  stranger as author or assignee, flooding, tidying, reconnecting.
- By hand: docs/supabase-setup.md has curl steps that need no Notion, and the checklist for someone with a paid plan.

## 6. Limits

1 MB a request, 100 new issues per connection per 10 minutes, titles 500 characters, descriptions 50,000, 20 labels,
20 emails. Two database calls, so a page becomes an issue well within a second.

## 7. Agreed (2026-10-20)

1. **The same page again** keeps its issue and answers with it (200). Nothing a teammate changed is overwritten.
2. **The key goes in the address** (`…?c=<id>&k=<key>`): one paste into Notion. Supabase's own invocation and gateway
   logs keep that full address, key included; only project owners see them, and they hold the service key anyway.
   The header form (the address without `k`, plus the custom header `X-Sprawniej-Secret`) keeps the key out of every
   log. Not `Authorization: Bearer`, which the gateway may read as a sign-in.
3. **One connection per workspace**, with a team, plus an optional Team property naming a team by key or name.
4. **The author** is only the Created by property's person, matched by email to a member now. Otherwise nobody: "From
   Notion".
5. **sha256 only**, shown once. Replace address is the way back.
6. **Labels** are matched to existing labels only; new ones are never made.
7. **Words**: Settings › Notion and the guide's Notion part may say Notion's own words ("database", "database
   button", "automation", "Send webhook", "property"); CLAUDE.md, Writing.
8. **Inbox notes** as in the app: the assignee and @mentioned members, shown as from "Notion" without an author.

Release: MINOR (the migration only adds).
