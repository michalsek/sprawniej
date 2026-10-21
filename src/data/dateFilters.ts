/**
 * Date conditions in the filter tree: "Created in the last 7 days", "Completed more than 2 weeks ago", "Due date in
 * the next 3 days", "Due date is overdue", "Updated before Oct 1", "Completed is empty". Pure functions, no React and
 * no store (tests/filterTree.test.ts); src/data/filterTree.ts joins them with the other conditions.
 *
 * The times (created, updated, completed) are moments; a due date is a plain day, the same for everyone. Days are
 * this browser's days: "before Oct 1" is before the start of Oct 1 here. The relative ones ("in the last 7 days") are
 * worked out against `now`, when the list is made.
 */
import { DATE_FIELDS, DATE_OPS, DATE_UNITS, type DateCondition, type DateField, type DateOp, type DateUnit, type Issue } from '@/model/schema'

const DAY = /^\d{4}-\d{2}-\d{2}$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** a date condition this version understands (another op or unit comes from a newer version) */
export function isDateCondition(n: unknown): n is DateCondition {
  if (!isObject(n) || !(DATE_FIELDS as readonly unknown[]).includes(n.field) || !(DATE_OPS as readonly unknown[]).includes(n.op)) return false
  return (
    (n.amount === undefined || typeof n.amount === 'number') &&
    (n.unit === undefined || (DATE_UNITS as readonly unknown[]).includes(n.unit)) &&
    (n.date === undefined || typeof n.date === 'string')
  )
}


/** ops that count from now */
export const RELATIVE: readonly DateOp[] = ['within', 'ago', 'next']
export const isRelative = (op: DateOp) => RELATIVE.includes(op)

/** what each field offers, in the order the menu shows them (created and updated are always set) */
export function opsFor(field: DateField): DateOp[] {
  if (field === 'due') return ['next', 'overdue', 'within', 'ago', 'before', 'after', 'empty', 'set']
  if (field === 'completed') return ['within', 'ago', 'before', 'after', 'empty', 'set']
  return ['within', 'ago', 'before', 'after']
}

/** units a field offers: a due date is a day, so no hours */
export const unitsFor = (field: DateField): DateUnit[] => (field === 'due' ? ['days', 'weeks', 'months'] : [...DATE_UNITS])

/** a condition with all it needs: an amount of 1 or more and a unit, or a day */
export function dateReady(c: DateCondition): boolean {
  if (isRelative(c.op)) return typeof c.amount === 'number' && Number.isInteger(c.amount) && c.amount >= 1 && !!c.unit
  if (c.op === 'before' || c.op === 'after') return typeof c.date === 'string' && DAY.test(c.date)
  return true
}

/** a new condition on this field: the most useful thing to start from */
export function newDateCondition(field: DateField): DateCondition {
  return field === 'due' ? { field, op: 'next', amount: 7, unit: 'days' } : { field, op: 'within', amount: 7, unit: 'days' }
}

/** the condition saying this instead, keeping what still fits (the amount and unit, or the day) */
export function withDateOp(c: DateCondition, op: DateOp): DateCondition {
  const base = { ...c, op, amount: undefined, unit: undefined, date: undefined }
  if (isRelative(op)) {
    const unit = c.unit && unitsFor(c.field).includes(c.unit) ? c.unit : 'days'
    return { ...base, amount: c.amount ?? 7, unit }
  }
  if (op === 'before' || op === 'after') return { ...base, date: c.date }
  return base
}

/** the condition on another date field, keeping what fits there */
export function withDateField(c: DateCondition, field: DateField): DateCondition {
  const op = opsFor(field).includes(c.op) ? c.op : newDateCondition(field).op
  return withDateOp({ ...c, field }, op)
}

/** a plain day in this browser's time zone */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const startOf = (day: string) => new Date(`${day}T00:00`)

/** `now` moved by this much (back when `sign` is -1); days and months follow the calendar, so summer time is fine */
function shift(now: Date, amount: number, unit: DateUnit, sign: 1 | -1): Date {
  const d = new Date(now)
  if (unit === 'hours') d.setTime(d.getTime() + sign * amount * 3_600_000)
  else if (unit === 'days') d.setDate(d.getDate() + sign * amount)
  else if (unit === 'weeks') d.setDate(d.getDate() + sign * amount * 7)
  else d.setMonth(d.getMonth() + sign * amount)
  return d
}

/** a day moved by this much (hours count as whole days, rounded up) */
function shiftDay(day: string, amount: number, unit: DateUnit, sign: 1 | -1): string {
  return unit === 'hours' ? dayOf(shift(startOf(day), Math.ceil(amount / 24), 'days', sign)) : dayOf(shift(startOf(day), amount, unit, sign))
}

