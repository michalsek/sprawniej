# Changelog

Versions are `MAJOR.MINOR.PATCH`: major = the database changes in a way older versions can’t live with, or the way
you work changes; minor = a new feature; patch = fixes and polish. Written from `src/version.ts` by
`bun scripts/changelog.ts`.

## 2.14.0: Combine filters with and / or
*2026-10-21*

- Join filters with "and" or "or": click the word between two filters to switch it
- Put filters in groups, up to three levels deep, for example (In Progress or In Review) and (Me or Urgent)
- Any filter can say "is not", and Labels can say "don't include"
- Filter by Me, so one view shows each person their own issues
- Filter by the status of the issue's project
- One short sentence above the list says what's filtered. Tap it to change the filters, on a phone too

## 2.13.0: A contact email teammates can see
*2026-10-21*

- Add a few contact emails in Settings › Profile and pick the one teammates see, or none. How you sign in stays the same
- Teammates see it next to your name in Settings › Members, with a link to write to you and a button to copy it
- Add your sign-in email with one tap if you want teammates to see that one
- Sprawniej doesn't check these addresses or send anything to them, so make sure they're right

## 2.12.0: Projects on a board, with your own project statuses
*2026-10-21*

- Show projects as a board: pick List or Board at the top of Projects, on its own and on each team, and Sprawniej remembers your choice
- Drag a project to another column to change its status, or up and down to put it in order. Your teammates see it right away
- Drag with the keyboard too: Space to pick a project up, the arrow keys to move it, Space to put it down, Esc to stop
- Settings › Statuses now has project statuses: add, rename, recolour, reorder and hide them, like issue statuses
- A hidden status keeps its projects. Its column shows at the end of the board until you move them out
- Projects brought over from Linear take the status with the same name, or else its group's Default

## 2.11.0: Checklists you can tick, and a / menu
*2026-10-20*

- Tick checklist items right on the issue: click or tap the box, and it saves by itself (on a phone the keyboard stays away)
- When you and a teammate tick items at the same time, both ticks stay, even after being offline
- Type / in a description or a comment for a list of what you can add: a checklist, headings, lists, a quote, code, a table or a divider
- Tables in descriptions and comments: Tab moves to the next cell, and / adds or removes lines and columns
- Lists and boards show how far a checklist is, like 2/5
- Comments show checklists, tables and struck text, and the person who wrote a comment can tick its boxes
- Tables brought over from Linear stay when you edit the description

## 2.10.0: Favourites in your sidebar
*2026-10-20*

- Star a project or a view to keep it in your sidebar, under Projects and Views
- The star is at the top of a project’s or view’s page, next to its name in the lists, and in ⌘K
- Drag your favourites into the order you like, or use Space and the arrow keys, or ⋯ › Move up and Move down
- Your favourites are only yours, and they follow you to your other tabs and devices
- When a project or view is deleted, it leaves your favourites by itself

## 2.9.0: Your own statuses
*2026-10-20*

- Settings › Statuses: add, rename, recolour, reorder and hide your workspace’s statuses
- Each status sits in a group (Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate), so the tabs, filters and GitHub keep working the same
- Split a step in two, like Testing and Design review under In Progress, and see both on the board
- Hidden statuses aren’t offered any more, but issues that have them keep them
- Everyone in the workspace can change statuses, like labels

## 2.8.0: Send pages from Notion
*2026-10-20*

- A button or an automation in Notion can now send a page to Sprawniej, and it becomes an issue with a link back to the page
- Its description, status, priority, assignee, due date and labels come along when the page has them, and a Team property picks the team
- Sending the same page again keeps the one issue
- Admins connect it in Settings › Notion, pick the team pages go to, and can replace the address at any time
- The first activity line says the issue came from Notion, and the Inbox shows Notion when nobody in the workspace made it

## 2.7.1: Getting ready for your own statuses
*2026-10-20*

- Behind the scenes, each workspace now keeps its own list of statuses. Everything looks and works as before
- Soon you can add, rename, recolour, reorder and hide statuses in Settings

## 2.7.0: Light and dark
*2026-10-20*

- Sprawniej now comes in light too. It follows your device, or pick Light or Dark in Settings › Profile
- Your choice follows you to every device you sign in on, and your other tabs switch at once
- Press ⌘K and type light, dark or appearance to switch quickly
- Statuses, labels, due dates and code stay easy to read in both, and checkboxes and scrollbars match the look

