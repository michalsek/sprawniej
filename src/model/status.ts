/**
 * Issue categories and priorities, fixed on purpose: one shared vocabulary for every team, and the import maps onto
 * the categories one to one. Each issue has a category (`issue.status`) and one of the workspace's own statuses
 * (`issue.statusId`, src/data/statuses.ts): people add, rename, recolour, reorder and hide statuses within a
 * category, but whatever decides something (the tabs, finished, the nightly archive, GitHub) looks at the category.
 * Each category belongs to a group; the groups decide which issues the Active, Backlog and All tabs show.
 */

import { STATUS_COLORS } from './colors'

export type StatusGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export const ISSUE_CATEGORIES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate'] as const
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]
export const isIssueCategory = (x: unknown): x is IssueCategory => ISSUE_CATEGORIES.some((c) => c === x)

/** a project's fixed categories (projects.status) */
export const PROJECT_CATEGORIES = ['backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled'] as const
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]
export const isProjectCategory = (x: unknown): x is ProjectCategory => PROJECT_CATEGORIES.some((c) => c === x)

/** what a status can be for: issues or projects */
export const STATUS_KINDS = ['issue', 'project'] as const
export type StatusKind = (typeof STATUS_KINDS)[number]

/** each kind's categories, in the order they show (the database checks the same lists) */
export const KIND_CATEGORIES: Record<StatusKind, readonly string[]> = { issue: ISSUE_CATEGORIES, project: PROJECT_CATEGORIES }

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
  { id: 'in_review', name: 'In Review', group: 'started', color: 'var(--status-review)', seed: '#4cb782', description: 'Shows on the Active tab: waiting for a look. GitHub moves issues here when work is ready for one.' },
  { id: 'done', name: 'Done', group: 'completed', color: 'var(--status-done)', seed: '#5e6ad2', description: 'Counts as finished, and is archived after a while. GitHub moves issues here when the work is finished.' },
  { id: 'canceled', name: 'Canceled', group: 'canceled', color: 'var(--status-canceled)', seed: '#8a8f98', description: "Won't be done, and is archived after a while." },
  { id: 'duplicate', name: 'Duplicate', group: 'canceled', color: 'var(--status-canceled)', seed: '#8a8f98', description: 'The same as another issue, and is archived after a while.' },
]

const byId = new Map(CATEGORIES.map((s) => [s.id, s]))
/** a category this app doesn't know (written by a newer one, or by hand) reads as Backlog instead of breaking the screen */
export const categoryOf = (id: IssueCategory): Category => byId.get(id) ?? CATEGORIES[0]

/** A project's category, as `Category` is an issue's. */
export interface ProjectCategoryInfo {
  id: ProjectCategory
  /** the name its first status starts with, and what a project shows while its status isn't known */
  name: string
  /** CSS colour (a theme variable): what a project shows while its status isn't known */
  color: string
  /** the colour its first status starts with (the database seeds it: @seed project-statuses) */
  seed: string
  /** what it decides, in a line (Settings) */
  description: string
}

export const PROJECT_CATEGORY_INFO: ProjectCategoryInfo[] = [
  { id: 'backlog', name: 'Backlog', color: 'var(--status-backlog)', seed: '#8a8f98', description: 'Ideas nobody planned yet.' },
  { id: 'planned', name: 'Planned', color: 'var(--status-todo)', seed: '#c4c6cc', description: 'Planned, not started. New projects start here.' },
  { id: 'in_progress', name: 'In progress', color: 'var(--status-progress)', seed: '#f2c94c', description: 'Someone is working on it.' },
  { id: 'paused', name: 'Paused', color: 'var(--status-canceled)', seed: '#8a8f98', description: 'Started, then put on hold.' },
  { id: 'completed', name: 'Completed', color: 'var(--status-done)', seed: '#5e6ad2', description: 'Finished. Grouping issues by project leaves it out.' },
  { id: 'canceled', name: 'Canceled', color: 'var(--status-canceled)', seed: '#8a8f98', description: "Won't be done. Grouping issues by project leaves it out." },
]

const projectById = new Map(PROJECT_CATEGORY_INFO.map((c) => [c.id, c]))
/** a project category this app doesn't know reads as Planned instead of breaking the screen */
export const projectCategoryOf = (id: string): ProjectCategoryInfo => projectById.get(id as ProjectCategory) ?? PROJECT_CATEGORY_INFO[1]

/** the category a status of this kind belongs to, when it is one of the kind's */
const categoryFor = (kind: StatusKind, category: string): Pick<Category, 'color' | 'seed'> | undefined => {
  if (kind === 'issue') return isIssueCategory(category) ? categoryOf(category) : undefined
  return isProjectCategory(category) ? projectCategoryOf(category) : undefined
}

/** the colour a category's new statuses start with: the colour its first status started with */
export const seedColor = (kind: StatusKind, category: string): string => categoryFor(kind, category)?.seed ?? STATUS_COLORS[0]

/**
 * The colour to paint a status in. One that still has its category's starting colour follows the theme (the
 * category's `--status-*`, deeper in Light); any other picked colour is the status's own, shaded by the theme
 * (`--status-shade`: a little darker in Light, so pale ones like yellow and pink still read on a light page; as it is
 * in Dark). A colour that is already a theme colour (`var(…)`) is used as it is.
 */
export function paintColor(status: { kind?: StatusKind; category: string; color: string }): string {
  const c = categoryFor(status.kind ?? 'issue', status.category)
  if (c && status.color === c.seed) return c.color
  return /^#[0-9a-f]{6}$/i.test(status.color) ? `color-mix(in oklab, ${status.color}, var(--status-shade))` : status.color
}

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
