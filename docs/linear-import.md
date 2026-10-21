# Importing from Linear

Settings › Import from Linear brings a Linear workspace over in one go. It talks to Linear's GraphQL API straight
from the browser (Linear allows that): Linear's data comes straight to your browser and goes from there into the
workspace.

## Steps

The wizard has four steps (Key, Teams, People, Import):

1. **Key**: paste a Linear personal API key (Linear › Settings › Security & access › Personal API keys). It is
   used for this import only and not stored.
2. **Teams**: pick which Linear teams to bring. Each becomes a Sprawniej team with the same key (`ENG`), so
   `ENG-123` stays `ENG-123`. If a team here already uses that key, the issues join that team (handy for the
   first team made during setup); type another key to make a new team instead. If that team already has (or once
   had) an issue with the same number, the imported one gets the next free number, and the check step lists these.
3. **People** ("Who's who?"): Linear people are matched to the people in the workspace by name (only people who are in it now; someone
   who left can't be picked). You can fix any match. Someone
   with no match comes as a person who **hasn't joined** (`~jan-kowalski`): their issues stay assigned to
   them, their comments are theirs and views about them work. They get no inbox notes and can't be @mentioned. You
   can also pick **No one**: their issues come in unassigned, and their comments say who wrote them. Someone linked
   to someone here before (by an earlier import) is matched to them by their Linear id, whatever their names.
4. **Import**: first a check ("Ready to import"): how many teams, issues, comments, projects, labels and views will
   come over, and which views can't keep all their filters. When nothing changed in Linear since the last import, it
   says everything is already here. Then **Import**, for admins and owners only. A progress bar shows how much is saved; keep the page open until it's done.
   If it stops partway (the connection dropped, or a teammate added an issue that took a number the import needed),
   it says why. Everything saved until then stays, and **Try again** works out the rest from what's here now and
   brings it over: nothing comes over twice. That also works after reloading the page: a team the import brings
   issues into that has nobody in it yet gets the members a new team would (you, and the people matched to its
   issues' assignees and creators), and people who haven't joined get their email address. Going to another page while it
   saves doesn't stop it; coming back to Settings › Import from Linear shows how far it is.

The code: `src/features/import/linearApi.ts` reads Linear, `linearMap.ts` works out what is new or changed, in the
app's own shapes (a team, label, project, issue, comment or view each, plus people who haven't joined, and what
Linear took off since an earlier import; pure, tested in `tests/linearImport.test.ts`), and `ImportPage.tsx` is the
wizard (`prepareImport.ts` puts the pieces together for it and for the database test; `importRun.ts` keeps the import that is saving). `src/backend/importRows.ts` turns that into the steps that save it (`planImport`, pure, tested in
`tests/importRows.test.ts`) and sends them (`runImport`), through the database's `import_rows`, which saves quietly
(no history, keeping Linear's numbers and dates) and changes nothing when a row is already as it should be. The
steps, in order: people who haven't joined; teams that let go of a Linear team, new teams and their members, teams
that take one; labels; projects and their teams; issues without their parents, then the parents; issue labels;
followers; comments; views; the emails of people who haven't joined; and last, people who have joined since, whose
work moves to them. Each step sends up to 500 rows at a time. A dropped connection is tried again after 1, 3 and 9
seconds; a batch the database finds too slow is halved. `tests/db/import-linear.test.ts` runs it against a real
database.

## What comes over

| Linear | Sprawniej |
| --- | --- |
| Team (key, name, icon emoji) | Team |
| Workflow state | Status group: by name first (`In Review`), then by Linear's state type (`started` is In Progress, `unstarted` Todo, `backlog` Backlog, `completed` Done, `canceled` Canceled). `Triage` becomes Backlog. A new issue gets the group's default status (its first shown one); an issue imported again keeps its status while its group stays. |
| Priority 0 to 4 | Same numbers |
| Issue number, title, description (Markdown) | Same |
| Assignee, creator | The matched person, the person who hasn't joined, or no one |
| Subscribers | Subscribers (people who follow it anyway, by creating it, being assigned or commenting, aren't listed twice) |
| Labels | Labels (group labels are flattened: `Area/Charts` becomes `Area: Charts`) |
| Project (name, icon, description, state, lead, target date) | Project |
| Project status | One of the workspace's shown project statuses: by name first (`On hold`), then by Linear's kind of status (`started` is In progress; `backlog`, `planned`, `paused`, `completed` and `canceled` their own groups), which is that group's first shown status. The import never makes statuses. A project imported again keeps its status here while Linear's kind stays in its group. Older Linear workspaces only give the kind (`state`). |
| Project order | New projects go to the bottom of their board column, in Linear's order; projects already here keep their place |
| Parent issue | Parent (sub-issues) |
| Sort order | New issues go on top of their team, in Linear's order; issues already here keep their place |
| Comments | Comments, with the original author and date. Authors set to "No one" are shown as "From Linear: Name". |
| Due date, estimate | Kept (any estimate number stays as it is) |
| Created, updated, completed dates | Kept |
| Custom view (name, icon, description, filters) | View: a team's view stays with that team, a workspace view shows the whole workspace. See below for filters. |

Issues Linear has archived come along too, with their comments. Issues in Linear's trash don't.

Issues finished longer ago than the team keeps finished issues (six months unless it says otherwise), and untouched
since, go straight into the archive with their comments: rows with `archivedAt`. It's the same rule as the daily
tidy-up. They keep their numbers and can be searched, opened and restored like any archived issue.

## What doesn't

- Cycles, SLAs, customer requests, integrations, agents: Sprawniej doesn't have them.
- Parts of a custom view's filters (see below), and its layout: imported views start as a list grouped by status,
  showing finished issues too. Change that on the view; a later import keeps it.
- Images and files uploaded to Linear stay as links to Linear. They only open for people signed in to Linear.

## Custom views

Views of the picked teams come over, plus workspace views. The key's owner sees their own private views too, and
those come over as well; a view here is shared with everyone. The icon becomes the view's emoji when it is one (🔎
otherwise), and the owner is the matched person.

A view's filter becomes a filter tree (docs/data-format.md, `filters.tree`): "is", "is any of", "is not" (`neq`,
`nin`), "is set" (`null: false`) and "is empty" (`null: true`), joined with "and" and "or" across fields and inside
one, in groups up to three levels deep. These fields come over:

| Linear filter | Sprawniej filter |
| --- | --- |
| Status (a state, by id or name, or a type such as "started") | Status (a type brings every status of that kind) |
| Assignee (a person, "me" (`isMe`), or "no assignee") | Assignee (Me stays Me: whoever is looking); someone set to "No one" can't come over |
| Subscribers (`some`, `none`, or right on the field) | Subscribers: people following the issue (who made it, are assigned, commented, were mentioned or subscribed) |
| "Assigned to Jan" or "Jan is subscribed" | Subscribers: Jan (people follow what they're assigned to); with different people on each side, an "or" of both |
| Priority (also "more urgent than", `lt` / `gt`) | Priority |
| Labels (a label, every label in a group, `some`, `none`) | Labels. Labels a view needs come over even if no issue uses them yet. |
| Project (a project, or "no project") | Project |
| Team | Team (left out at the top of a team's view: the view is about that team already) |
| Created, updated, completed, due date | Dates (see below) |

Linear's app saves each filter as a list of choices inside the field (`assignee: { or: [{ id: { in: [...] } }] }`), and
a label filter also matches the label's sub-labels (`{ or: [{ name: … }, { parent: { name: … } }] }`); both are read.
Choices on one field are joined into one line where that means the same ("is Ana" or "is Bob" is "is Ana or Bob").
Me may be one of the people named, so "me and not Ana" stays two lines (or, inside one field, comes over not exact).

**Dates.** Linear counts from now with ISO-8601 durations (`-P1D` a day ago, `-P2W`, `P1M` in a month, `-PT12H`) or
names a day. Only lines the builder can show come over (see docs/data-format.md, dates in the tree).

- `createdAt`, `updatedAt` and `completedAt` later than `-P1D` become "in the last 1 day", earlier than `-P1M`
  "more than 1 month ago", and `null` "is empty" or "is set". Earlier than a time to come is any time at all (for
  `completedAt`: "is set").
- `dueDate` is a day, and "in the next 7 days" takes in the 7th, so "earlier than" and "up to" differ by a day:
  earlier than now is "overdue", up to `P7D` "overdue, or in the next 7 days", earlier than `P7D` "overdue, or in the
  next 6 days"; earlier than `-P3D` is "more than 3 days ago", up to `-P3D` "more than 2 days ago". Where no line says
  it to the day (up to today: "overdue, or in the next 1 day" takes in tomorrow; earlier than `P1M`), it comes over
  near enough and not exact. Hours count only as whole days.
- A day becomes "before" or "after". A due date is the day written ("later than Oct 1" starts on Oct 2). A time is
  the day it falls on in your time zone when you import: 2026-09-30T22:00:00Z imported in Warsaw is the start of
  Oct 1, so "from then on" is "after Sep 30", exactly. A time in the middle of a day takes in that whole day, and one
  moment ("on" a time) becomes that whole day; both are near enough, not exact.
- A duration mixing months and days, minutes, more than ten years, a time in the future for created, updated or
  completed, and a due date later than a day in the past (which takes in the future too, kept as "in the last" but
  not exact) don't fit.

**What can't come over** is left out: cycles, estimates, text search, who made it, `canceledAt` and other dates,
"has a label that isn't Bug", groups deeper than three levels, and a person set to "No one" ("assigned to Bob" can't
become "assigned to nobody"; "not Bob" goes too). Leaving something out of an "and" shows more issues, out of an "or"
fewer; either way the view still comes over with the rest of its filters, and the check step lists it as one that
may not show quite the same issues as in Linear. If none of a view's filters can come over, the view stays in Linear
instead of arriving as a view that shows every issue (and a view an earlier import made for it is removed). The check
step names both kinds of views.

The view keeps the tree, with the flat keys as a rougher copy for older versions of the app (`storedFilters`); a
filter the flat keys can say exactly is kept as just those. Running the import again replaces an imported view's
filters with what Linear has now, also moving a view an older import saved flat onto the tree.

`src/features/import/linearFilters.ts` does the filter mapping (tested in `tests/linearImport.test.ts`). If reading
views from Linear fails, the import goes on without them and says so.

## Running it again

Each imported row remembers its Linear id (`linearId`), and so does a team that took in a Linear team (only one team
at a time: another team that had it lets go). Running the
import again picks those teams by itself and updates what came over instead of making copies, so you can import
once early and again on switch-over day. People who hadn't joined don't need another import: invite or link them in Settings › People from Linear. If an import matches someone who hadn't joined to a person who has,
everything that pointed at them (imported or made here since: issues, archived issues, comments, project leads and
views) moves to that person, the person who hadn't joined goes away, and the one who joined remembers their Linear id
(`linearIds`). Linear's version wins for imported issues and views (except an issue's place in the list and a view's
layout, which stay as you set them); issues and views made here are left alone.
Issues deleted in Linear stay here, and issues archived here since the last import stay archived, with their
comments.

What else a later import does:

- **Labels taken off an issue in Linear**, and **teams taken off a project there**, are taken off here too. The
  issue's history says you took the label off. Labels still on an issue keep their order here.
- **A project keeps the teams that weren't imported this time**: importing only Design again doesn't take
  Engineering off a project they share.
- **People who haven't joined** get their name and picture from Linear again, when they changed there.
- **Links to Linear issues** in descriptions and comments follow the issue's number and key here, also when the
  issue got another number (`ENG-2` became `ENG-4`) or its team another key (`DES` became `DSN`).
- **Who made an issue, who wrote a comment and who owns a view** stay as the first import had them. A comment that
  came in as "No one" keeps saying who wrote it in Linear, until it's matched to its writer; a comment whose writer
  is its author never gets that line. Matching someone later only moves what was given to a person who hadn't
  joined.
- **An issue's team and a view's team** stay as they are here: picking other keys for the teams later doesn't move
  them.
- The check step counts everything the import covers, also comments on issues archived here that are already here.
- Every number a team ever used counts as taken, also numbers of issues deleted since, so no number is given twice.
