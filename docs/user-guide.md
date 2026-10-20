# Welcome to Sprawniej

Sprawniej is where our team keeps track of work: tasks, bugs and ideas. This page explains everything you need.
No technical knowledge required.

## Getting in

A teammate sends you an **invite link**. Open it: it shows the workspace, who invited you and who's already there.
Press **Join workspace**, then:

1. **Create your account** with your email and a password (at least 8 characters), or press **Continue with
   GitHub** if you see it and have a GitHub account. The invite link lets you in, so you don't need a sign-up code.
   Already have an account? Choose **Sign in** instead.
2. **Pick your name and handle** ("What should we call you?"). Teammates see your name on issues and comments, and
   @mention you by your handle. The handle can't be changed later.

That's it: the workspace opens. Each invite link works once, for 14 days. If yours was already used or has
expired, ask whoever invited you for a new one.

No invite link? Then you need a **sign-up code** to create an account: ask whoever looks after Sprawniej for one.
Open Sprawniej, choose **Create an account** and type the code in with your email and password (with GitHub, you type
it on the next screen, where you pick your name). Capital letters and dashes don't matter. A code works for a few days,
and for as many accounts as it was made for; if yours doesn't work any more, ask for a new one. Then pick your name,
and **Create a workspace**: give it a name and a first team. You're its owner.

The first time you open your team's issues, four short tips show you around. You can see them again from the
**Help** page (**Show the tour again**).

### More than one workspace

If you're in several workspaces, Sprawniej asks which one to open (the ones you opened lately come first). To go to
another one later, open the menu under your name (bottom left) and choose **Switch workspace**. The same list has
**Create a new workspace**.

### Your name

To go by another name, open **Settings and people** (in the menu under your name) and type it under **Your
account**; it saves by itself. Your handle (@you) stays the same.

### Ways to sign in

**Settings › Your account › Ways to sign in** lists how you can sign in:

- **Email and password.** **Change password** picks a new one. Signed up with GitHub? **Set a password** lets you
  sign in with your email too.
- **GitHub.** **Add GitHub** takes you to GitHub and back; from then on **Continue with GitHub** signs you in.
  **Remove** stops it, when you added GitHub to an account made with your email. An account made with GitHub keeps
  GitHub, even after you set a password. If it says signing in with GitHub isn't switched on yet, use your email and
  password.

**Forgot your password?** Sprawniej can't email you a new one yet. If you also added GitHub, sign in with GitHub and
choose **Change password**. Otherwise, ask whoever looks after Sprawniej for help.

### Inviting someone

Only owners and admins can invite. Open the menu under your name (bottom left), choose **Settings and people**, and
under **Invite links** press **Create an invite link**. Make **one link for each person**: you can add their email
(so you remember where to send it) and pick whether they join as a **Member** or an **Admin**. Press **Create
link**, then **Copy message** gives you a ready-to-send note with the link, **Copy link** just the link, and **Write
an email** (when you added their email) opens your own mail app. Sprawniej doesn't send anything itself: you send the
link.

Each link works once, for 14 days, and stays under **Invite links** until it's used; an expired one stays there too,
greyed out, until you delete it. To stop a link from working (for example, if you sent it to the wrong person), open
the **⋯** next to it and choose **Delete link**. **Copy message** is in the same menu.

### Members and roles

**Settings › Members** lists everyone in the workspace. Everyone can see and change every issue, project, view and
label, and make teams. On top of that:

