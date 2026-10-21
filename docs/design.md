# Design

Sprawniej looks like our internal tools (Punchcard): calm, neutral grey, with roomy controls, in a light and a dark
look (each person picks System, Light or Dark). Inside that frame the issue screens are dense and quick: compact rows,
clear status and priority icons, keyboard shortcuts for everything common.

## Colours

All colours are CSS variables in `src/index.css`, on shadcn's zinc scale: Light in `:root`, Dark in `.dark`. Use the
Tailwind names (`bg-background`, `text-muted-foreground`, `border`…), never raw hex values in components, and never
assume the page is dark (a `#18181b` that reads on dark vanishes on light). A colour that has to differ between the
two looks gets a token of its own. Each look also sets `color-scheme`, so the browser's own controls (checkboxes,
scrollbars, the date picker) are light in Light and dark in Dark.

| Use | Token | Light | Dark |
| --- | --- | --- | --- |
| Page background | `background` | `#fafafa` (soft off-white) | `#1c1c1f` |
| Menus, popups | `popover` | `#ffffff` (lifts above the page) | `#222226` |
| Sidebar | `sidebar` | `#f2f2f4` | `#161618` |
| Hover, selected item | `accent` | `#ededf0` | `#2a2a2e` |
| Lines and borders | `border` | `#e4e4e7` | `#2e2e33` |
| Text | `foreground` | `#18181b` | `#f4f4f5` |
| Quiet text (labels, dates, IDs) | `muted-foreground` | `#63636b` | `#a1a1aa` |
| Main button | `primary` | near-black with white text | white with dark text |
| Focus ring | `ring` | `#71717a` | `#8b8b93` |
| Behind pictures | `picture-backdrop` | `#ffffff` | `#e4e4e7` |

The light page colour is also in `src/lib/theme.ts` (`THEME_COLORS`) and index.html's `theme-color`; change all three
together (`tests/themeScript.test.ts` checks). `tests/contrast.test.ts` checks every text pair is 4.5:1 (Dark's red in
menus excepted) and every meaning colour and the focus ring 3:1 in both looks: when a colour fails, darken the colour,
don't change the page.

The installed app's splash screen is always the dark `#18181b` (the manifest in `vite.config.ts`). A manifest holds
one background colour, and the way to give Dark its own (`color_scheme_dark`) is still only a proposal no browser has
shipped; the browser bar follows the look through index.html's `theme-color` metas.

The focus ring is solid `ring`, 2 px (`focus-visible:ring-2 focus-visible:ring-ring`), never see-through: at half
strength it falls under 3:1 on the page. A field marked wrong shows it red
(`aria-invalid:ring-destructive`), and a red button keeps the grey one. Rows in a list (issues, archived
issues, workspaces) and board cards keep their look when focused and add the ring inside their edge (`ring-inset`),
2 px; a picked row has a 1 px one.
`tests/focusRing.test.ts` stops a see-through ring from coming back.

Pictures in descriptions and comments sit on `picture-backdrop`, near white in both looks, so a see-through logo or
diagram drawn in black still shows in Dark; a photo covers it. The price: a see-through picture drawn in white (a logo
made for dark pages) shows less in Dark. Black-on-clear diagrams are far more common in issues.

People without a picture get their initials in white on `oklch(54% 0.09 hue)` (`personColor` in `src/lib/person.ts`):
one lightness for every hue, so every colour reads at 4.5:1 (`tests/person.test.ts`).

Colour only means something. Status colours (`status-*`), the orange of Urgent, and label colours are the only
bright colours on screen. Everything else is grey. In Light, In Progress is a deeper gold and Urgent a deeper orange,
so they read on a light page; the check, cross and "!" inside the icons are `status-mark` and `urgent-mark`. Label
dots (`LabelDot` in `src/components/LabelChip.tsx`) get a thin edge in Light, so yellow, pink and white labels still
show. Code in descriptions uses the `code-*` colours. Due dates use `due-overdue` and `due-soon`; red words on a quiet
button (Delete) use `text-destructive-text`.

A status icon's **shape says its group** (its category, below), and its **colour is the status's own**: the workspace
picks it from the same calm set as labels (`STATUS_COLORS`: two greys and the label colours). The statuses a workspace
starts with have the colours below, and while a status keeps its group's starting colour it is painted with the
theme's `--status-*` for that group (pull request icons use them too), so a theme can shade them. Any other colour
is painted a little darker in Light (`--status-shade`, `paintColor` in `src/model/status.ts`), so pale ones (yellow,
pink, the light grey) still read on a light page; `tests/contrast.test.ts` checks every one at 3:1 in both looks. Two
statuses of one group look alike but for their colour and name; never invent a new shape for a status.

