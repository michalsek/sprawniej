# Design

Sprawniej looks like our internal tools (Punchcard): calm, neutral grey, with roomy controls, in a light and a dark
look (each person picks System, Light or Dark). Inside that
frame the issue screens are dense and quick: compact rows, clear status and priority icons, keyboard shortcuts for
everything common.

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

The light page colour is also in `src/lib/theme.ts` (`THEME_COLORS`) and index.html's `theme-color`; change all three
together (`tests/themeScript.test.ts` checks). `tests/contrast.test.ts` checks every text pair is 4.5:1 and every
meaning colour 3:1 in both looks: when a colour fails, darken the colour, don't change the page.

Colour only means something. Status colours (`status-*`), the orange of Urgent, and label colours are the only
bright colours on screen. Everything else is grey. In Light, In Progress is a deeper gold and Urgent a deeper orange,
so they read on a light page; the check, cross and "!" inside the icons are `status-mark` and `urgent-mark`. Label
dots (`LabelDot` in `src/components/LabelChip.tsx`) get a thin edge in Light, so yellow, pink and white labels still
show. Code in descriptions uses the `code-*` colours.

| Status | Icon |
| --- | --- |
| Backlog | grey dashed ring |
| Todo | light grey ring |
| In Progress | yellow ring, half filled |
| In Review | green ring, three quarters filled |
| Done | indigo disc with a check |
| Canceled, Duplicate | grey disc with a cross |

Icons are in `src/features/issues/icons.tsx`. Don't draw new versions elsewhere.

## Type and spacing

- Inter, 15 px for most text, 13 to 14 px for quiet text. Page titles 24 px semibold.
- Radius 8 px (`rounded-lg`) for buttons, inputs, cards, groups.
- Controls are 40 px tall (`h-10`) in toolbars and 36 px in the sidebar. Issue rows are 44 px.
- Page padding 32 px (`px-8`), sidebar 280 px wide.

## Pieces

- **Sidebar**: logo and "Sprawniej" at the top; Inbox, My issues; small grey section labels in sentence case
  (*Workspace*, *Your teams*); your picture, name and @handle at the bottom with a menu.
- **Top bar**: sidebar toggle, a thin divider, breadcrumbs (`Sprawniej / 🛠️ Engineering / Issues`), the save chip,
  and the search box with `⌘K`.
- **Buttons**: outlined by default (like Punchcard's `Today`). One filled button per screen at most (white in Dark,
  near-black in Light), for the main action (like `+ Track time`). Icon buttons are square.
- **Switches between options** (List / Board): joined buttons where the chosen one has a light border and a
  raised background (`src/components/Segmented.tsx`), like Punchcard's Day / Week / Month.
- **Tabs that are pages** (Active / Backlog / All issues): separate outlined buttons (`src/components/Tabs.tsx`).
- **Issue row**: priority, ID, status, title (with `code` in backticks), sub-issue counter, labels, assignee, date.
- **Board card**: ID and assignee, then status and title, then priority, counter and labels.
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