- **Owners** can do everything, including making or changing other owners.
- **Admins** invite people, change roles (except owners'), remove people (except owners), rename the workspace,
  delete teams and import from Linear.
- **Members** work on issues, projects and views.

Owners and admins change someone's role with the menu next to their name, and remove someone with **⋯ › Remove from
workspace**. Removed people can't open the workspace any more; their issues and comments stay, with their name. To
bring them back, send them a new invite.

### Leaving a workspace

To leave a workspace yourself, press **Leave workspace** under **Workspace** in Settings. Your issues and comments
stay, with your name; to come back, ask for a new invite. A workspace always keeps at least one owner: if you're the
only one, make someone else an owner first.

## Your work saves by itself

There is no Save button. Whatever you type or change is kept right away. In the top bar you'll see:

- **Saved**: everything is safe and your teammates can see it.
- **Saving…**: it's on its way, give it a second.
- **Offline**: no internet right now. Keep working and keep the tab open; your changes are saved when you're back
  online. If you try to close the tab before that, Sprawniej asks first.
- **Not saved yet**: Sprawniej can't be reached for a moment. It keeps trying; wait until it says Saved before you
  close the tab.
- **Reconnecting…**: your work is saved, and your teammates' changes will show up again in a moment.
- **Signed out**: sign in again to keep working. Everything on screen stays as it is.

Sprawniej needs the internet to save. If you sign out or switch workspace while something isn't saved yet, it asks
first.

If someone else's change and yours can't both be kept (say, they deleted an issue you were editing), a short message
says what wasn't saved.

Your teammates' changes show up on their own, as soon as they're saved.

### New versions

When a new version of Sprawniej is out, a small note says so, and **Update available** appears in the top bar next
to **Saved**. Nothing changes until you choose: press it when it suits you (whatever isn't saved yet is saved first,
then the page reloads), or just carry on, and the new version loads the next time you open Sprawniej.

To see what changed, open the menu under your name and choose **What's new**: every version, newest first.

## Issues

An **issue** is one piece of work: a task, a bug, an idea. Each has a short ID like `ENG-12` (team + number).

- **Create one:** press **C** anywhere, the pencil next to "Sprawniej" at the top left, or the **+** next to a group.
  Give it a title; status, priority, assignee, labels, project, parent, due date and estimate are optional buttons
  below.
  Press `⌘` `Enter` (or `Ctrl` `Enter`) to create it. Tick **Create more** to add several, one after another. Closed
  it by accident? What you typed comes back the next time you start a new issue.
- **Open one:** click it. Change the title, description or any property on the right. It saves by itself.
- **Labels:** in the labels menu, type a name that doesn't exist yet and choose **Create label "…"** (with the name
  you typed).
- **Move to another team:** change **Team** on the right. The issue gets that team's next number; links and mentions
  of its old number still open it.
- **Archive:** the `⋯` button next to the title, then **Archive** (see Archive below).
- **Delete:** the `⋯` button next to the title, then **Delete issue**.
- **Links and formatting:** paste a link and it becomes clickable. Select some words and paste a link to turn
  them into a link. Type `**bold**`, `- ` for a list, or `[] ` for a checklist, and it formats as you type.
- **Mention someone:** type `@` and their name. They'll get a note in their Inbox.
- **Point to another issue:** type its ID, like `ENG-7`. Hold `⌘` (or `Ctrl`) and click it to open it.

### Working at the same time as others

You never have to choose between your changes and a teammate's. If you both change different things, both stay. If
you both change the same thing (say, the status), the one saved last stays. If you both type in the same description
at once, their words come into yours as you type; if you both finish at the very same moment, the text saved last
stays. Two people adding issues at once always get different numbers.

### Statuses

- **Backlog**: we might do it some day.
- **Todo**: we plan to do it soon.
- **In Progress**: someone is working on it.
- **In Review**: it's done and waiting for someone to check it.
- **Done**: finished.
- **Canceled**: we decided not to do it.
- **Duplicate**: someone already reported the same thing.

### Priority

**Urgent** (orange), **High**, **Medium**, **Low** (fewer bars = lower), or no priority (three dashes).

### Due dates and estimates

- **Due date:** the day it should be done. Pick **Due date** on the right: **Today**, **Tomorrow**, **Next week**,
  **In two weeks**, or any day in the calendar. Lists and boards show it; it turns amber two days before and red
  once it's late (unless the issue is finished).
- **Estimate:** how big it is, in points: 1, 2, 3, 5 or 8. Bigger means more work. Pick **Estimate** on the right,
  or press `E` on an issue.

To see what's due first, choose **Ordering › Due date** under **Display**.

### Sub-issues

Big issues can be split into smaller **sub-issues**. The parent shows a counter like `2/5` (two of five done).

- **Add some:** open the issue and choose **Add sub-issues** under the description (or **+** next to "Sub-issues").
  Type a title and press `Enter`; the field stays open for the next one. `Esc` closes it. **More options** opens
  the full new issue form.
- **Make an existing issue a sub-issue:** change **Parent** on the right.

### Comments and history

Under each issue, **Activity** shows its comments and everything that happened to it, oldest first: who changed the
status, who it was given to, when the due date moved, and so on. It shows every change made in Sprawniej, and your
teammates' changes appear as they make them (it needs a connection to show). Changes from before your work was
brought over aren't shown. Issues that were finished and left alone for a while are archived by themselves at
night; their history says "Archived automatically".

Talk about an issue in the comments. Type, then press `⌘` `Enter` or **Comment**. Formatting, links,
`@` mentions and issue IDs work just like in descriptions. A comment you haven't sent yet waits in this browser,
so you can leave and come back.

