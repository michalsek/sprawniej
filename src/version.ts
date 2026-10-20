/**
 * The app's version and its changelog: one list, which `scripts/changelog.ts` turns into CHANGELOG.md.
 * Newest release first. The app shows it on the What's new page (#/whats-new).
 *
 * Numbering (see CLAUDE.md): MAJOR.MINOR.PATCH. Major = the database changes in a way older versions can't live with, or the way you work changes,
 * minor = a new feature, patch = fixes and polish. Notes are written for the people using Sprawniej.
 */
export const APP_VERSION = '2.10.0'

export interface Release {
  version: string
  /** YYYY-MM-DD */
  date: string
  /** what this release is about, one short line */
  title: string
  /** what changed, in the user's words */
  notes: string[]
}

export const CHANGELOG: Release[] = [
  {
    version: '2.10.0',
    date: '2026-10-20',
    title: 'Favourites in your sidebar',
    notes: [
      'Star a project or a view to keep it in your sidebar, under Projects and Views',
      'The star is at the top of a project’s or view’s page, next to its name in the lists, and in ⌘K',
      'Drag your favourites into the order you like, or use Space and the arrow keys, or ⋯ › Move up and Move down',
      'Your favourites are only yours, and they follow you to your other tabs and devices',
      'When a project or view is deleted, it leaves your favourites by itself',
    ],
  },
  {
    version: '2.9.0',
    date: '2026-10-20',
    title: 'Your own statuses',
    notes: [
      'Settings › Statuses: add, rename, recolour, reorder and hide your workspace’s statuses',
      'Each status sits in a group (Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate), so the tabs, filters and GitHub keep working the same',
      'Split a step in two, like Testing and Design review under In Progress, and see both on the board',
      'Hidden statuses aren’t offered any more, but issues that have them keep them',
      'Everyone in the workspace can change statuses, like labels',
    ],
  },
  {
    version: '2.8.0',
    date: '2026-10-20',
    title: 'Send pages from Notion',
    notes: [
      'A button or an automation in Notion can now send a page to Sprawniej, and it becomes an issue with a link back to the page',
      'Its description, status, priority, assignee, due date and labels come along when the page has them, and a Team property picks the team',
      'Sending the same page again keeps the one issue',
      'Admins connect it in Settings › Notion, pick the team pages go to, and can replace the address at any time',
      'The first activity line says the issue came from Notion, and the Inbox shows Notion when nobody in the workspace made it',
    ],
  },
  {
    version: '2.7.1',
    date: '2026-10-20',
    title: 'Getting ready for your own statuses',
    notes: [
      'Behind the scenes, each workspace now keeps its own list of statuses. Everything looks and works as before',
      'Soon you can add, rename, recolour, reorder and hide statuses in Settings',
    ],
  },
  {
    version: '2.7.0',
    date: '2026-10-20',
    title: 'Light and dark',
    notes: [
      'Sprawniej now comes in light too. It follows your device, or pick Light or Dark in Settings › Profile',
      'Your choice follows you to every device you sign in on, and your other tabs switch at once',
      'Press ⌘K and type light, dark or appearance to switch quickly',
      'Statuses, labels, due dates and code stay easy to read in both, and checkboxes and scrollbars match the look',
    ],
  },
  {
    version: '2.6.0',
    date: '2026-10-20',
    title: 'Invite links for several people',
    notes: [
      'Make an invite link for one person, for up to a number of people, or for anyone with the link',
      'Pick how long a link works: 1 week, 2 weeks, or a number of days up to 28',
      'See who joined with each link, and end a link early with End link now',
      'Someone who left or was removed comes back only with a link made after that',
    ],
  },
  {
    version: '2.5.0',
    date: '2026-10-20',
    title: 'Change your @handle',
    notes: [
      'Change the @handle teammates see and mention you by, in Settings › Profile. It saves by itself, also if you signed up with GitHub',
      'Mentions follow the handle people have now: typing @ suggests it, and your teammates see your new one at once',
      'After you change it, old mentions of your earlier handle read as plain text, and someone else may pick it',
    ],
  },
  {
    version: '2.4.0',
    date: '2026-10-20',
    title: 'Settings has its own pages',
    notes: [
      'Settings has its own menu in place of the sidebar: Your account (Profile, Ways to sign in) and Workspace (General, Members, Invite links, Teams, Labels, Archive, GitHub and more)',
      'Each page has its own address, so you can bookmark it or send a link to it. Old links to Settings still work',
      'A new Teams page lists every team: join one, make one, or edit, leave or delete one',
      'Back to Sprawniej at the top of the menu takes you back to where you were',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-10-20',
    title: 'Pull requests on the issue',
    notes: [
      'An issue lists the pull requests that mention it, under its title: Open, Draft, Merged or Closed. Click one to open it on GitHub',
      'The list changes as soon as something happens on GitHub, also for drafts and pull requests closed without merging',
      'Taking the issue’s number out of a pull request takes it off the list',
    ],
  },
  {
    version: '2.2.0',
    date: '2026-10-20',
    title: 'Pull requests move issues',
    notes: [
      'Mention an issue like ENG-12 in a pull request’s branch name, title or description: it moves to In Review when the pull request opens or is ready for review, and to Done when it’s merged',
      'The issue’s history says who moved it and links to the pull request, and everyone following the issue gets a note',
      'Admins and owners connect repositories in Settings › GitHub, and see what the latest pull request did',
      'It works for your pull requests once GitHub is one of your ways to sign in (Settings › Your account)',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-10-20',
    title: 'Sign-up codes',
    notes: [
      'Creating an account needs a sign-up code or an invite link. Ask whoever looks after Sprawniej for a code',
      'With an invite link you don’t need a code: the link lets you in',
      'Signing up with GitHub asks for the code on the next screen, where you pick your name',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-10-19',
    title: 'A new home for your work',
    notes: [
      'Sign in with your email and a password, or with GitHub where it’s switched on. No more GitHub key to make and paste',
      'Join with an invite link: open it, create your account, pick your name and @handle, and you’re in. Each link works once, for 14 days',
      'Admins and owners invite people from Settings, as members or admins, and see the links nobody has used yet',
      'Settings shows everyone in the workspace with their role. Admins and owners change roles and remove people; only they delete teams and import from Linear',
      'Your teammates’ changes show up the moment they’re saved',
      'New issues get their number as they’re saved, so two people never get the same one',
      'Sprawniej needs the internet to save. If your connection drops, keep the tab open: your changes are saved as soon as you’re back',
      'Opening Sprawniej is quicker: this browser keeps a copy of your workspace and only fetches what changed. Signing out removes it',
      'Add GitHub or a password to your account in Settings › Your account',
      'People from Linear who haven’t joined can get their own invite link: when they join, their issues, comments and views are theirs',
      'Workspaces from the earlier Sprawniej don’t come along. Your workspace’s owner brings the work over from Linear',
    ],
  },
  {
    version: '1.8.5',
    date: '2026-10-15',
    title: 'What’s new',
    notes: ['See what changed in each version: What’s new in the menu under your name, or type “what’s new” in ⌘K'],
  },
  {
    version: '1.8.4',
    date: '2026-10-15',
    title: 'Search without Polish letters',
    notes: [
      'Every search finds Polish names and titles without typing ą, ę, ł or ż: “lukasz” finds Łukasz, “zazolc” finds “Zażółć”. This covers the assignee and label menus, @mentions, ⌘K and the archive',
    ],
  },
  {
    version: '1.8.3',
    date: '2026-10-15',
    title: 'Pages for long lists',
    notes: [
      'People and labels in Settings come in pages of 10, with Previous and Next',
      'Search labels finds a label by name, and a label you add shows on its page',
      'Renaming a label keeps it in place while you type, even if its new name sorts elsewhere',
    ],
  },
  {
    version: '1.8.2',
    date: '2026-10-15',
    title: 'Shorter people lists',
    notes: [
      'Settings › People shows the first few people of each list, with Show all for the rest',
      'Search people finds anyone by name or username, even with a typo or without Polish letters',
    ],
  },
  {
    version: '1.8.1',
    date: '2026-10-15',
    title: 'Your name, your way',
    notes: [
      'Change the name teammates see in Settings › Your account. Your GitHub profile stays as it is, and Use your GitHub name puts it back',
      'People linked from Linear keep their name when they join, if their GitHub profile has none',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-10-15',
    title: 'Link people from Linear',
    notes: [
      'Right after you invite someone, Sprawniej asks whether they’re one of the people from Linear who haven’t joined. Link them, and their issues, comments and views become theirs at once',
      'Settings › People lists everyone from Linear who isn’t linked yet, with Link to GitHub account next to each (for admins)',
      'People you link stay linked when you import from Linear again, even if their names differ',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-10-15',
    title: 'Update when it suits you',
    notes: [
      'When a new version of Sprawniej is out, a small note says so, and Update available appears next to Saved',
      'Press it when it suits you: anything not saved yet is saved first, then the page reloads. Or carry on, and the new version loads next time you open Sprawniej',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-10-15',
    title: 'Safer teamwork',
    notes: [
      'A teammate’s change to a title or description is no longer undone when you leave the page, and their edits join the text you’re typing',
      'Saving keeps going after a bad connection or a slow answer from GitHub, and teammates’ changes keep arriving',
      'Two issues made at the same moment no longer move your other new issues to different numbers, and an open issue follows its new number',
      'An issue that moved to another team still opens from links to its old number',
      'When one person edits an issue another deletes, its comments come back with it',
      'Every Sign out checks for unsaved changes first, in all your workspaces',
      'Restoring an issue brings back the sub-issues archived with it',
      'Search finds an archived issue by its exact number first',
      'New issues made on the Backlog tab start in Backlog, and a new issue you closed by accident comes back next time',
      'Text written in Markdown is formatted when you paste it',
      'The Linear import also brings issues Linear has archived, keeps numbers unique on later imports, and adds new comments to archived issues',
      'Saving a view from the Active or Backlog tab keeps showing the same issues',
      'On phones, delete and ⋯ buttons are always visible',
      'If part of the app fails to load, you get a Reload button instead of a blank page',
      'Smaller fixes: duplicate label names, the tour covering the new issue dialog, initials for names with emoji, and some wording',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-10-09',
    title: 'Join links made for one person',
    notes: [
      'After you invite someone in Settings, you get a join link made just for them, so nobody gets a link without an invitation',
      'The link stays next to their name until they join, in case you need to send it again',
      'If someone opens their link while signed in to a different GitHub account, Sprawniej tells them and helps them switch',
    ],
  },
  {
    version: '1.4.1',
    date: '2026-10-08',
    title: 'Longer issue numbers fit',
    notes: ['Issue numbers like WEB-123 stay on one line in lists, search and the archive'],
  },
  {
    version: '1.4.0',
    date: '2026-10-07',
    title: 'Pick your teams, and change them',
    notes: [
      'When you’re in no team yet, Sprawniej asks which teams you work with (or skip it and look around first)',
      'Point at a team in the sidebar and press ⋯ to change its emoji and name, leave it, or delete it',
      'Deleting a team says what goes with it and asks you to type the team’s name first',
    ],
  },
  {
    version: '1.3.1',
    date: '2026-10-07',
    title: 'Emptied workspaces open again',
    notes: ['A workspace whose files were all removed now offers to set it up again, instead of saying you have no access to it'],
  },
  {
    version: '1.3.0',
    date: '2026-10-07',
    title: 'A Subscribers filter, and everyone comes over from Linear',
    notes: [
      'Filter by Subscribers to see the issues someone follows: ones they made, are assigned to, commented on, were mentioned in or subscribed to',
      'Importing from Linear brings people who aren’t here yet, marked “hasn’t joined”: their issues, comments and views stay theirs, and move to their account once they join and you import again',
      'Every Linear view about a person comes over now, including ones that use subscribers, and who’s subscribed to each issue comes too',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-10-07',
    title: 'Views from Linear keep their filters',
    notes: [
      'Views imported from Linear now keep their label and assignee filters, including “this label or anything under it”; import again to fix views that came over showing every issue',
      'A Linear view none of whose filters fit here (like one about subscribers) stays in Linear instead of showing every issue, and the import says which ones',
      'Labels a Linear view needs come over too, even when no issue uses them yet',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-07',
    title: 'Views come over from Linear',
    notes: [
      'Importing from Linear now brings your custom views too, with the filters that fit; the import names any view that lost some filters, so you can check it',
      'Change a view’s or a project’s emoji right in its list, and rename or delete it from the ⋯ menu',
      'Names and descriptions you can edit now light up when you point at them',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-07',
    title: 'Due dates, history, subscriptions and the archive',
    notes: [
      'Give issues a due date and an estimate; lists show them, late ones in red, and you can order by due date',
      'Every issue shows its history between the comments: who changed what, and when',
      'Subscribe to any issue with the bell to hear about its comments and status changes, or unsubscribe from your own',
      'On a board, empty columns and statuses the tab leaves out (like Done) wait under Hidden columns; drop a card there and the column appears',
      'Finished issues move to the archive after six months (or when you choose), so lists stay short and the app stays quick; find them under Archived or in search, and restore them any time',
      'Press E to set the estimate of the issue under the mouse',
      'The Linear import brings due dates and estimates, and puts issues finished long ago straight into the archive',
      'A new device downloads your workspace faster',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-07',
    title: 'Sprawniej 1.0',
    notes: [
      'Issue numbers are never given out twice, so an old link always opens the same issue',
      'Big workspaces open faster',
      'When you and a teammate rewrite the same words, the last save simply wins, with no notes to read',
      'Clearer messages when something goes wrong, and a button on every empty page',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-10-07',
    title: 'Phones, several issues at once, and a welcome tour',
    notes: [
      'Works on phones: the sidebar opens from the menu button, and you press and hold an issue to drag it',
      'Pick several issues with ⌘-click, Shift-click or X, then drag them together or change them all at once',
      'A short tour shows newcomers around; replay it from Help',
      'The Display menu closes when you pick up an issue',
      'Fixed: some issues with sub-issues showed an empty page',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-10-07',
    title: 'Search, shortcuts and pictures',
    notes: [
      'Press ⌘ K (or the search box) to find any issue by ID or title and jump to any page',
      'S, P, A and L change status, priority, assignee and labels of the issue under the mouse',
      'J and K move between issues; Esc goes back from an issue',
      'Paste or drop pictures into descriptions and comments',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-10-07',
    title: 'Import from Linear',
    notes: [
      'Settings › Import from Linear brings teams, issues, comments, projects and labels over',
      'Issue numbers stay the same, and people are matched by name (you can fix any match)',
      'Run it again later to bring in new changes without making copies',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-07',
    title: 'Comments, sub-issues and your inbox',
    notes: [
      'Comment on issues, with @ mentions; edit or delete your own comments',
      'A comment you haven’t sent yet waits for you if you leave the page',
      'Add sub-issues right from an issue: type a title, press Enter, type the next one',
      'Your inbox tells you when you’re assigned, mentioned, or someone comments on your issues',
      'Mark notes as read one by one or all at once, and delete the ones you’re done with',
      'Old inbox notes clear themselves, so your workspace stays quick',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-10-07',
    title: 'Tidier boards',
    notes: ['Boards show only columns with issues; empty ones wait under Hidden columns, and you can drop a card on them'],
  },
  {
    version: '0.4.0',
    date: '2026-10-07',
    title: 'Views, projects and labels',
    notes: [
      'Filter any list by status, assignee, priority, labels, project or team',
      'Save filters as a view with its own emoji, for the whole workspace or one team',
      'Rename views, change their emoji and filters in place; changes save for everyone',
      'Create projects with a status, lead, target date and teams, and see how much is done',
      'Manage labels in Settings: rename, recolour, delete',
      'Fixed: ⌘ Enter in the new issue dialog sometimes created the issue twice',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-07',
    title: 'Drag and drop',
    notes: [
      'Drag issues to arrange them, in a list or on a board',
      'Drop an issue into another column or group to change its status, priority, assignee or project',
      'No mouse needed: Space picks an issue up, arrows move it, Space drops it',
      'New Display menu: group and sort issues your way, hide finished issues or sub-issues',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-10-07',
    title: 'Faster, and calmer with many tabs',
    notes: [
      'Sprawniej opens faster: the editor loads in the background',
      'Several tabs with the same workspace work together and save once',
      'Very busy hours save in small batches instead of hitting GitHub’s limits',
      'Typing an issue title saves once you pause, not on every key',
      'Long issue lists with sub-issues scroll more smoothly',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-07',
    title: 'Create and edit issues',
    notes: [
      'Press C anywhere to create an issue; only a title is needed',
      'Descriptions format as you type: bold, lists, checklists, code, links',
      'Type @ to mention someone, and an issue ID like ENG-7 to point at it',
      'Change status, priority, assignee, labels, project and parent from the issue page',
      'Create labels on the spot, move issues to another team, delete issues',
      'Working at the same time as teammates never asks you to pick a version',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-10-06',
    title: 'Workspaces are easy to spot',
    notes: [
      'New workspaces are stored on GitHub, named workspace-sprawniej-…',
      'Those workspaces come first when you choose one',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-06',
    title: 'Sign in and everything saves by itself',
    notes: [
      'Sign in with your GitHub account, then open or create a workspace',
      'Invite people by their GitHub username and send them a join link that walks them through getting in',
      'Everything you change is saved on its own, and your teammates’ changes show up within half a minute',
      'Works offline: your changes wait on your device and go out when you’re back',
      'When two people change the same issue at once, both changes are kept wherever they don’t overlap',
      'Create teams and join the ones you work with',
    ],
  },
  {
    version: '0.0.0',
    date: '2026-10-06',
    title: 'A first look',
    notes: ['A sample workspace to click through: teams, issues in a list or on a board, views, projects and the inbox'],
  },
]
