/**
 * A Linear workflow state → a status here. On its own, so linearMap.ts and linearFilters.ts can both use it without
 * importing each other.
 */
import { plainName as plain } from '@/lib/plain'
import { CATEGORIES, type IssueCategory } from '@/model/status'

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
