/**
 * Pure helpers that turn the store into what a list or board shows: filter, sort, group. No React, no store
 * access, so they are easy to test (tests/select.test.ts).
 */
import type { Display, InboxItem, Issue, Member, Ordering, Person, Project, ReadState, Status, Team } from '@/model/schema'
import { issueStatuses, projectStatuses, statusOfIssue, statusOfProject } from './statuses'
import { PRIORITY_NAMES, PRIORITY_ORDER, TAB_GROUPS, categoryOf, type IssueTab, type Priority } from '@/model/status'

export function inTab(issue: Issue, tab: IssueTab): boolean {
  return TAB_GROUPS[tab].includes(categoryOf(issue.status).group)
}

/** "completed" and "canceled" issues are hidden unless the display asks for them */
export const isClosed = (issue: Issue) => {
  const g = categoryOf(issue.status).group
  return g === 'completed' || g === 'canceled'
}

/** `months` months before `at`, as ISO; a day the month doesn't have becomes its last (Aug 31 minus 6 months: Feb 28) */
export function monthsBefore(at: string | number, months: number): string {
  const d = new Date(at)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString()
}

/**
 * Archived by the daily tidy-up (and by an import): finished, and finished and untouched for `months` months (so a
 * restored issue isn't put straight back). `months` 0 means never.
 */
export function dueForArchive(issue: Issue, months: number, at: string | number): boolean {
  if (months <= 0 || !isClosed(issue) || Number.isNaN(new Date(at).getTime())) return false
  const last = issue.completedAt && issue.completedAt > issue.updatedAt ? issue.completedAt : issue.updatedAt
  return last < monthsBefore(at, months)
}

const PRIORITY_RANK = new Map(PRIORITY_ORDER.map((p, i) => [p, i]))