**Settings › Statuses** (`StatusesSettings`, one component for every kind of status) lists the groups in order, each
with a small grey heading and one line about what it decides, then its statuses as rows: a drag handle, the colour
button (the same popover as labels, `ColorPicker`), the name edited in place (a plain message under it while it is
blank or taken), **Default** on the first shown one when the group has more than one, how many issues have it,
**Hide** / **Show** (`aria-disabled`, with the reason in a tooltip, for the last shown status of a group), and a ⋯
menu with **Move up** / **Move down**. A hidden row is dimmed but for its buttons. **Add status** ends each group.
The page has two sections, Issue statuses and Project statuses; a project status's colour button shows its dot,
not an icon. What differs per kind (group names, counts, the Default tooltip) is in `KIND_TEXT`
(`src/features/settings/statusKinds.ts`). On screen it says "group", never
"category".

| Group | Icon |
| --- | --- |
| Backlog | grey dashed ring |
| Todo | light grey ring |
| In Progress | yellow ring, half filled |
| In Review | green ring, three quarters filled |
| Done | indigo disc with a check |
| Canceled, Duplicate | grey disc with a cross |

Icons are in `src/features/issues/icons.tsx`. Don't draw new versions elsewhere.

A project status is a **dot** in the status's own colour (`src/features/projects/StatusDot.tsx`,
painted like issue statuses: a status with its group's starting colour follows the theme). The six a workspace starts
with: Backlog, Paused and Canceled grey, Planned light grey, In progress yellow, Completed indigo.

## Type

Inter, 14 px for most text. Every size is a token in `src/index.css`, in the `@theme` block called "the type scale",
and each token is a Tailwind class (`--text-ui` is `text-ui`, its line height `--text-ui--line-height`). To make text
bigger or smaller, change the token there: every screen follows. Use a token, never a size of its own
(`text-[15px]`, `text-[length:…]`, `font-size: 13px`); `tests/typeScale.test.ts` stops one from coming in. Sizes in
`em` are fine, for something sized from the text around it (code in a line, a key in the Help page).

| Class | Size / line height | For |
| --- | --- | --- |
| `text-xs` | 11 / 16 px | badges, counts, chips, tooltips, keyboard hints |
| `text-label` | 12 / 16 px | small grey labels (*Workspace* in the sidebar), the @handle, code blocks |
| `text-ref` | 12.5 / 20 px | an issue's ID ("ENG-12") in a list row or on a board card, in quiet grey |
| `text-sm` | 13 / 18 px | buttons, menus, toasts, quiet text (dates, property names) |
| `text-row-title` | 13.5 / 20 px | an issue's title in a list row or on a board card |
| `text-ui` | 14 / 20 px | most text: the sidebar, breadcrumbs, lists, settings (and the page's own size) |
| `text-prose` | 14 px, 1.625 | descriptions, comments, the Help page (`.prose-sprawniej`) |
| `text-field` | 16 / 24 px on phones, 14 / 20 px from `md` | text you type into: names edited in place, search boxes, the editor |
| `text-heading` | 17 / 24 px | dialog titles, settings sections, releases in What's new, empty states |
| `text-title` | 18 / 26 px | "Sprawniej" in the sidebar and on sign-in, Settings' title, a new issue's title |
| `text-issue-title` | 20 / 28 px | an issue's title on its page |
| `text-page-title` | 22 / 30 px | a page's title (a view, a project, a settings page) |

Two groups follow their box, not the text, so they stay when the text gets smaller:

| Class | Size | For |
| --- | --- | --- |
| `text-initials-sm`, `text-initials`, `text-initials-md`, `text-initials-lg` | 7, 9, 10, 16 px | initials in an avatar of `size-4`, `size-5` (the usual), `size-7`, `size-12` |
| `text-emoji-sm`, `text-emoji`, `text-emoji-lg` | 16, 18, 20 px | emoji in sidebar rows, in team and project rows, in emoji buttons |

- `text-xs` and `text-sm` are Tailwind's own steps, set one step smaller here, so shadcn components follow without
  changes. Tailwind's bigger steps (`text-base`, `text-lg` and up) are not used, but for the one below. A size of our
  own also goes in `TEXT_SIZES` (`src/lib/utils.ts`), or `cn` takes it for a colour and drops the colour next to it;
  the test checks the two lists match.
- **Fields are 16 px on phones.** A phone zooms in when you pick a field whose text is smaller. Our own fields use
  `text-field` (an `@utility` under the scale: 16 px, then `text-ui` from `md`); the editor does the same under `md`,
  and reading views keep `text-prose`. shadcn's `Input` and `Textarea` already are 16 px on phones (`text-base`) and
  `text-sm` from `md`: to make one bigger, pass `md:text-ui`, never `text-ui`, which would make it small on phones too.
  A field inside a pill can add `md:text-sm` after `text-field` to match the pill from `md` up.
- Headings in descriptions and comments are sized in `em` from `text-prose` (1.4, 1.2 and 1.075 times), so they
  follow it, and the biggest stays below an issue's title. In the editor on a phone, where the text is 16 px, they
  are 1.225, 1.125 and 1.05 times, for the same reason. A code block is `text-label`.
- Toasts take `text-sm` (their buttons `text-label`) through `toastOptions` in `src/ui/sonner.tsx`.
- In a list the ID is quieter than the title: smaller and in `muted-foreground`.

## Spacing

- Radius 8 px (`rounded-lg`) for buttons, inputs, cards, groups.
- Controls are 40 px tall (`h-10`) in toolbars and 36 px in the sidebar. Issue rows are 44 px.
- Page padding 32 px (`px-8`), sidebar 280 px wide.

## Pieces

- **Sidebar**: logo and "Sprawniej" at the top; Inbox, My issues; small grey section labels in sentence case
  (*Workspace*, *Your teams*); your picture, name and @handle at the bottom with a menu. Your favourites sit inside
  *Workspace*, under Projects and Views after a small gap, with no label of their own: rows like the others (emoji and
  name, cut with an ellipsis, the full name on hover), with a ⋯ that shows on hover. With none, one quiet dashed hint
  in their place ("Star a project or view to keep it here."), like "You're not in a team yet".
- **Favourite star**: a grey outline star next to ⋯ on a project's or view's page and on its row in the lists; when
  on, filled with the text colour. Never yellow: the star is not a meaning colour. On list rows it shows on hover or
  focus (always on touch screens), and always when on.
- **Top bar**: sidebar toggle, a thin divider, breadcrumbs (`Sprawniej / 🛠️ Engineering / Issues`), the save chip,
  and the search box with `⌘K`; on lists and boards also the side panel's toggle at the right end (a square icon
  button, tooltip "Side panel ]").