## 2.6.0: Invite links for several people
*2026-10-20*

- Make an invite link for one person, for up to a number of people, or for anyone with the link
- Pick how long a link works: 1 week, 2 weeks, or a number of days up to 28
- See who joined with each link, and end a link early with End link now
- Someone who left or was removed comes back only with a link made after that

## 2.5.0: Change your @handle
*2026-10-20*

- Change the @handle teammates see and mention you by, in Settings › Profile. It saves by itself, also if you signed up with GitHub
- Mentions follow the handle people have now: typing @ suggests it, and your teammates see your new one at once
- After you change it, old mentions of your earlier handle read as plain text, and someone else may pick it

## 2.4.0: Settings has its own pages
*2026-10-20*

- Settings has its own menu in place of the sidebar: Your account (Profile, Ways to sign in) and Workspace (General, Members, Invite links, Teams, Labels, Archive, GitHub and more)
- Each page has its own address, so you can bookmark it or send a link to it. Old links to Settings still work
- A new Teams page lists every team: join one, make one, or edit, leave or delete one
- Back to Sprawniej at the top of the menu takes you back to where you were

## 2.3.0: Pull requests on the issue
*2026-10-20*

- An issue lists the pull requests that mention it, under its title: Open, Draft, Merged or Closed. Click one to open it on GitHub
- The list changes as soon as something happens on GitHub, also for drafts and pull requests closed without merging
- Taking the issue’s number out of a pull request takes it off the list

## 2.2.0: Pull requests move issues
*2026-10-20*

- Mention an issue like ENG-12 in a pull request’s branch name, title or description: it moves to In Review when the pull request opens or is ready for review, and to Done when it’s merged
- The issue’s history says who moved it and links to the pull request, and everyone following the issue gets a note
- Admins and owners connect repositories in Settings › GitHub, and see what the latest pull request did
- It works for your pull requests once GitHub is one of your ways to sign in (Settings › Your account)

## 2.1.0: Sign-up codes
*2026-10-20*

- Creating an account needs a sign-up code or an invite link. Ask whoever looks after Sprawniej for a code
- With an invite link you don’t need a code: the link lets you in
- Signing up with GitHub asks for the code on the next screen, where you pick your name

## 2.0.0: A new home for your work
*2026-10-19*

- Sign in with your email and a password, or with GitHub where it’s switched on. No more GitHub key to make and paste
- Join with an invite link: open it, create your account, pick your name and @handle, and you’re in. Each link works once, for 14 days
- Admins and owners invite people from Settings, as members or admins, and see the links nobody has used yet
- Settings shows everyone in the workspace with their role. Admins and owners change roles and remove people; only they delete teams and import from Linear
- Your teammates’ changes show up the moment they’re saved
- New issues get their number as they’re saved, so two people never get the same one
- Sprawniej needs the internet to save. If your connection drops, keep the tab open: your changes are saved as soon as you’re back
- Opening Sprawniej is quicker: this browser keeps a copy of your workspace and only fetches what changed. Signing out removes it
- Add GitHub or a password to your account in Settings › Your account
- People from Linear who haven’t joined can get their own invite link: when they join, their issues, comments and views are theirs
- Workspaces from the earlier Sprawniej don’t come along. Your workspace’s owner brings the work over from Linear

## 1.8.5: What’s new
*2026-10-15*

- See what changed in each version: What’s new in the menu under your name, or type “what’s new” in ⌘K

## 1.8.4: Search without Polish letters
*2026-10-15*

- Every search finds Polish names and titles without typing ą, ę, ł or ż: “lukasz” finds Łukasz, “zazolc” finds “Zażółć”. This covers the assignee and label menus, @mentions, ⌘K and the archive

## 1.8.3: Pages for long lists
*2026-10-15*

- People and labels in Settings come in pages of 10, with Previous and Next
- Search labels finds a label by name, and a label you add shows on its page
- Renaming a label keeps it in place while you type, even if its new name sorts elsewhere

## 1.8.2: Shorter people lists
*2026-10-15*

- Settings › People shows the first few people of each list, with Show all for the rest
- Search people finds anyone by name or username, even with a typo or without Polish letters

## 1.8.1: Your name, your way
*2026-10-15*

- Change the name teammates see in Settings › Your account. Your GitHub profile stays as it is, and Use your GitHub name puts it back
- People linked from Linear keep their name when they join, if their GitHub profile has none

## 1.8.0: Link people from Linear
*2026-10-15*

