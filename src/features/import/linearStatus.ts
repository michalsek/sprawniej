/**
 * A Linear workflow state → a status here. On its own, so linearMap.ts and linearFilters.ts can both use it without
 * importing each other.
 */
import { plainName as plain } from '@/data/relink'
import { STATUSES, type StatusId } from '@/model/status'

const STATE_TYPES: Record<string, StatusId> = {
  triage: 'backlog',
  backlog: 'backlog',
  unstarted: 'todo',
  started: 'in_progress',
  completed: 'done',
  canceled: 'canceled',
}

/** by name first ("In Review"), then by Linear's kind of state */
export function mapStatus(state: { name: string; type: string }): StatusId {
  const name = plain(state.name.replace(/cancelled/i, 'canceled'))
  return STATUSES.find((s) => plain(s.name) === name)?.id ?? STATE_TYPES[state.type] ?? 'backlog'
}