- **Buttons**: outlined by default (like Punchcard's `Today`). One filled button per screen at most (white in Dark,
  near-black in Light), for the main action (like `+ Track time`). Icon buttons are square.
- **Switches between options** (List / Board): joined buttons where the chosen one has a light border and a
  raised background (`src/components/Segmented.tsx`), like Punchcard's Day / Week / Month. It is one Tab stop (the
  chosen button); ← →, Home and End move along and choose, as in a group of radio buttons. ↑ ↓ stay the issue
  list's.
- **Tabs that are pages** (Active / Backlog / All issues): separate outlined buttons (`src/components/Tabs.tsx`).
- **Issue row**: priority, ID, status, title (with `code` in backticks), sub-issue counter, labels, assignee, date.
- **Board card**: ID and assignee, then status and title, then priority, counter and labels. A project card: emoji,
  name and lead, then the target date and the progress bar. An empty column says "Drop a project here".
- **Filters**: each condition is a pill of joined segments (field, is / is not, values, ×), 32 px tall, like the
  chips. Several values show their icons and a count ("4 statuses"). Rows after the first start with a quiet "and" /
  "or" that switches its group (on a phone, on a short line of its own above the row, so pills keep the width); a
  nested group is a bordered block with a slightly raised background. With filters set, one chip under the toolbar
  reads them as a sentence (names in quiet grey, values in normal text). The builder is a popover on wide screens and a
  sheet from the bottom on phones. A date filter's pill is field, what it says (a quiet menu with a chevron: "in the
  last", "before", "is overdue"), then a narrow number box and a unit menu ("7" "days"), or a day that opens a
  calendar, then ×. A number saves once typing pauses (or the box is left); one that can't be saved (empty, 0, 1.5)
  gets the red ring, keeps the line as it was, and goes back to the saved number when the box is left.
- **Side panel** (`src/features/issues/SidePanel.tsx`): on team issues, views, projects and My issues, 20rem wide on
  the right of the list, with a border on its left and the page background. It sits beside the list from 1280 px
  with the sidebar open and from 1024 px without it; below that it is a sheet from the right (`w-80`, at most 85% of
  the screen) that opens only when asked for. A small grey "Side panel" and × at the top, then the page's details
  (`PageDetails.tsx`: name and emoji, then grey names and plain values in two columns, read only, team names as
  links), then quick filters (`QuickFilters.tsx`): a grey label, one quiet line ("Just for you…, Shows N issues"),
  the tabs as a compact Segmented, and rows 36 px tall: icon, name (cut with an ellipsis, the full name on hover) and
  the count on the right in quiet grey. A picked row has the `accent` background and a check, and comes first in its
  tab; a picked row at 0 is quiet grey. Rows are one Tab stop: ↑ ↓ Home End move, Space or Enter picks. Beside the list the panel never uses a
  dialog, menu or listbox role (they would turn off the app's keys).
- **Empty states**: an icon, a short title, one sentence in plain words about what goes here, and one button
  (`src/components/EmptyState.tsx`).

## Behaviour

- Everything saves by itself. Never add a Save button. The only "not saved yet" questions are about changes still on
  their way when you close the tab, sign out or switch workspace.
- Every control works with the keyboard and shows a focus ring.
- Hover shows a soft `accent` background; the selected item keeps it.
- Show the save state quietly in the top bar (Saved, Saving…, Offline, Not saved yet), with a tooltip that says what
  it means. Don't interrupt people with dialogs for normal saving; the only questions are about changes still on
  their way when you close the tab, sign out or switch workspace.
- Works on a phone: the sidebar becomes a sheet, boards scroll sideways.

## Do and don't

- Do reuse `src/ui` (shadcn) and `src/components` before making something new.
- Do write labels people understand without training ("No one" rather than "Unassigned user").
- Don't use colour for decoration.
- Don't show technical words to teammates (see CLAUDE.md, writing).
