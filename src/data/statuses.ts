/**
 * The workspace's own statuses (the statuses table): a name and a colour within one fixed category. Pure helpers, so
 * they are easy to test (tests/statuses.test.ts).
 *
 * The rules, the same as the database's (supabase/migrations/*_statuses.sql):
 * - Statuses show in category order, then by `position`, then by id.
 * - The default status of a category is its first shown one. That is where an issue lands when only its category is
 *   known: an older version of the app, GitHub, the import, a new issue made "in Todo".
 * - Each category keeps at least one shown status; statuses are never deleted, only hidden.
 * - Whatever decides something looks at the category (`issue.status`, `project.status`), never at a status.
 */
import type { Filters, Issue, Project, Status } from '@/model/schema'
import {
  CATEGORIES,
  categoryOf,
  ISSUE_CATEGORIES,
  isIssueCategory,
  isProjectCategory,
  KIND_CATEGORIES,
  PROJECT_CATEGORY_INFO,
  projectCategoryOf,
  type IssueCategory,
  type ProjectCategory,
  type StatusKind,
} from '@/model/status'

type Statuses = Readonly<Record<string, Status>>

const rank = (kind: StatusKind, category: string) => {
  const n = KIND_CATEGORIES[kind].indexOf(category)
  return n < 0 ? KIND_CATEGORIES[kind].length : n
}

/** positions and ids compare byte by byte (fractional-indexing relies on it), not with localeCompare */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** one kind's statuses in the order they show (category, then position, then id), hidden ones too */
export function statusesOf(statuses: Statuses, kind: StatusKind): Status[] {
  return Object.values(statuses)
    .filter((s) => s.kind === kind)
    .sort((a, b) => rank(kind, a.category) - rank(kind, b.category) || cmp(a.position, b.position) || cmp(a.id, b.id))
}

/** the default status of a category: its first shown one (undefined while the workspace's statuses aren't known) */
export function defaultStatus(statuses: Statuses, kind: StatusKind, category: string): Status | undefined {
  return statusesOf(statuses, kind).find((s) => s.category === category && !s.hidden)
}

/**
 * Made up from the categories, for while a workspace's issue statuses aren't known (they come with everything else,
 * so only for a moment, if ever): the id is the category, and picking one means "this category".
 */
export const CATEGORY_STATUSES: readonly Status[] = CATEGORIES.map((c) => ({ id: c.id, kind: 'issue', category: c.id, name: c.name, color: c.color, position: 'a0', hidden: false }))

/** the issue statuses to show and pick from: the workspace's, or the made-up ones while there are none */
export function issueStatuses(statuses: Statuses): Status[] {
  const own = statusesOf(statuses, 'issue')
  return own.length ? own : [...CATEGORY_STATUSES]
}

/**
 * The status an issue shows: its own; or, while that isn't known (or doesn't fit its category), the category's
 * default; or one made up from the category.
 */
export function statusOfIssue(issue: Pick<Issue, 'status' | 'statusId'>, statuses: Statuses): Status {
  const own = statuses[issue.statusId]
  if (own && own.kind === 'issue' && own.category === issue.status) return own
  const category = categoryOf(issue.status).id
  return defaultStatus(statuses, 'issue', category) ?? CATEGORY_STATUSES.find((s) => s.category === category)!
}

/**
 * What picking `pick` means for an issue: a status of the workspace (its id and its category), or a category (one of
 * the made-up statuses, or a category asked for by name), which means that category's default status. Undefined for
 * something that is neither.
 */
export function pickStatus(pick: string, statuses: Statuses): { statusId?: string; status: IssueCategory } | undefined {
  const own = statuses[pick]
  if (own && own.kind === 'issue' && isIssueCategory(own.category)) return { statusId: own.id, status: own.category }
  if (!isIssueCategory(pick)) return undefined
  const d = defaultStatus(statuses, 'issue', pick)
  return d ? { statusId: d.id, status: pick } : { status: pick }
}

// ---------- projects ----------
// The same rules for a project's status (`project.statusId`) and its category (`project.status`).

/** made up from the project categories, as CATEGORY_STATUSES: the id is the category */
export const PROJECT_CATEGORY_STATUSES: readonly Status[] = PROJECT_CATEGORY_INFO.map((c) => ({ id: c.id, kind: 'project', category: c.id, name: c.name, color: c.color, position: 'a0', hidden: false }))