To change or remove one of your own comments, use the `⋯` on it: **Edit** (it saves as you type; **Done** when
you're finished) or **Delete**. Only the person who wrote a comment can change or delete it.

### Subscribing

You hear about comments and status changes on issues you **follow**. You follow an issue by itself when you created
it, it's assigned to you, you commented on it, or someone mentioned you in it. To follow any other issue, press the
bell next to its title; press it again to stop (even for your own issues). **Subscribers** on the right shows who
follows it, and you can add or remove teammates there too.

## Lists and boards

Every list of issues can be shown two ways. Switch with **List / Board** at the top right.

- **List:** issues grouped by status. Sub-issues sit just under their parent.
- **Board:** a column per status, with cards. Empty columns wait under **Hidden columns** on the right, together
  with statuses the tab leaves out (like **Done** on the Active tab). Drop a card on one to move the issue there; the
  column then shows up with that card in it.

**Drag and drop** works in both. Drag an issue up or down to change its order, or into another group or column to
change its status. Your teammates see the new order too. No mouse? Move to an issue with `Tab` (or `J` and `K`),
press `Space` to pick it up, use the arrow keys, and press `Space` again to drop it (`Esc` puts it back). On a phone,
press and hold an issue for a moment, then drag it.

**Several at once:** hold `⌘` (or `Ctrl`) and click issues to pick them, or press `X` on each. `Shift`-click picks
everything between the last one you picked and this one. Drag any picked issue and the others come along, side by
side. The bar at the bottom changes the status, priority, assignee, labels or estimate of all of them (or archives
or deletes them); `S`, `P`, `A`, `L` and `E` do the same. `Esc` lets go of them.

**Display** (next to List / Board) changes how the page looks, just for you:

- **Grouping:** by status, assignee, priority, project, or **No grouping**. Dropping an issue into a group gives it
  that group's assignee, priority or project.
- **Ordering:** **Manual** is the order you and your teammates arrange by dragging. You can also sort by priority,
  by due date, by last update, or newest first. Dragging to reorder only works in Manual order.
- **Show sub-issues** hides or shows them. **Show finished issues** does the same for finished ones, on pages that
  can have them (not on the Active or Backlog tab, which never show finished issues).
- **Back to default** undoes your changes. It shows up once you've changed something (a saved view has none: its
  display is everyone's).

On your team's page, the tabs show:

- **Active**: Todo, In Progress and In Review.
- **Backlog**: ideas for later.
- **All issues**: everything, including finished work.
- **Archived**: issues put away (see below), with a search box.

## Archive

Finished issues leave the lists by themselves some time after they're done (six months unless your team picks
otherwise in **Settings › Archive**). That keeps lists short and the app quick. You can also archive any issue yourself
from its `⋯` menu, or several at once from the bar at the bottom; an issue's sub-issues go with it.

Archived issues aren't gone. Find them under the **Archived** tab of their team, or with `⌘` `K` search; links to them
still work. An archived issue can be read but not changed. Press **Restore** on it to bring it back, with its
comments, under the same ID.

## Teams

Your teams are in the sidebar under **Your teams**. Each team has its own **Issues**, **Projects** and **Views**.
Press **+** next to *Your teams* to join a team or create a new one. If you're in no team yet, Sprawniej asks which
teams you work with when you open the workspace; **Skip for now** if you'd rather look around first.

Point at a team in the sidebar and press **⋯** to:

- **Edit team:** change its emoji and name. It saves as you go. The short key (`ENG`) stays, so issue links keep working.
- **Leave team:** it leaves your sidebar; the team and its issues stay for everyone else. Join again with **+**.
- **Delete team** (admins and owners only): removes the team for everyone, with its issues, comments, archive and its
  own views. Projects stay, without that team. You'll be asked to type the team's name first, because this can't be
  undone.

## Filters