export function compareIssues(ordering: Ordering): (a: Issue, b: Issue) => number {
  switch (ordering) {
    case 'priority':
      // a priority this version doesn't know (from a newer one) sorts last instead of breaking the order
      return (a, b) => (PRIORITY_RANK.get(a.priority) ?? PRIORITY_RANK.size) - (PRIORITY_RANK.get(b.priority) ?? PRIORITY_RANK.size) || byOrder(a, b)
    case 'due':
      // soonest first; no due date last
      return (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || byOrder(a, b)
    case 'updated':
      return (a, b) => b.updatedAt.localeCompare(a.updatedAt)
    case 'created':
      return (a, b) => b.createdAt.localeCompare(a.createdAt)
    case 'manual':
      return byOrder
  }
}

/** sortOrder keys compare as plain strings (not localeCompare: fractional-indexing relies on byte order) */
function byOrder(a: Issue, b: Issue): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder < b.sortOrder ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface Group {
  /** what an issue dropped into this group gets: a status id, a login, a priority, a project id, or null */
  key: string
  value: string | number | null
  title: string
  issues: Issue[]
  /** a group this page leaves out (Done on the Active tab): never a column, only somewhere to drop an issue */
  outside?: boolean
}

interface GroupCtx {
  people: Record<string, Person>
  /** the workspace's statuses (grouping by status); without them, one group per category */
  statuses?: Record<string, Status>
  projects: Record<string, Project>
  /** the page's team, if it has one: only its projects become extra groups */
  team?: string
  /** issues shown even though the page would leave them out (just dropped on Done from the Active board) */
  keep?: ReadonlySet<string>
}

/**
 * Split issues into groups in display order. Grouping by status always shows every status the tab covers,
 * even empty ones, so there is somewhere to drop an issue; a hidden status only while an issue here has it.
 *
 * `everyGroup` (the board) adds a group for every other place an issue could go: statuses this tab leaves out
 * (marked `outside`), people with nothing assigned, open projects with nothing in them. The board shows empty ones
 * under "Hidden columns" as places to drop a card; one that gets an issue becomes a column.
 */
export function groupIssues(issues: Issue[], display: Display, ctx: GroupCtx, tab: IssueTab = 'all', everyGroup = false): Group[] {
  const sorted = issues
    .filter((i) => (display.showCompleted || !isClosed(i) || ctx.keep?.has(i.id)) && (display.showSubIssues || !i.parent))
    .sort(compareIssues(display.ordering))
  switch (display.grouping) {
    case 'none':
      return [{ key: 'all', value: null, title: 'All issues', issues: sorted }]
    case 'status': {
      const statuses = ctx.statuses ?? {}
      const groups = TAB_GROUPS[tab]
      const shown = (s: Status) => {
        const g = categoryOf(s.category as Issue['status']).group
        return groups.includes(g) && (display.showCompleted || (g !== 'completed' && g !== 'canceled'))
      }
      // an issue whose status isn't known goes with its category's default
      const by = new Map<string, Issue[]>()
      for (const i of sorted) {
        const id = statusOfIssue(i, statuses).id
        const list = by.get(id)
        if (list) list.push(i)
        else by.set(id, [i])
      }
      return issueStatuses(statuses)
        .filter((s) => (s.hidden ? by.has(s.id) : everyGroup || shown(s)))
        .map((s) => ({
          key: s.id,
          value: s.id,
          title: s.name,
          issues: by.get(s.id) ?? [],
          ...(!shown(s) && { outside: true }),
        }))
    }
    case 'priority':
      return PRIORITY_ORDER.map((p: Priority) => ({
        key: `p${p}`,
        value: p,
        title: PRIORITY_NAMES[p],
        issues: sorted.filter((i) => i.priority === p),
      }))
    case 'assignee': {
      const assigned = sorted.map((i) => i.assignee).filter((l): l is string => !!l)
      const logins = [...new Set(everyGroup ? [...assigned, ...Object.keys(ctx.people)] : assigned)].sort((a, b) =>
        (ctx.people[a]?.name ?? a).localeCompare(ctx.people[b]?.name ?? b),
      )
      const out: Group[] = logins.map((l) => ({ key: l, value: l, title: ctx.people[l]?.name ?? l, issues: sorted.filter((i) => i.assignee === l) }))
      out.push({ key: 'nobody', value: null, title: 'No assignee', issues: sorted.filter((i) => !i.assignee) })
      return out
    }
    case 'project': {
      const used = sorted.map((i) => i.project).filter((p): p is string => !!p)
      const open = Object.values(ctx.projects)
        .filter((p) => p.status !== 'completed' && p.status !== 'canceled' && (!ctx.team || !p.teams.length || p.teams.includes(ctx.team)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => p.id)
      const ids = [...new Set(everyGroup ? [...used, ...open] : used)]
      const out: Group[] = ids.map((id) => ({ key: id, value: id, title: ctx.projects[id]?.name ?? 'Unknown project', issues: sorted.filter((i) => i.project === id) }))
      out.push({ key: 'none', value: null, title: 'No project', issues: sorted.filter((i) => !i.project) })
      return out
    }
  }
}

/**
 * Put each sub-issue right under its parent when both are in the same group.
 * Sub-issues whose parent is elsewhere stay where they are, at depth 0.
 */
export function nestChildren(issues: Issue[]): { issue: Issue; depth: number }[] {
  const here = new Set(issues.map((i) => i.id))
  const kids = new Map<string, Issue[]>()
  for (const i of issues) if (i.parent && here.has(i.parent)) kids.set(i.parent, [...(kids.get(i.parent) ?? []), i])
  const out: { issue: Issue; depth: number }[] = []
  const seen = new Set<string>()
  const visit = (i: Issue, depth: number) => {
    if (seen.has(i.id)) return // a parent loop (say, from an import) must not hang the app
    seen.add(i.id)
    out.push({ issue: i, depth })
    for (const k of kids.get(i.id) ?? []) visit(k, depth + 1)
  }
  for (const i of issues) if (!(i.parent && here.has(i.parent))) visit(i, 0)
  for (const i of issues) if (!seen.has(i.id)) visit(i, 0) // only reachable through a loop
  return out
}

export interface ChildCount {
  done: number
  total: number
}

const childCache = new WeakMap<Record<string, Issue>, Map<string, ChildCount>>()

/**
 * Sub-issue counters for every parent at once: how many children are done, out of how many. Built once per
 * version of the issues record (the store replaces it on every change), so a list of n rows costs O(n), not O(n²).
 */
export function childIndex(issues: Record<string, Issue>): Map<string, ChildCount> {
  let index = childCache.get(issues)
  if (index) return index
  index = new Map()
  for (const i of Object.values(issues)) {
    if (!i.parent) continue
    const c = index.get(i.parent) ?? { done: 0, total: 0 }
    c.total++
    if (categoryOf(i.status).group === 'completed') c.done++
    index.set(i.parent, c)
  }
  childCache.set(issues, index)
  return index
}

/** share of a project's issues that are done, 0..1 (canceled ones don't count either way) */
export function projectProgress(projectId: string, issues: Issue[]): { done: number; total: number } {
  const mine = issues.filter((i) => i.project === projectId && categoryOf(i.status).group !== 'canceled')
  return { done: mine.filter((i) => categoryOf(i.status).group === 'completed').length, total: mine.length }
}

/**
 * The order of projects in a board column: by `sortOrder` (byte by byte, as fractional-indexing writes it), then the
 * ones without one (made by an older version), by name.
 */
export function projectOrder(a: Pick<Project, 'id' | 'name' | 'sortOrder'>, b: Pick<Project, 'id' | 'name' | 'sortOrder'>): number {
  const x = a.sortOrder ?? null
  const y = b.sortOrder ?? null
  if (x !== null && y !== null && x !== y) return x < y ? -1 : 1
  if ((x === null) !== (y === null)) return x === null ? 1 : -1
  return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export interface ProjectColumn {
  status: Status
  projects: Project[]
}

/**
 * The project board: a column per shown project status, in their order (empty ones too, to drop into), then each
 * hidden status that still holds projects. A project sits in the column of the status it shows (statusOfProject).
 */
export function projectColumns(projects: readonly Project[], statuses: Record<string, Status>): ProjectColumn[] {
  const by = new Map<string, Project[]>()
  for (const p of projects) {
    const id = statusOfProject(p, statuses).id
    by.set(id, [...(by.get(id) ?? []), p])
  }
  const all = projectStatuses(statuses)
  const columns = [...all.filter((s) => !s.hidden), ...all.filter((s) => s.hidden && by.has(s.id))]
  return columns.map((status) => ({ status, projects: (by.get(status.id) ?? []).sort(projectOrder) }))
}

/** not marked as read yet: not read on its own (`readAt`) and newer than everything marked read at once */
export const isUnread = (n: Pick<InboxItem, 'at' | 'readAt'>, r: ReadState) => !n.readAt && (!r.readUntil || n.at > r.readUntil)

/**
 * The teams you're in, oldest first (then by key), the way the sidebar lists them. Home opens the first one. Without
 * a fixed order the first team would depend on the order things were loaded in.
 */
export function myTeamKeys(s: { teams: Record<string, Team>; me: Person | null }): string[] {
  return Object.values(s.teams)
    .filter((t) => !s.me || t.members.includes(s.me.login))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((t) => t.key)
}

type WithMembers = { members: Record<string, Member>; me: Person | null }

/** your role in the open workspace (null: not in it, or not known yet) */
export const roleOf = (s: WithMembers): Member['role'] | null => {
  const m = s.me ? s.members[s.me.login] : undefined
  return m && !m.removedAt ? m.role : null
}

/** admins and owners invite people, change roles, rename the workspace, delete teams and import */
export const isAdmin = (s: WithMembers): boolean => {
  const r = roleOf(s)
  return r === 'owner' || r === 'admin'
}

export const ownerCount = (s: Pick<WithMembers, 'members'>): number => Object.values(s.members).filter((m) => m.role === 'owner' && !m.removedAt).length

/** the contact email someone shows teammates (yours too: the open workspace's copy of your profile is the newest) */
export const contactEmailOf = (s: { people: Record<string, Person>; me: Person | null }, login: string): string | undefined =>
  (s.people[login] ?? (s.me?.login === login ? s.me : undefined))?.contactEmail