/** the day after */
const nextDay = (day: string) => dayOf(shift(startOf(day), 1, 'days', 1))

type Test = (issue: Issue) => boolean

/** the condition as a test for issues; null when it isn't ready, or says nothing about this field */
export function dateTest(c: DateCondition, now: Date): Test | null {
  if (!dateReady(c)) return null
  const amount = c.amount ?? 0
  const unit = c.unit ?? 'days'
  if (c.field === 'due') {
    const today = dayOf(now)
    const due = (i: Issue) => i.dueDate ?? null
    switch (c.op) {
      case 'within': {
        const from = shiftDay(today, amount, unit, -1)
        return (i) => ((d) => !!d && d >= from && d <= today)(due(i))
      }
      case 'ago': {
        const before = shiftDay(today, amount, unit, -1)
        return (i) => ((d) => !!d && d < before)(due(i))
      }
      case 'next': {
        const to = shiftDay(today, amount, unit, 1)
        return (i) => ((d) => !!d && d >= today && d <= to)(due(i))
      }
      case 'overdue':
        return (i) => ((d) => !!d && d < today)(due(i))
      case 'before':
        return (i) => ((d) => !!d && d < c.date!)(due(i))
      case 'after':
        return (i) => ((d) => !!d && d > c.date!)(due(i))
      case 'empty':
        return (i) => !due(i)
      case 'set':
        return (i) => !!due(i)
    }
  }
  const at = (i: Issue): number | null => {
    const v = c.field === 'created' ? i.createdAt : c.field === 'updated' ? i.updatedAt : i.completedAt
    const t = v ? Date.parse(v) : NaN
    return Number.isNaN(t) ? null : t
  }
  const t0 = now.getTime()
  switch (c.op) {
    case 'within': {
      const from = shift(now, amount, unit, -1).getTime()
      return (i) => ((t) => t !== null && t >= from)(at(i))
    }
    case 'ago': {
      const before = shift(now, amount, unit, -1).getTime()
      return (i) => ((t) => t !== null && t < before)(at(i))
    }
    case 'next': {
      const to = shift(now, amount, unit, 1).getTime()
      return (i) => ((t) => t !== null && t >= t0 && t <= to)(at(i))
    }
    case 'overdue':
      return null
    case 'before': {
      const before = startOf(c.date!).getTime()
      return (i) => ((t) => t !== null && t < before)(at(i))
    }
    case 'after': {
      const from = startOf(nextDay(c.date!)).getTime()
      return (i) => ((t) => t !== null && t >= from)(at(i))
    }
    case 'empty':
      return (i) => at(i) === null
    case 'set':
      return (i) => at(i) !== null
  }
}

/** what each date field is called */
export const DATE_NAMES: Record<DateField, string> = { created: 'Created', updated: 'Updated', completed: 'Completed', due: 'Due date' }

const UNIT_ONE: Record<DateUnit, string> = { hours: 'hour', days: 'day', weeks: 'week', months: 'month' }

/** "7 days", "1 day" */
export const amountWords = (amount: number | undefined, unit: DateUnit | undefined) =>
  `${amount ?? '?'} ${amount === 1 ? UNIT_ONE[unit ?? 'days'] : (unit ?? 'days')}`

/** the op's words before the amount or day: "in the last", "more than", "before" */
export const OP_WORDS: Record<DateOp, string> = {
  within: 'in the last',
  ago: 'more than',
  next: 'in the next',
  overdue: 'is overdue',
  before: 'before',
  after: 'after',
  empty: 'is empty',
  set: 'is set',
}

/** the op as its menu shows it: "in the last…", "more than… ago" */
export const OP_CHOICES: Record<DateOp, string> = {
  within: 'in the last…',
  ago: 'more than… ago',
  next: 'in the next…',
  overdue: 'is overdue',
  before: 'before…',
  after: 'after…',
  empty: 'is empty',
  set: 'is set',
}

/** the condition in words: "Completed in the last 1 day", "Due date before Oct 31"; `day` writes a day */
export function sayDate(c: DateCondition, day: (d: string) => string = (d) => d): string {
  const name = DATE_NAMES[c.field]
  if (isRelative(c.op)) return `${name} ${OP_WORDS[c.op]} ${amountWords(c.amount, c.unit)}${c.op === 'ago' ? ' ago' : ''}`
  if (c.op === 'before' || c.op === 'after') return `${name} ${OP_WORDS[c.op]} ${c.date ? day(c.date) : 'a day'}`
  return `${name} ${OP_WORDS[c.op]}`
}

/** a day moved by `n` days: addDays('2026-10-31', 1) is '2026-11-01' */
export const addDays = (day: string, n: number) => dayOf(shift(startOf(day), Math.abs(n), 'days', n < 0 ? -1 : 1))
