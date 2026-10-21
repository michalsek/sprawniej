/**
 * The choices for each issue property, ready for <Picker>. Used by the issue page, the new issue dialog and
 * keyboard shortcuts, so a property looks and works the same everywhere.
 */
import { useMemo } from 'react'
import { Box, CircleSlash, CircleUserRound } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { PersonAvatar } from '@/components/Avatar'
import { LabelDot } from '@/components/LabelChip'
import type { PickerItem } from '@/components/Picker'
import { issueStatuses, projectStatuses } from '@/data/statuses'
import { issueRef, useData } from '@/data/store'
import { handleOf, isGuest, ME, type Issue } from '@/model/schema'
import { categoryOf, ESTIMATES, PRIORITY_ORDER, PRIORITY_NAMES, type IssueCategory, type Priority } from '@/model/status'
import { StatusDot } from '@/features/projects/StatusDot'
import { EstimateIcon } from './DueDate'
import { estimateName } from './format'
import { IssueStatusIcon, PriorityIcon, StatusIcon } from './icons'

/**
 * The issue statuses to pick from, in the workspace's order (by category, then its own order). Hidden ones only when
 * `all` (the Status filter lists every status, so a view can still pick one) or when one of them is `current` (the
 * issue has it); either way marked "hidden". A status can also be found by its category's name.
 */
export function useStatusItems({ current, all = false }: { current?: readonly string[]; all?: boolean } = {}): PickerItem<string>[] {
  const statuses = useData((s) => s.statuses)
  const key = current?.join('|') ?? ''
  return useMemo(() => {
    const keep = new Set(key ? key.split('|') : [])
    return issueStatuses(statuses)
      .filter((s) => all || !s.hidden || keep.has(s.id))
      .map((s) => {
        const group = categoryOf(s.category as IssueCategory).name
        return {
          value: s.id,
          label: s.name,
          icon: <StatusIcon status={s} />,
          ...(s.hidden && { hint: 'hidden' }),
          ...(group !== s.name && { keywords: [group] }),
        }
      })
  }, [statuses, key, all])
}

export const priorityItems: PickerItem<Priority>[] = [0, ...PRIORITY_ORDER.filter((p) => p !== 0)].map((p) => ({
  value: p as Priority,
  label: PRIORITY_NAMES[p as Priority],
  icon: <PriorityIcon priority={p as Priority} />,
}))

/** the project statuses, for the Project status filter: every one, hidden ones marked "hidden" */
export function useProjectStatusItems(): PickerItem<string>[] {
  const statuses = useData((s) => s.statuses)
  return useMemo(
    () => projectStatuses(statuses).map((s) => ({ value: s.id, label: s.name, icon: <StatusDot status={s} />, ...(s.hidden && { hint: 'hidden' }) })),
    [statuses],
  )
}

/** `avatar`: a class for the pictures, where they sit in something smaller than a menu row */
export function usePeopleItems(avatar?: string): PickerItem<string | null>[] {
  const people = useData(useShallow((s) => Object.values(s.people)))
  const me = useData((s) => s.me?.login)
  return useMemo(
    () => [
      { value: null, label: 'No one', icon: <PersonAvatar login={null} className={avatar} /> },
      ...[...people]
        // you first, then everyone by name, then people who haven't joined yet
        .sort((a, b) => (a.login === me ? -1 : b.login === me ? 1 : Number(isGuest(a.login)) - Number(isGuest(b.login)) || a.name.localeCompare(b.name)))
        .map((p) => ({
          value: p.login as string | null,
          label: p.login === me ? `${p.name} (you)` : isGuest(p.login) ? `${p.name} (hasn’t joined)` : p.name,
          keywords: [handleOf(p)],
          icon: <PersonAvatar person={p} className={avatar} />,
        })),
    ],
    [people, me, avatar],
  )
}

/** people in a filter: Me first (whoever is looking at the list, so one view shows each person their own), then everyone */
export function useFilterPeopleItems(): PickerItem<string | null>[] {
  const people = usePeopleItems('size-4 text-[7px]')
  return useMemo(() => [{ value: ME, label: 'Me', hint: 'whoever is looking', icon: <CircleUserRound className="size-4 text-muted-foreground" /> }, ...people], [people])
}

export function useLabelItems(): PickerItem<string>[] {
  const labels = useData(useShallow((s) => Object.values(s.labels)))
  return useMemo(
    () =>
      [...labels]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => ({ value: l.id, label: l.name, icon: <LabelDot color={l.color} className="size-2.5" /> })),
    [labels],
  )
}

export function useProjectItems(team?: string): PickerItem<string | null>[] {
  const projects = useData(useShallow((s) => Object.values(s.projects)))
  return useMemo(
    () => [
      { value: null, label: 'No project', icon: <Box className="size-4 text-muted-foreground" /> },
      ...projects
        .filter((p) => !team || p.teams.length === 0 || p.teams.includes(team))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id as string | null, label: p.name, icon: <span className="w-4 text-center leading-none">{p.emoji}</span> })),
    ],
    [projects, team],
  )
}

/** possible parents: issues in the same team, never the issue itself or one of its own sub-issues */
export function useParentItems(issue?: Pick<Issue, 'id' | 'team'>, team?: string): PickerItem<string | null>[] {
  const issues = useData((s) => s.issues)
  return useMemo(() => {
    const t = issue?.team ?? team
    const below = new Set<string>()
    if (issue) {
      const walk = (id: string) => {
        for (const i of Object.values(issues)) {
          if (i.parent !== id || below.has(i.id)) continue
          below.add(i.id)
          walk(i.id)
        }
      }
      below.add(issue.id)
      walk(issue.id)
    }
    return [
      { value: null, label: 'No parent', icon: <CircleSlash className="size-4 text-muted-foreground" /> },
      ...Object.values(issues)
        .filter((i) => i.team === t && !below.has(i.id))
        .sort((a, b) => b.number - a.number)
        .map((i) => ({ value: i.id as string | null, label: i.title, hint: issueRef(i), keywords: [issueRef(i)], icon: <IssueStatusIcon issue={i} /> })),
    ]
  }, [issues, issue, team])
}

/** the estimate choices; an imported estimate outside the usual ones is offered too, so it shows as picked */
export function estimateItems(current?: number | null): PickerItem<number | null>[] {
  const values = [...new Set([...ESTIMATES, ...(current != null ? [current] : [])])].sort((a, b) => a - b)
  return [
    { value: null, label: 'No estimate', icon: <EstimateIcon className="opacity-50" /> },
    ...values.map((p) => ({ value: p as number | null, label: estimateName(p), keywords: [String(p)], icon: <EstimateIcon /> })),
  ]
}