**Filter** (above every list) narrows it down: by status, assignee, subscribers, priority, labels, project or team.
A page leaves out the filter it already is: there's no Team filter on a team's own page (or a team's view), no
Assignee filter on My issues and no Project filter on a project's page.
**Subscribers** finds the issues someone follows: ones they made, are assigned to, commented on, were mentioned in or
subscribed to. Each filter shows as a chip. Click a chip to change it, or its **×** to remove it. Inside one filter,
any of the chosen values counts ("Todo or In Progress"); several filters must all match ("Todo, and assigned to Ana").

Filters you set on a team's page or on My issues are just for you, and go away when you leave the page. To keep
them, press **Save as view**.

## Views

A **view** is a saved set of filters with its own emoji, like "🐞 Open bugs" or "📊 Insights". Open **Views** in the
sidebar to see them, and **New view** to make one. A view shows issues from the whole workspace or from one team.

A view belongs to everyone. Changing its name, emoji, description, filters, grouping or List / Board saves straight
away, for everyone. In the list of views, click a view's emoji to change it, or use **⋯** to rename or delete it. On
the view's own page, click its name or description to change them. Deleting a view leaves its issues as they are.

## Projects

A **project** is a bigger goal made of several issues, like "New onboarding". **New project** on the Projects page
starts one. On its page you can change its emoji, name and description in place, and set its status, who leads it,
a target date and which teams work on it. The bar shows how many of its issues are done. In the list of projects,
click an emoji to change it, or use **⋯** to rename or delete a project.

Add issues to a project from the project's page, or pick the project on any issue. Deleting a project
(**⋯ › Delete project**) keeps its issues; they just no longer belong to a project.

## Labels

Labels like "Bug" or "Design" sort issues across teams. Make one right from an issue (type a new name in the
labels menu), or in **Settings › Labels**, where you can also rename, recolour and delete them. Changes apply to
every issue that has the label. Many labels come in pages of 10, with **Search labels** above them.

## Inbox

Your **Inbox** tells you when someone:

- assigns you an issue,
- mentions you with `@` in a description or a comment,
- comments on an issue you follow (see Subscribing above),
- changes the status of an issue you follow.

The number in the sidebar is how many you haven't read. Opening a note (or its issue) marks it read. Hover a note to
mark it read or delete it; **Mark all as read** and the `⋯` menu at the top work on all of them. Read notes clear
themselves after a month, and unread ones after three.

## Moving over from Linear

**Settings › Import from Linear** brings your teams, issues, comments, projects, labels and views over. Only admins and
owners can import. You'll need a Linear personal API key (the first step shows where to make one). Pick the teams,
check who's who, and press **Import**. Issue numbers stay the same (`ENG-123` is still `ENG-123`), and so do due
dates and estimates. Issues finished long ago go straight to the archive. Views keep the filters that fit, and the
import tells you which views lost some, so you can check them. If the import stops partway (say, the connection
dropped), what came over so far stays: press **Try again** to bring over the rest.

People who aren't in Sprawniej yet come over too, listed under **Settings › People from Linear**: their issues,
comments and views stay theirs. Owners and admins have two ways to hand them their work:

- **Invite**: makes an invite link just for that person (with their email from Linear, if known). When they join
  with it, they become that person: everything that was theirs in Linear is theirs.
- **Link**: for someone who already joined under another name. Pick who they are here, and everything moves to them.
  Linking can't be undone, so check the name first.

You can run the import again later to bring in new changes; nothing is copied twice, and people you linked stay
linked. Picking someone who has joined for a person from Linear on the import's **Who's who?** step links them too.

Searching anywhere (menus, @mentions, ⌘K, the archive) doesn't need Polish letters: "lukasz" finds Łukasz.

## Handy keys

- `⌘` `K` (or `Ctrl` `K`), or `/`: search issues and jump anywhere.
- `C`: new issue.
- `S`: change the status of the issue under the mouse (or the open one).
- `P`: change the priority.
- `A`: change who it's assigned to.
- `L`: change the labels.
- `E`: change the estimate.
- `J` / `K`, or `↓` / `↑`: move to the next or previous issue in a list or board.
- `X`: pick the issue (to change or move several at once).
- `Enter`: open it.
- `Space`: pick it up to move it with the arrows; `Space` again puts it down.
- `Esc`: let go of picked issues, or go back from an issue.

## On a phone

Sprawniej works in your phone's browser too. The menu button at the top left opens the sidebar. Press and hold an
issue to drag it.

## Pictures

Paste a picture (or drop one) into a description or a comment. It's kept with your workspace, so only your
teammates can see it. PNG, JPEG, GIF and WebP pictures can be added, up to 10 MB each. The same picture pasted
twice is kept once. A grey space shows where a picture goes until it has loaded.

## Something went wrong?

- **"This invite link doesn't work"**, **"This invite was already used"** or **"This invite has expired"**: each link
  works once, for 14 days. Ask whoever invited you for a new one. **"This invite link is from an older Sprawniej"**
  means the same: ask for a new link.
- **"You're no longer in this workspace"** or **"This workspace isn't here any more"**: someone removed you, or the
  workspace was deleted. If that's a mistake, ask an owner or an admin for a new invite.
- **"Not saved yet" for a long time**: check your internet connection and keep the tab open. Sprawniej keeps trying
  and says **Saved** once it's done.
- **"Please sign in again"** or **Signed out** in the top bar: you were signed out, maybe because it's been a while.
  Sign in, and you carry on where you were.
- **"We couldn't open this workspace"**: check your connection and press **Try again**.
- **"Sprawniej isn't set up yet"**: this copy of Sprawniej isn't ready. Tell whoever looks after Sprawniej.
- **Using a shared computer?** Open the menu under your name at the bottom left, choose **Sign out…**, and press
  **Sign out** on the page that opens. It signs you out in that browser (in every tab) and removes the copy of your
  workspaces it kept there.
