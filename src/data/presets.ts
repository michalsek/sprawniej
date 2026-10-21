/**
 * What a new issue starts with when it's made from a list: "+" on a group gives it what the page, your filters, the
 * quick filters and the group say. Pure, no React and no store (tests/presets.test.ts).
 */
import type { FilterGroup, FilterValue, Filters, Grouping } from '@/model/schema'
import type { NewIssue } from './actions'
import { presetFrom } from './filterTree'
import type { QuickFilters } from './quickFilters'
import type { Group } from './select'

interface Ctx {
  /** your own filters (or a view's), as a tree */
  ownTree: FilterGroup
  /** what the page always shows (this team, this project) */
  filters: Filters
  /** the side panel's quick filters */
  picks: QuickFilters
  grouping: Grouping
  /** your login, for Me */
  me?: string
}

/**
 * "+" on a group: a new issue that already belongs in that group and on this page. A value the filters leave no choice
 * about is taken (one team, one assignee); one picked quick value wins over the filters (it's the narrower), and
 * picked labels all go on it. The group has the last word.
 */
export function presetForGroup(g: Pick<Group, 'value'>, { ownTree, filters, picks, grouping, me }: Ctx): Partial<NewIssue> {
  const preset: Partial<NewIssue> = {}
  const both = { ...presetFrom(ownTree, me), ...filters }
  const one = (f: 'assignees' | 'projects' | 'priorities'): FilterValue | undefined => (picks[f]?.length === 1 ? picks[f][0] : undefined)
  const labels = [...new Set([...(both.labels ?? []), ...(picks.labels ?? []).filter((l): l is string => typeof l === 'string')])]
  if (both.teams?.length === 1) preset.team = both.teams[0]
  if (both.projects?.length === 1 && both.projects[0]) preset.project = both.projects[0]
  if (one('projects') !== undefined) preset.project = one('projects') as string | null
  if (labels.length) preset.labels = labels
  if (both.assignees?.length === 1) preset.assignee = both.assignees[0]
  if (one('assignees') !== undefined) preset.assignee = one('assignees') as string | null
  if (one('priorities') !== undefined) preset.priority = one('priorities') as NewIssue['priority']
  if (grouping === 'status' && typeof g.value === 'string') preset.statusId = g.value
  if (grouping === 'priority' && typeof g.value === 'number') preset.priority = g.value as NewIssue['priority']
  if (grouping === 'assignee') preset.assignee = g.value as string | null
  if (grouping === 'project') preset.project = g.value as string | null
  return preset
}
