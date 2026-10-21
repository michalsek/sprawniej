/**
 * The fields a filter condition can look at: their names, icons and words, and the values each one offers.
 * FilterBar.tsx and FilterBuilder.tsx show them.
 */
import { useMemo, type ReactNode } from 'react'
import { Bell, Box, CircleDashed, CircleDot, SignalHigh, Tag, UserRound, Users } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { PickerItem } from '@/components/Picker'
import { useData } from '@/data/store'
import { valueKey } from '@/data/filterTree'
import type { FilterCondition, FilterField, FilterValue } from '@/model/schema'
import { priorityItems, projectStatusItems, statusItems, useFilterPeopleItems, useLabelItems, useProjectItems } from './pickers'

export interface Kind {
  key: FilterField
  name: string
  icon: ReactNode
  /** what one value and several are called: "1 deleted label", "4 statuses" */
  one: string
  many: string
  /** the operator's words: "is" / "is not", or "include" / "don’t include" for fields an issue has several of */
  is: string
  not: string
}

const IS = { is: 'is', not: 'is not' }
const INCLUDE = { is: 'include', not: 'don’t include' }

/** every field, in the order the menus show them */
export const KINDS: Kind[] = [
  { key: 'statuses', name: 'Status', icon: <CircleDot />, one: 'status', many: 'statuses', ...IS },
  { key: 'assignees', name: 'Assignee', icon: <UserRound />, one: 'person', many: 'people', ...IS },
  { key: 'subscribers', name: 'Subscribers', icon: <Bell />, one: 'person', many: 'people', ...INCLUDE },
  { key: 'priorities', name: 'Priority', icon: <SignalHigh />, one: 'priority', many: 'priorities', ...IS },
  { key: 'labels', name: 'Labels', icon: <Tag />, one: 'label', many: 'labels', ...INCLUDE },
  { key: 'projects', name: 'Project', icon: <Box />, one: 'project', many: 'projects', ...IS },
  { key: 'projectStatuses', name: 'Project status', icon: <CircleDashed />, one: 'project status', many: 'project statuses', ...IS },
  { key: 'teams', name: 'Team', icon: <Users />, one: 'team', many: 'teams', ...IS },
]
const BY_KEY = new Map(KINDS.map((k) => [k.key, k]))
export const kindOf = (field: FilterField): Kind => BY_KEY.get(field)!

export type FilterItems = Record<FilterField, PickerItem<FilterValue>[]>

/** the values each field offers */
export function useFilterItems(): FilterItems {
  const people = useFilterPeopleItems()
  const labels = useLabelItems()
  const projects = useProjectItems()
  const teams = useData(useShallow((s) => Object.values(s.teams)))
  return useMemo(
    () => ({
      statuses: statusItems,
      assignees: people,
      // anyone following the issue: who made it, is assigned, commented, was mentioned or subscribed
      subscribers: people.filter((p) => p.value !== null),
      priorities: priorityItems,
      labels,
      projects,
      projectStatuses: projectStatusItems,
      teams: teams.map((t) => ({ value: t.key, label: t.name, icon: <span className="w-4 text-center leading-none">{t.emoji}</span> })),
    }),
    [people, labels, projects, teams],
  )
}

/** the item for a stored value (undefined: a value that was deleted) */
export const itemFor = (items: PickerItem<FilterValue>[], v: FilterValue) => items.find((i) => valueKey(i.value) === valueKey(v))

/** a sentence starts with a capital: "A filter from a newer version" */
export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** a condition in words, all values named: "Status is Todo or In Progress" */
export function sayCondition(c: FilterCondition & { field: FilterField }, items: FilterItems): string {
  const kind = kindOf(c.field)
  const names = c.values.map((v) => itemFor(items[c.field], v)?.label ?? `a deleted ${kind.one}`)
  return `${kind.name} ${c.op === 'not' ? kind.not : kind.is} ${names.length ? names.join(' or ') : 'anything'}`
}
