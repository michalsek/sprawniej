/**
 * Date conditions in the filter tree: "Created in the last 7 days", "Completed more than 2 weeks ago", "Due date in
 * the next 3 days", "Due date is overdue", "Updated before Oct 1", "Completed is empty". Pure functions, no React and
 * no store (tests/filterTree.test.ts); src/data/filterTree.ts joins them with the other conditions.
 *
 * The times (created, updated, completed) are moments; a due date is a plain day, the same for everyone. Days are
 * this browser's days: "before Oct 1" is before the start of Oct 1 here. The relative ones ("in the last 7 days") are
 * worked out against `now`, when the list is made.
 *
 * Only what the builder can show is a date condition here: a field, an op that field offers, and for that op exactly
 * a whole amount and a unit (in range), or a day. Anything else (another op, unit or key, an amount of 0 or 1.5, a time
 * where a day should be) was written by a newer version: it's left out of matching and kept as it is. A line that
 * only misses its amount, unit or day is one being filled in.
 */
import { DAY, fromDay, plusMonths, toDay } from '@/lib/days'
import { DATE_UNITS, isDateField, type DateCondition, type DateField, type DateOp, type DateUnit, type Issue } from '@/model/schema'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** ops that count from now */
const RELATIVE: readonly DateOp[] = ['within', 'ago', 'next']
export const isRelative = (op: DateOp) => RELATIVE.includes(op)

/** the most of each unit an amount can be: ten years */
const MOST: Record<DateUnit, number> = { hours: 8760, days: 3650, weeks: 520, months: 120 }

/** what each field offers, in the order the menu shows them (created and updated are always set) */
export function opsFor(field: DateField): DateOp[] {
  if (field === 'due') return ['next', 'overdue', 'within', 'ago', 'before', 'after', 'empty', 'set']
  if (field === 'completed') return ['within', 'ago', 'before', 'after', 'empty', 'set']
  return ['within', 'ago', 'before', 'after']
}

/** units a field offers: a due date is a day, so no hours */
export const unitsFor = (field: DateField): DateUnit[] => (field === 'due' ? ['days', 'weeks', 'months'] : [...DATE_UNITS])

/** an amount the builder can show: a whole number from 1, at most ten years of the unit */
export const isAmount = (n: unknown, unit: DateUnit = 'hours'): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MOST[unit]

const KEYS = ['field', 'op', 'amount', 'unit', 'date']

/** a date condition this version can show (see above); a line still being filled in counts */
export function isDateCondition(n: unknown): n is DateCondition {
  if (!isObject(n) || !isDateField(n.field)) return false
  const field = n.field
  const op = n.op as DateOp
  if (!opsFor(field).includes(op) || Object.keys(n).some((k) => !KEYS.includes(k) && n[k] !== undefined)) return false
  const { amount, unit, date } = n
  if (isRelative(op)) {
    if (date !== undefined) return false
    if (unit !== undefined && !unitsFor(field).includes(unit as DateUnit)) return false
    return amount === undefined || isAmount(amount, unit as DateUnit | undefined)
  }
  if (amount !== undefined || unit !== undefined) return false
  if (op === 'before' || op === 'after') return date === undefined || (typeof date === 'string' && DAY.test(date))
  return date === undefined
}

/** a condition with all it needs (an amount and a unit, or a day); one that isn't is being filled in */
export function dateReady(c: DateCondition): boolean {
  if (isRelative(c.op)) return c.amount !== undefined && c.unit !== undefined
  if (c.op === 'before' || c.op === 'after') return c.date !== undefined
  return true
}

/** a condition whose meaning moves with the clock ("in the last hour", "overdue"), so an open list has to keep up */
export const movesWithTime = (c: DateCondition) => isRelative(c.op) || c.op === 'overdue'

/** a new condition on this field: the most useful thing to start from */
export function newDateCondition(field: DateField): DateCondition {
  return field === 'due' ? { field, op: 'next', amount: 7, unit: 'days' } : { field, op: 'within', amount: 7, unit: 'days' }
}

/** the condition saying this instead, keeping what still fits (the amount and unit, or the day) */
export function withDateOp(c: DateCondition, op: DateOp): DateCondition {
  const base = { ...c, op, amount: undefined, unit: undefined, date: undefined }
  if (isRelative(op)) {
    const unit = c.unit && unitsFor(c.field).includes(c.unit) ? c.unit : 'days'
    return { ...base, amount: isAmount(c.amount, unit) ? c.amount : 7, unit }
  }
  if (op === 'before' || op === 'after') return { ...base, date: c.date }
  return base
}

/** the condition on another date field, keeping what fits there */
export function withDateField(c: DateCondition, field: DateField): DateCondition {
  const op = opsFor(field).includes(c.op) ? c.op : newDateCondition(field).op
  return withDateOp({ ...c, field }, op)
}

