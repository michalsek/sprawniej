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

## Type and spacing

- Inter, 15 px for most text, 13 to 14 px for quiet text. Page titles 24 px semibold.
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
  and the search box with `⌘K`.
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
  calendar, then ×. A number box that can't be saved yet (empty, 0, 1.5) gets the red ring.
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
