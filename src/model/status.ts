/**
 * Issue categories and priorities, fixed on purpose: one shared vocabulary for every team, and the import maps onto
 * the categories one to one. Each issue has a category (`issue.status`) and one of the workspace's own statuses
 * (`issue.statusId`, src/data/statuses.ts): people add, rename, recolour, reorder and hide statuses within a
 * category, but whatever decides something (the tabs, finished, the nightly archive, GitHub) looks at the category.
 * Each category belongs to a group; the groups decide which issues the Active, Backlog and All tabs show.
 */

export type StatusGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export const ISSUE_CATEGORIES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate'] as const
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]
export const isIssueCategory = (x: unknown): x is IssueCategory => ISSUE_CATEGORIES.some((c) => c === x)

/** what a status can be for: issues, or (later) projects */
export const STATUS_KINDS = ['issue', 'project'] as const
export type StatusKind = (typeof STATUS_KINDS)[number]

export interface Category {
  id: IssueCategory
  /** the name its first status starts with, and what an issue shows while its status isn't known */
  name: string
  group: StatusGroup
  /** CSS colour (a theme variable): what an issue shows while its status isn't known */
  color: string
  /** the colour its first status starts with (the database seeds it: @seed issue-statuses) */
  seed: string
  /** what it decides, in a line (Settings) */
  description: string
}

export const CATEGORIES: Category[] = [
  { id: 'backlog', name: 'Backlog', group: 'backlog', color: 'var(--status-backlog)', seed: '#8a8f98', description: 'Shows on the Backlog tab: ideas and work nobody planned yet.' },
  { id: 'todo', name: 'Todo', group: 'unstarted', color: 'var(--status-todo)', seed: '#c4c6cc', description: 'Shows on the Active tab: planned, not started.' },
  { id: 'in_progress', name: 'In Progress', group: 'started', color: 'var(--status-progress)', seed: '#f2c94c', description: 'Shows on the Active tab: someone is working on it.' },
  { id: 'in_review', name: 'In Review', group: 'started', color: 'var(--status-review)', seed: '#4cb782', description: 'Shows on the Active tab: waiting for a look. Pull requests move issues here.' },
  { id: 'done', name: 'Done', group: 'completed', color: 'var(--status-done)', seed: '#5e6ad2', description: 'Counts as finished, and is archived after a while. Merged pull requests move issues here.' },
  { id: 'canceled', name: 'Canceled', group: 'canceled', color: 'var(--status-canceled)', seed: '#8a8f98', description: "Won't be done, and is archived after a while." },
  { id: 'duplicate', name: 'Duplicate', group: 'canceled', color: 'var(--status-canceled)', seed: '#8a8f98', description: 'The same as another issue, and is archived after a while.' },
]

const byId = new Map(CATEGORIES.map((s) => [s.id, s]))
/** a category this app doesn't know (written by a newer one, or by hand) reads as Backlog instead of breaking the screen */
export const categoryOf = (id: IssueCategory): Category => byId.get(id) ?? CATEGORIES[0]

export { STATUS_COLORS } from './colors'

/** The tabs on a team's Issues page. */
export type IssueTab = 'active' | 'backlog' | 'all'

export const TAB_GROUPS: Record<IssueTab, StatusGroup[]> = {
  active: ['unstarted', 'started'],
  backlog: ['backlog'],
  all: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
}

/** 0 = no priority, 1 = urgent … 4 = low (the same numbers the import uses). */
export const PRIORITY_IDS = [0, 1, 2, 3, 4] as const
export type Priority = (typeof PRIORITY_IDS)[number]

export const PRIORITY_NAMES: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

/** Display order for grouping by priority: urgent first, "no priority" last. */
export const PRIORITY_ORDER: Priority[] = [1, 2, 3, 4, 0]

/** Estimates people can pick, in points. Imported issues can have other numbers; those are shown as they are. */
export const ESTIMATES = [1, 2, 3, 5, 8] as const