/** the project statuses to show and pick from: the workspace's, or the made-up ones while there are none */
export function projectStatuses(statuses: Statuses): Status[] {
  const own = statusesOf(statuses, 'project')
  return own.length ? own : [...PROJECT_CATEGORY_STATUSES]
}

/** the status a project shows: its own; or its category's default (or a made-up one) while that isn't known */
export function statusOfProject(project: Pick<Project, 'status' | 'statusId'>, statuses: Statuses): Status {
  const own = statuses[project.statusId]
  if (own && own.kind === 'project' && own.category === project.status) return own
  const category = projectCategoryOf(project.status).id
  return defaultStatus(statuses, 'project', category) ?? PROJECT_CATEGORY_STATUSES.find((s) => s.category === category)!
}

/** what picking `pick` means for a project (as pickStatus): a project status, or a category's default */
export function pickProjectStatus(pick: string, statuses: Statuses): { statusId?: string; status: ProjectCategory } | undefined {
  const own = statuses[pick]
  if (own && own.kind === 'project' && isProjectCategory(own.category)) return { statusId: own.id, status: own.category }
  if (!isProjectCategory(pick)) return undefined
  const d = defaultStatus(statuses, 'project', pick)
  return d ? { statusId: d.id, status: pick } : { status: pick }
}

/** hiding it leaves its category a shown status (the database refuses otherwise) */
export function canHide(status: Pick<Status, 'id' | 'kind' | 'category'>, statuses: Statuses): boolean {
  return statusesOf(statuses, status.kind).some((s) => s.id !== status.id && s.category === status.category && !s.hidden)
}

/** a name another status of this kind already has (case aside), so two can't be told apart */
export function statusNamed(statuses: Statuses, kind: StatusKind, name: string, but?: string): Status | undefined {
  const wanted = name.trim().toLowerCase()
  return Object.values(statuses).find((s) => s.kind === kind && s.id !== but && s.name.toLowerCase() === wanted)
}

// ---------- the Status filter ----------

/** the statuses of this kind the filter's refinement names, by category */
function refinement(f: Pick<Filters, 'statusIds'>, statuses: Statuses): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const id of f.statusIds ?? []) {
    const s = statuses[id]
    if (!s || s.kind !== 'issue') continue
    const set = out.get(s.category) ?? new Set<string>()
    set.add(id)
    out.set(s.category, set)
  }
  return out
}

/**
 * Whether an issue passes the Status filter: its category is one of `statuses`, and when `statusIds` names any status
 * of that category, it has one of those. `statusIds` alone means nothing, so older versions (which read only
 * `statuses`) show the same issues or more, never fewer.
 */
export function matchesStatus(issue: Pick<Issue, 'status' | 'statusId'>, f: Pick<Filters, 'statuses' | 'statusIds'>, statuses: Statuses): boolean {
  if (!f.statuses?.length) return true
  if (!f.statuses.includes(issue.status)) return false
  const only = refinement(f, statuses).get(issue.status)
  return !only || only.has(issue.statusId)
}

/** the statuses the Status filter shows as picked: every status of a whole category, else the ones it names */
export function pickedStatusIds(f: Pick<Filters, 'statuses' | 'statusIds'>, statuses: Statuses): string[] {
  if (!f.statuses?.length) return []
  const only = refinement(f, statuses)
  return issueStatuses(statuses)
    .filter((s) => f.statuses!.some((c) => c === s.category) && (!only.has(s.category) || only.get(s.category)!.has(s.id)))
    .map((s) => s.id)
}

/**
 * The filter for these picked statuses. A category whose statuses are all picked (hidden ones too: the filter lists
 * them, ticked) is stored whole, so a status added to it later shows too; one with only some picked is stored with
 * those statuses, so what is ticked is what is kept.
 */
export function statusFilter(ids: readonly string[], statuses: Statuses): Pick<Filters, 'statuses' | 'statusIds'> {
  const picked = new Set(ids)
  const all = issueStatuses(statuses)
  const categories: IssueCategory[] = []
  const only: string[] = []
  for (const c of ISSUE_CATEGORIES) {
    const mine = all.filter((s) => s.category === c)
    const chosen = mine.filter((s) => picked.has(s.id))
    if (!chosen.length) continue
    categories.push(c)
    if (chosen.length < mine.length) only.push(...chosen.map((s) => s.id))
  }
  return { statuses: categories.length ? categories : undefined, statusIds: only.length ? only : undefined }
}
