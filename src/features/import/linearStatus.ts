/**
 * A Linear workflow state → a status here. On its own, so linearMap.ts and linearFilters.ts can both use it without
 * importing each other.
 */
import { defaultStatus, statusesOf } from '@/data/statuses'
import { plainName as plain } from '@/lib/plain'
import type { Project, Status } from '@/model/schema'
import { CATEGORIES, isProjectCategory, type IssueCategory, type ProjectCategory } from '@/model/status'

const STATE_TYPES: Record<string, IssueCategory> = {
  triage: 'backlog',
  backlog: 'backlog',
  unstarted: 'todo',
  started: 'in_progress',
  completed: 'done',
  canceled: 'canceled',
}

/** by name first ("In Review"), then by Linear's kind of state */
export function mapStatus(state: { name: string; type: string }): IssueCategory {
  const name = plain(state.name.replace(/cancelled/i, 'canceled'))
  return CATEGORIES.find((s) => plain(s.name) === name)?.id ?? STATE_TYPES[state.type] ?? 'backlog'
}

/** Linear's kinds of project status (and the older `state` values) → a project category here */
const PROJECT_TYPES: Record<string, ProjectCategory> = {
  backlog: 'backlog',
  planned: 'planned',
  started: 'in_progress',
  paused: 'paused',
  completed: 'completed',
  canceled: 'canceled',
}

/**
 * A Linear project status → one of the workspace's shown project statuses: by name first ("On hold"), then by
 * Linear's kind of status, which is its category's default status, or `keep` (the project's status here) while that
 * is of the same category. The import never makes statuses. statusId is '' while the workspace's statuses aren't
 * known; the database then gives the project its category's default.
 */
export function mapProjectStatus(
  state: { name?: string | null; type: string },
  statuses: Readonly<Record<string, Status>>,
  keep?: Pick<Project, 'status' | 'statusId'>,
): Pick<Project, 'status' | 'statusId'> {
  const name = state.name ? plain(state.name.replace(/cancelled/i, 'canceled')) : ''
  const named = name ? statusesOf(statuses, 'project').find((s) => !s.hidden && plain(s.name) === name) : undefined
  if (named && isProjectCategory(named.category)) return { status: named.category, statusId: named.id }
  const status = PROJECT_TYPES[state.type] ?? 'planned'
  if (keep && keep.status === status && keep.statusId) return { status, statusId: keep.statusId }
  return { status, statusId: defaultStatus(statuses, 'project', status)?.id ?? '' }
}