/** `now` moved by this much (back when `sign` is -1); days and months follow the calendar, so summer time is fine */
function shift(now: Date, amount: number, unit: DateUnit, sign: 1 | -1): Date {
  if (unit === 'months') return plusMonths(now, sign * amount)
  const d = new Date(now)
  if (unit === 'hours') d.setTime(d.getTime() + sign * amount * 3_600_000)
  else d.setDate(d.getDate() + sign * amount * (unit === 'weeks' ? 7 : 1))
  return d
}

/** a day moved by this much (hours count as whole days, rounded up) */
function shiftDay(day: string, amount: number, unit: DateUnit, sign: 1 | -1): string {
  return unit === 'hours' ? toDay(shift(fromDay(day), Math.ceil(amount / 24), 'days', sign)) : toDay(shift(fromDay(day), amount, unit, sign))
}

/** a day `n` days later (earlier when `n` is below 0): dayPlus('2026-10-31', 1) is '2026-11-01' */
export const dayPlus = (day: string, n: number) => toDay(shift(fromDay(day), Math.abs(n), 'days', n < 0 ? -1 : 1))

type Test = (issue: Issue) => boolean

/** the condition as a test for issues; null when it isn't ready, or says nothing about this field */
export function dateTest(c: DateCondition, now: Date): Test | null {
  if (!dateReady(c)) return null
  const amount = c.amount ?? 0
  const unit = c.unit ?? 'days'
  const date = c.date ?? ''
  if (c.field === 'due') return dueTest(c.op, amount, unit, date, toDay(now))
  const at = (i: Issue): number | null => {
    const v = c.field === 'created' ? i.createdAt : c.field === 'updated' ? i.updatedAt : i.completedAt
    const t = v ? Date.parse(v) : NaN
    return Number.isNaN(t) ? null : t
  }
  /** a test on the time, for issues that have one */
  const when = (fits: (t: number) => boolean): Test => (i) => {
    const t = at(i)
    return t !== null && fits(t)
  }
  switch (c.op) {
    case 'within': {
      const from = shift(now, amount, unit, -1).getTime()
      return when((t) => t >= from)
    }
    case 'ago': {
      const before = shift(now, amount, unit, -1).getTime()
      return when((t) => t < before)
    }
    case 'next': {
      const [from, to] = [now.getTime(), shift(now, amount, unit, 1).getTime()]
      return when((t) => t >= from && t <= to)
    }
    case 'overdue':
      return null
    case 'before': {
      const before = fromDay(date).getTime()
      return when((t) => t < before)
    }
    case 'after': {
      const from = fromDay(dayPlus(date, 1)).getTime()
      return when((t) => t >= from)
    }
    case 'empty':
      return (i) => at(i) === null
    case 'set':
      return (i) => at(i) !== null
  }
}

/** the same for a due date, a plain day */
function dueTest(op: DateOp, amount: number, unit: DateUnit, date: string, today: string): Test {
  const on = (fits: (d: string) => boolean): Test => (i) => {
    const d = i.dueDate
    return !!d && fits(d)
  }
  switch (op) {
    case 'within': {
      const from = shiftDay(today, amount, unit, -1)
      return on((d) => d >= from && d <= today)
    }
    case 'ago': {
      const before = shiftDay(today, amount, unit, -1)
      return on((d) => d < before)
    }
    case 'next': {
      const to = shiftDay(today, amount, unit, 1)
      return on((d) => d >= today && d <= to)
    }
    case 'overdue':
      return on((d) => d < today)
    case 'before':
      return on((d) => d < date)
    case 'after':
      return on((d) => d > date)
    case 'empty':
      return (i) => !i.dueDate
    case 'set':
      return (i) => !!i.dueDate
  }
}

/** what each date field is called */
export const DATE_NAMES: Record<DateField, string> = { created: 'Created', updated: 'Updated', completed: 'Completed', due: 'Due date' }

const UNIT_ONE: Record<DateUnit, string> = { hours: 'hour', days: 'day', weeks: 'week', months: 'month' }

/** the unit after an amount: "days", "day", "weeks ago" */
export const unitWord = (unit: DateUnit, amount: number | undefined, ago: boolean) => `${amount === 1 ? UNIT_ONE[unit] : unit}${ago ? ' ago' : ''}`

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

/**
 * A date condition in two parts, the quiet words and what was picked: ["Created in the last", "7 days"],
 * ["Completed before", "Oct 1"], ["Due date", "is overdue"]. `day` writes a day.
 */
export function dateParts(c: DateCondition, day: (d: string) => string = (d) => d): [string, string] {
  const name = DATE_NAMES[c.field]
  if (isRelative(c.op)) return [`${name} ${OP_WORDS[c.op]}`, `${c.amount ?? '?'} ${unitWord(c.unit ?? 'days', c.amount, c.op === 'ago')}`]
  if (c.op === 'before' || c.op === 'after') return [`${name} ${OP_WORDS[c.op]}`, c.date ? day(c.date) : 'a day…']
  return [name, OP_WORDS[c.op]]
}

/** the condition in words: "Completed in the last 1 day", "Due date before Oct 31" */
export const sayDate = (c: DateCondition, day?: (d: string) => string): string => dateParts(c, day).join(' ')
