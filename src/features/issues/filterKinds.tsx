/**
 * The fields a filter condition can look at: their names, icons and words, and the values each one offers.
 * FilterBar.tsx and FilterBuilder.tsx show them.
 */
import { useMemo, type ReactNode } from 'react'
import { Bell, Box, CalendarClock, CalendarPlus, CircleCheck, CircleDashed, CircleDot, History, SignalHigh, Tag, UserRound, Users } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { PickerItem } from '@/components/Picker'
import { useData } from '@/data/store'
import { valueKey, type KnownCondition } from '@/data/filterTree'
import { DATE_NAMES, OP_WORDS, amountWords, isDateCondition, isRelative, sayDate } from '@/data/dateFilters'
import { pickedStatusIds, statusFilter } from '@/data/statuses'
import type { DateCondition, DateField, FilterCondition, FilterField, FilterValue, Status } from '@/model/schema'
import { isIssueCategory } from '@/model/status'
import { shortDate } from './format'
import { priorityItems, useFilterPeopleItems, useLabelItems, useProjectItems, useProjectStatusItems, useStatusItems } from './pickers'

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

/** a field a date condition looks at */
export interface DateKind {
  key: DateField
  name: string
  icon: ReactNode
}

/** the date fields, in the order the menus show them (after the others) */
export const DATE_KINDS: DateKind[] = [
  { key: 'created', name: DATE_NAMES.created, icon: <CalendarPlus /> },
  { key: 'updated', name: DATE_NAMES.updated, icon: <History /> },
  { key: 'completed', name: DATE_NAMES.completed, icon: <CircleCheck /> },
  { key: 'due', name: DATE_NAMES.due, icon: <CalendarClock /> },
]
export const dateKindOf = (field: DateField): DateKind => DATE_KINDS.find((k) => k.key === field)!

export type FilterItems = Record<FilterField, PickerItem<FilterValue>[]>

/** the values each field offers */
export function useFilterItems(): FilterItems {
  // every status, hidden ones too, so a filter can still pick one
  const statuses = useStatusItems({ all: true })
  const projectStatuses = useProjectStatusItems()
  const people = useFilterPeopleItems()
  const labels = useLabelItems()
  const projects = useProjectItems()
  const teams = useData(useShallow((s) => Object.values(s.teams)))
  return useMemo(
    () => ({
      statuses,
      assignees: people,
      // anyone following the issue: who made it, is assigned, commented, was mentioned or subscribed
      subscribers: people.filter((p) => p.value !== null),
      priorities: priorityItems,
      labels,
      projects,
      projectStatuses,
      teams: teams.map((t) => ({ value: t.key, label: t.name, icon: <span className="w-4 text-center leading-none">{t.emoji}</span> })),
    }),
    [statuses, projectStatuses, people, labels, projects, teams],
  )
}

/** the item for a stored value (undefined: a value that was deleted) */
export const itemFor = (items: PickerItem<FilterValue>[], v: FilterValue) => items.find((i) => valueKey(i.value) === valueKey(v))

/** a sentence starts with a capital: "A filter from a newer version" */
export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

type Statuses = Record<string, Status>

/**
 * A condition's values as its picker shows them. Status keeps categories and, where only some of one's statuses are
 * picked, those statuses (as the flat filters do, src/data/statuses.ts); its picker shows the statuses themselves.
 */
export function pickedOf(c: FilterCondition & { field: FilterField }, statuses: Statuses): FilterValue[] {
  if (c.field !== 'statuses') return c.values
  return pickedStatusIds({ statuses: c.values.filter(isIssueCategory), statusIds: c.statusIds }, statuses)
}

/** the condition with these values picked (see pickedOf); a category with all its statuses picked is kept whole */
export function withPicked(c: FilterCondition, values: FilterValue[], statuses: Statuses): FilterCondition {
  if (c.field !== 'statuses') return { ...c, values }
  const f = statusFilter(values.filter((v) => typeof v === 'string'), statuses)
  return { ...c, values: f.statuses ?? [], statusIds: f.statusIds }
}

/**
 * A date condition in two parts, the quiet words and what was picked: ["Created in the last", "7 days"],
 * ["Completed before", "Oct 1"], ["Due date", "is overdue"].
 */
export function dateParts(c: DateCondition): [string, string] {
  const name = DATE_NAMES[c.field]
  if (isRelative(c.op)) return [`${name} ${OP_WORDS[c.op]}`, `${amountWords(c.amount, c.unit)}${c.op === 'ago' ? ' ago' : ''}`]
  if (c.op === 'before' || c.op === 'after') return [`${name} ${OP_WORDS[c.op]}`, c.date ? shortDate(c.date) : 'a day…']
  return [name, OP_WORDS[c.op]]
}

/** a condition in words, all values named: "Status is Todo or In Progress", "Created in the last 7 days" */
export function sayCondition(c: KnownCondition, items: FilterItems, statuses: Statuses): string {
  if (isDateCondition(c)) return sayDate(c, (d) => shortDate(d))
  const kind = kindOf(c.field)
  const names = pickedOf(c, statuses).map((v) => itemFor(items[c.field], v)?.label ?? `a deleted ${kind.one}`)
  return `${kind.name} ${c.op === 'not' ? kind.not : kind.is} ${names.length ? names.join(' or ') : 'anything'}`
}