- Right after you invite someone, Sprawniej asks whether they’re one of the people from Linear who haven’t joined. Link them, and their issues, comments and views become theirs at once
- Settings › People lists everyone from Linear who isn’t linked yet, with Link to GitHub account next to each (for admins)
- People you link stay linked when you import from Linear again, even if their names differ

## 1.7.0: Update when it suits you
*2026-10-15*

- When a new version of Sprawniej is out, a small note says so, and Update available appears next to Saved
- Press it when it suits you: anything not saved yet is saved first, then the page reloads. Or carry on, and the new version loads next time you open Sprawniej

## 1.6.0: Safer teamwork
*2026-10-15*

- A teammate’s change to a title or description is no longer undone when you leave the page, and their edits join the text you’re typing
- Saving keeps going after a bad connection or a slow answer from GitHub, and teammates’ changes keep arriving
- Two issues made at the same moment no longer move your other new issues to different numbers, and an open issue follows its new number
- An issue that moved to another team still opens from links to its old number
- When one person edits an issue another deletes, its comments come back with it
- Every Sign out checks for unsaved changes first, in all your workspaces
- Restoring an issue brings back the sub-issues archived with it
- Search finds an archived issue by its exact number first
- New issues made on the Backlog tab start in Backlog, and a new issue you closed by accident comes back next time
- Text written in Markdown is formatted when you paste it
- The Linear import also brings issues Linear has archived, keeps numbers unique on later imports, and adds new comments to archived issues
- Saving a view from the Active or Backlog tab keeps showing the same issues
- On phones, delete and ⋯ buttons are always visible
- If part of the app fails to load, you get a Reload button instead of a blank page
- Smaller fixes: duplicate label names, the tour covering the new issue dialog, initials for names with emoji, and some wording

## 1.5.0: Join links made for one person
*2026-10-09*

- After you invite someone in Settings, you get a join link made just for them, so nobody gets a link without an invitation
- The link stays next to their name until they join, in case you need to send it again
- If someone opens their link while signed in to a different GitHub account, Sprawniej tells them and helps them switch

## 1.4.1: Longer issue numbers fit
*2026-10-08*

- Issue numbers like WEB-123 stay on one line in lists, search and the archive

## 1.4.0: Pick your teams, and change them
*2026-10-07*

- When you’re in no team yet, Sprawniej asks which teams you work with (or skip it and look around first)
- Point at a team in the sidebar and press ⋯ to change its emoji and name, leave it, or delete it
- Deleting a team says what goes with it and asks you to type the team’s name first

## 1.3.1: Emptied workspaces open again
*2026-10-07*

- A workspace whose files were all removed now offers to set it up again, instead of saying you have no access to it

## 1.3.0: A Subscribers filter, and everyone comes over from Linear
*2026-10-07*

- Filter by Subscribers to see the issues someone follows: ones they made, are assigned to, commented on, were mentioned in or subscribed to
- Importing from Linear brings people who aren’t here yet, marked “hasn’t joined”: their issues, comments and views stay theirs, and move to their account once they join and you import again
- Every Linear view about a person comes over now, including ones that use subscribers, and who’s subscribed to each issue comes too

## 1.2.1: Views from Linear keep their filters
*2026-10-07*

- Views imported from Linear now keep their label and assignee filters, including “this label or anything under it”; import again to fix views that came over showing every issue
- A Linear view none of whose filters fit here (like one about subscribers) stays in Linear instead of showing every issue, and the import says which ones
- Labels a Linear view needs come over too, even when no issue uses them yet

## 1.2.0: Views come over from Linear
*2026-10-07*

- Importing from Linear now brings your custom views too, with the filters that fit; the import names any view that lost some filters, so you can check it
- Change a view’s or a project’s emoji right in its list, and rename or delete it from the ⋯ menu
- Names and descriptions you can edit now light up when you point at them

## 1.1.0: Due dates, history, subscriptions and the archive
*2026-10-07*

- Give issues a due date and an estimate; lists show them, late ones in red, and you can order by due date
- Every issue shows its history between the comments: who changed what, and when
- Subscribe to any issue with the bell to hear about its comments and status changes, or unsubscribe from your own
- On a board, empty columns and statuses the tab leaves out (like Done) wait under Hidden columns; drop a card there and the column appears
- Finished issues move to the archive after six months (or when you choose), so lists stay short and the app stays quick; find them under Archived or in search, and restore them any time
- Press E to set the estimate of the issue under the mouse
- The Linear import brings due dates and estimates, and puts issues finished long ago straight into the archive
- A new device downloads your workspace faster

## 1.0.0: Sprawniej 1.0
*2026-10-07*

- Issue numbers are never given out twice, so an old link always opens the same issue
- Big workspaces open faster
- When you and a teammate rewrite the same words, the last save simply wins, with no notes to read
- Clearer messages when something goes wrong, and a button on every empty page

## 0.9.0: Phones, several issues at once, and a welcome tour
*2026-10-07*

- Works on phones: the sidebar opens from the menu button, and you press and hold an issue to drag it
- Pick several issues with ⌘-click, Shift-click or X, then drag them together or change them all at once
- A short tour shows newcomers around; replay it from Help
- The Display menu closes when you pick up an issue
- Fixed: some issues with sub-issues showed an empty page

## 0.8.0: Search, shortcuts and pictures
*2026-10-07*

- Press ⌘ K (or the search box) to find any issue by ID or title and jump to any page
- S, P, A and L change status, priority, assignee and labels of the issue under the mouse
- J and K move between issues; Esc goes back from an issue
- Paste or drop pictures into descriptions and comments

## 0.7.0: Import from Linear
*2026-10-07*

- Settings › Import from Linear brings teams, issues, comments, projects and labels over
- Issue numbers stay the same, and people are matched by name (you can fix any match)
- Run it again later to bring in new changes without making copies

## 0.6.0: Comments, sub-issues and your inbox
*2026-10-07*

- Comment on issues, with @ mentions; edit or delete your own comments
- A comment you haven’t sent yet waits for you if you leave the page
- Add sub-issues right from an issue: type a title, press Enter, type the next one
- Your inbox tells you when you’re assigned, mentioned, or someone comments on your issues
- Mark notes as read one by one or all at once, and delete the ones you’re done with
- Old inbox notes clear themselves, so your workspace stays quick

## 0.5.0: Tidier boards
*2026-10-07*

- Boards show only columns with issues; empty ones wait under Hidden columns, and you can drop a card on them

## 0.4.0: Views, projects and labels
*2026-10-07*

- Filter any list by status, assignee, priority, labels, project or team
- Save filters as a view with its own emoji, for the whole workspace or one team
- Rename views, change their emoji and filters in place; changes save for everyone
- Create projects with a status, lead, target date and teams, and see how much is done
- Manage labels in Settings: rename, recolour, delete
- Fixed: ⌘ Enter in the new issue dialog sometimes created the issue twice

## 0.3.0: Drag and drop
*2026-10-07*

- Drag issues to arrange them, in a list or on a board
- Drop an issue into another column or group to change its status, priority, assignee or project
- No mouse needed: Space picks an issue up, arrows move it, Space drops it
- New Display menu: group and sort issues your way, hide finished issues or sub-issues

## 0.2.1: Faster, and calmer with many tabs
*2026-10-07*

- Sprawniej opens faster: the editor loads in the background
- Several tabs with the same workspace work together and save once
- Very busy hours save in small batches instead of hitting GitHub’s limits
- Typing an issue title saves once you pause, not on every key
- Long issue lists with sub-issues scroll more smoothly

## 0.2.0: Create and edit issues
*2026-10-07*

- Press C anywhere to create an issue; only a title is needed
- Descriptions format as you type: bold, lists, checklists, code, links
- Type @ to mention someone, and an issue ID like ENG-7 to point at it
- Change status, priority, assignee, labels, project and parent from the issue page
- Create labels on the spot, move issues to another team, delete issues
- Working at the same time as teammates never asks you to pick a version

## 0.1.1: Workspaces are easy to spot
*2026-10-06*

- New workspaces are stored on GitHub, named workspace-sprawniej-…
- Those workspaces come first when you choose one

## 0.1.0: Sign in and everything saves by itself
*2026-10-06*

- Sign in with your GitHub account, then open or create a workspace
- Invite people by their GitHub username and send them a join link that walks them through getting in
- Everything you change is saved on its own, and your teammates’ changes show up within half a minute
- Works offline: your changes wait on your device and go out when you’re back
- When two people change the same issue at once, both changes are kept wherever they don’t overlap
- Create teams and join the ones you work with

## 0.0.0: A first look
*2026-10-06*

- A sample workspace to click through: teams, issues in a list or on a board, views, projects and the inbox
