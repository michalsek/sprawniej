/**
 * A Linear custom view's filter (its `filterData`) → a Sprawniej filter tree (src/data/filterTree.ts). What comes
 * over, as Linear says it:
 *   - status, assignee, subscribers, priority, labels (with their sub-labels, and "has a label from this group"),
 *     project and team, with "is", "is any of", "is not", "is empty" and "is set";
 *   - "me" (`isMe`), which stays "whoever is looking";
 *   - "and" and "or", across fields and inside one, in groups up to MAX_DEPTH deep;
 *   - created, updated, completed and due dates, counted from now ("-P1D": in the last day) or from a day;
 *   - "assigned to Jan or Jan is subscribed", which here is "Jan follows it" (people follow what they're assigned to).
 * Anything else (cycles, estimates, text search, who created it, …) is left out, and so is a person matched to
 * "No one" ("assigned to Bob" mustn't become "assigned to no one"). Leaving something out of an "and" shows more
 * issues, out of an "or" fewer; either way the view is reported as not exact, so the import can say which views to
 * check. Pure, tested in tests/linearImport.test.ts.
 *
 * What Linear's app saves looks like this (each field holds a list of choices, labels also match their sub-labels):
 *   { and: [{ assignee: { or: [{ id: { in: ['u1'] } }] } },
 *           { labels: { and: [{ or: [{ name: { eq: 'AI' } }, { parent: { name: { eq: 'AI' } } }] }] } },
 *           { state: { type: { nin: ['completed', 'canceled'] } } }, { completedAt: { gt: '-P1D' } }] }
 */
import { dateReady, isDateCondition, mostOf } from '@/data/dateFilters'
import { dayPlus, isDay, toDay } from '@/lib/days'
import { MAX_DEPTH, isCondition, isGroup, normalise, storedFilters, valueKey } from '@/data/filterTree'
import { ME, type DateCondition, type DateField, type DateUnit, type FilterCondition, type FilterField, type FilterGroup, type FilterNode, type FilterValue, type Filters } from '@/model/schema'
import { CATEGORIES, type IssueCategory, type StatusGroup } from '@/model/status'
import { mapStatus } from './linearStatus'
import type { LLabel, LState } from './linearApi'

export interface FilterContext {
  /** workflow states by id */
  states: Map<string, LState>
  /** a Linear user → a login here; undefined = nobody here (unmatched) */
  person: (linearUserId: string) => string | undefined
  /** every Linear label (not just the ones issues use) */
  labels: LLabel[]
  /** a Linear label → its label id here, bringing it over if no issue brought it */
  label: (l: LLabel) => string
  /** a label here with this name (one made here, not from Linear) */
  labelHere: (name: string) => string | undefined
  project: (linearProjectId: string) => string | undefined
  /** a Linear team, by id or by key → a team key here */
  team: (linearTeamIdOrKey: string) => string | undefined
}

export interface MappedFilter {
  /** the filter as a tree (tidy: `normalise`); no items when nothing is left */
  tree: FilterGroup
  /** what the view keeps: the flat keys when they say it exactly, else the tree and the flat keys as a rough copy */
  filters: Filters
  /** every condition came over as it was */
  exact: boolean
  /** the view had conditions, and none of them could come over (it would show everything) */
  nothing: boolean
}

export interface MapOptions {
  /** the view belongs to a team: a "team is" at the top says nothing more, so it's left out */
  teamView?: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * A node; nothing to say (it lets every issue through: `{}`, an empty "or"); something that lets no issue through
 * ("has a label named Area", when Area is only a group); or something that can't come over.
 */
type Out = FilterNode | 'any' | 'none' | 'lost'

/** for a field an issue has one value of (or one per issue, like its labels' set): "is any of" or "is none of" */
type Sel = { op: 'is' | 'not'; values: FilterValue[] } | 'any' | 'lost'

/** Linear's state types → every status here in that group */
const GROUPS: Record<string, StatusGroup> = { triage: 'backlog', backlog: 'backlog', unstarted: 'unstarted', started: 'started', completed: 'completed', canceled: 'canceled' }

/** fields an issue can have several values of */
const MANY: ReadonlySet<string> = new Set(['labels', 'subscribers'])

const has = (list: FilterValue[], v: FilterValue) => list.some((x) => valueKey(x) === valueKey(v))
function unique(values: FilterValue[]): FilterValue[] {
  const out: FilterValue[] = []
  for (const v of values) if (!has(out, v)) out.push(v)
  return out
}
const union = (a: FilterValue[], b: FilterValue[]) => unique([...a, ...b])
const meet = (a: FilterValue[], b: FilterValue[]) => a.filter((v) => has(b, v))
const minus = (a: FilterValue[], b: FilterValue[]) => a.filter((v) => !has(b, v))

/** "is any of" (an empty list matches nothing: fine inside an "or", but no condition here can say it on its own) */
const is = (values: FilterValue[]): Sel => ({ op: 'is', values: unique(values) })
const not = (values: FilterValue[]): Sel => (values.length ? { op: 'not', values: unique(values) } : 'any')

/** two choices on one field, both ("and") or either ("or"); exact for a field an issue has one value of */
function both(a: Sel, b: Sel): Sel {
  if (a === 'any') return b
  if (b === 'any') return a
  if (a === 'lost' || b === 'lost') return 'lost'
  if (a.op === 'is' && b.op === 'is') return is(meet(a.values, b.values))
  if (a.op === 'not' && b.op === 'not') return not(union(a.values, b.values))
  const [p, n] = a.op === 'is' ? [a, b] : [b, a]
  return is(minus(p.values, n.values))
}
function either(a: Sel, b: Sel): Sel {
  if (a === 'any' || b === 'any') return 'any'
  if (a === 'lost' || b === 'lost') return 'lost'
  if (a.op === 'is' && b.op === 'is') return is(union(a.values, b.values))
  if (a.op === 'not' && b.op === 'not') return not(meet(a.values, b.values))
  const [p, n] = a.op === 'is' ? [a, b] : [b, a]
  return not(minus(n.values, p.values))
}
/**
 * Whether working out two choices needs to know who Me is: one names Me, the two name someone else too, and they
 * aren't simply added up (an "or" of two "is", an "and" of two "is not")
 */
function meMatters(how: 'and' | 'or', a: Sel, b: Sel): boolean {
  if (a === 'any' || a === 'lost' || b === 'any' || b === 'lost') return false
  if ((how === 'or' && a.op === 'is' && b.op === 'is') || (how === 'and' && a.op === 'not' && b.op === 'not')) return false
  const values = [...a.values, ...b.values]
  return values.includes(ME) && values.some((v) => typeof v === 'string' && v !== ME)
}

const flip = (s: Sel): Sel => (s === 'any' || s === 'lost' ? 'lost' : s.op === 'is' ? not(s.values) : is(s.values))

/** a relative time, "-P1D" (a day ago), "P2W" (in two weeks), "-PT12H"; `sign` 0 is now */
interface Rel {
  amount: number
  unit: DateUnit
  sign: -1 | 0 | 1
}

const DURATION = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

/** Linear's ISO-8601 durations: "-P1D", "P-2W" too, "P1M", "-PT1H"; null when it isn't one, or mixes months with days */
export function duration(v: unknown): Rel | null {
  if (typeof v !== 'string') return null
  let s = v.trim().toUpperCase()
  let sign: -1 | 1 = 1
  if (s.startsWith('-')) [sign, s] = [-1, s.slice(1)]
  else if (s.startsWith('P-')) [sign, s] = [-1, `P${s.slice(2)}`]
  const m = DURATION.exec(s)
  if (!m || s === 'P' || s.endsWith('T')) return null
  const [y, mo, w, d, h, mi, se] = m.slice(1).map((x) => Number(x ?? 0))
  const months = y * 12 + mo
  const seconds = (((w * 7 + d) * 24 + h) * 60 + mi) * 60 + se
  if (months && seconds) return null
  const at = (amount: number, unit: DateUnit): Rel => ({ amount, unit, sign: amount ? sign : 0 })
  if (months) return at(months, 'months')
  if (seconds % 3600) return null
  if (h || seconds % 86400) return at(seconds / 3600, 'hours')
  if (!d && w) return at(w, 'weeks')
  return at(seconds / 86400, 'days')
}

/**
 * A day Linear names. A plain day ("2026-10-01") is that day, as written. A time is the day it falls on here (in the
 * time zone of whoever imports), for due dates too: an import in Warsaw reads 2026-09-30T22:00:00Z as the start of
 * Oct 1. `start`: it's the very start of that day, so "before" and "after" say it exactly.
 */
function dayIn(v: unknown): { day: string; start: boolean } | null {
  if (typeof v !== 'string') return null
  const text = v.trim()
  const m = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text)
  if (!m || !isDay(m[1])) return null
  if (!m[2]) return { day: m[1], start: true }
  const t = new Date(text)
  if (Number.isNaN(t.getTime())) return null
  return { day: toDay(t), start: t.getHours() === 0 && t.getMinutes() === 0 && t.getSeconds() === 0 && t.getMilliseconds() === 0 }
}

const LINEAR_DATES: Record<string, DateField> = { createdAt: 'created', updatedAt: 'updated', completedAt: 'completed', dueDate: 'due' }

export function mapViewFilter(filterData: unknown, ctx: FilterContext, options: MapOptions = {}): MappedFilter {
  let exact = true
  const lose = () => {
    exact = false
  }

  /** nodes joined by "and" or "or": what can't come over goes (and the view isn't exact) */
  const group = (join: 'and' | 'or', outs: Out[]): Out => {
    const nodes: FilterNode[] = []
    let lost = false
    let none = false
    for (const o of outs) {
      if (o === 'lost') lost = true
      // one choice that lets everything through: so does the whole "or"; one that lets nothing through: the "and"
      else if (o === 'any') {
        if (join === 'or') return 'any'
      } else if (o === 'none') {
        if (join === 'and') return 'none'
        none = true
      } else nodes.push(o)
    }
    if (lost) lose()
    if (!nodes.length) return lost ? 'lost' : none ? 'none' : 'any'
    return nodes.length === 1 ? nodes[0] : { join, items: nodes }
  }

  /** a choice on a field as a condition */
  const condition = (field: FilterField, s: Sel): Out => (s === 'any' || s === 'lost' ? s : s.values.length ? { field, op: s.op, values: s.values } : 'none')

  /** Linear values → ours; one that can't be turned is left out (and the view isn't exact); `failed`: some were */
  const convert = (values: unknown[], one: (v: unknown) => FilterValue | FilterValue[] | undefined): { values: FilterValue[]; failed: boolean } => {
    const res: FilterValue[] = []
    let failed = false
    for (const v of values) {
      const r = v === null ? null : one(v)
      if (r === undefined) {
        lose()
        failed = true
      } else res.push(...(Array.isArray(r) ? r : [r]))
    }
    return { values: res, failed }
  }

  type Turn = (v: unknown) => FilterValue | FilterValue[] | undefined
  /**
   * { eq: x }, { in: [x, y] }, { neq: x }, { nin: [x] }, { null: true }: what they allow, the values turned by `turn`.
   * A "not" whose values can't come over at all is left out (it would say nothing), and noted.
   */
  const comparator = (cmp: unknown, turn: Turn): Sel => {
    if (!isObj(cmp)) return 'lost'
    let out: Sel = 'any'
    let known = false
    for (const [k, v] of Object.entries(cmp)) {
      const list = k === 'in' || k === 'nin' ? (Array.isArray(v) ? v : null) : [v]
      let s: Sel
      if (k === 'null') s = v === true ? is([null]) : v === false ? not([null]) : 'lost'
      else if (!list) s = 'lost'
      else if (k === 'eq' || k === 'in') {
        // "assigned to Bob", with Bob matched to no one, can't come over: it isn't "assigned to nobody"
        const { values, failed } = convert(list, turn)
        s = !values.length && failed ? 'lost' : is(values)
      } else if (k === 'neq' || k === 'nin') s = not(convert(list, turn).values)
      else s = 'lost'
      if (s === 'lost') lose()
      else [out, known] = [both(out, s), true]
    }
    // nothing in it came over: it can't stand for "anything" (in an "or" that would let every issue through)
    return known || !Object.keys(cmp).length ? out : 'lost'
  }

  /**
   * Two choices on one field together. Me may be one of the people named, which nobody knows until someone looks:
   * "Me and not Ana" can't be worked out to one line, so it's worked out as if they were different, and not exact.
   */
  const join = (how: 'and' | 'or', a: Sel, b: Sel): Sel => {
    if (meMatters(how, a, b)) lose()
    return how === 'and' ? both(a, b) : either(a, b)
  }

  /** a filter on one thing (a user, a state, a label…): its properties, and "and" / "or" of such filters */
  type Props = Record<string, (v: unknown) => Sel>
  const select = (f: unknown, props: Props): Sel => {
    if (!isObj(f)) return 'lost'
    let out: Sel = 'any'
    let known = false
    for (const [k, v] of Object.entries(f)) {
      let s: Sel
      if ((k === 'and' || k === 'or') && Array.isArray(v)) {
        const parts = v.map((x) => select(x, props))
        const kept = parts.filter((p) => p !== 'lost')
        if (kept.length < parts.length) lose()
        s = !kept.length ? (parts.length ? 'lost' : 'any') : kept.slice(1).reduce<Sel>((a, b) => join(k, a, b), kept[0])
      } else s = props[k] ? props[k](v) : 'lost'
      if (s === 'lost') lose()
      else [out, known] = [join('and', out, s), true]
    }
    return known || !Object.keys(f).length ? out : 'lost'
  }

  // ---- what each field's values turn into ----
  const person: Turn = (v) => (typeof v === 'string' ? ctx.person(v) : undefined)
  const linearLabelsWhere = (match: (l: LLabel) => boolean) => ctx.labels.filter((l) => !l.isGroup && match(l)).map(ctx.label)
  const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : undefined)
  /** "is me" ({ eq: true }) and "is not me" */
  const meProp = (v: unknown): Sel => {
    if (!isObj(v) || Object.keys(v).length !== 1) return 'lost'
    const yes = 'eq' in v ? v.eq : 'neq' in v ? !v.neq : undefined
    return yes === true ? is([ME]) : yes === false ? not([ME]) : 'lost'
  }
  const userProps: Props = { id: (v) => comparator(v, person), isMe: meProp }
  const nullProp = (v: unknown): Sel => (v === true ? is([null]) : v === false ? not([null]) : 'lost')

  const stateTurn = {
    id: (v: unknown) => {
      const state = typeof v === 'string' ? ctx.states.get(v) : undefined
      return state ? mapStatus(state) : undefined
    },
    name: (v: unknown) => {
      if (typeof v !== 'string') return undefined
      const state = [...ctx.states.values()].find((s) => s.name.toLowerCase() === v.toLowerCase())
      return mapStatus(state ?? { name: v, type: '' })
    },
    type: (v: unknown): IssueCategory[] | undefined => (typeof v === 'string' && GROUPS[v] ? CATEGORIES.filter((s) => s.group === GROUPS[v]).map((s) => s.id) : undefined),
  }
  const labelProps: Props = {
    id: (v) => comparator(v, (x) => (typeof x === 'string' && ctx.labels.some((l) => l.id === x && !l.isGroup) ? linearLabelsWhere((l) => l.id === x) : undefined)),
    name: (v) =>
      comparator(v, (x) => {
        const found = linearLabelsWhere((l) => l.name.toLowerCase() === lower(x))
        const here = typeof x === 'string' ? ctx.labelHere(x) : undefined
        const all = [...new Set([...found, ...(here ? [here] : [])])]
        // a group's own name matches no issue; its sub-labels come in through "parent"
        const isGroupName = ctx.labels.some((l) => l.isGroup && l.name.toLowerCase() === lower(x))
        return all.length || isGroupName ? all : undefined
      }),
    // "a label from this group": { parent: { name: { eq: 'Area' } } }
    parent: (v) =>
      select(v, {
        id: (cmp) => positive(comparator(cmp, (x) => linearLabelsWhere((l) => l.parent?.id === x))),
        name: (cmp) => positive(comparator(cmp, (x) => linearLabelsWhere((l) => !!l.parent && l.parent.name.toLowerCase() === lower(x)))),
      }),
  }
  /** "its group is not Area" also lets through labels with no group, which can't be said here */
  const positive = (s: Sel): Sel => (s !== 'any' && s !== 'lost' && s.op === 'not' ? 'lost' : s)

  /**
   * A collection (labels, subscribers): "has one that…" (`some`, or the properties right on it), "has none that…"
   * (`none`), "all of them are not…" (`every`), and "and" / "or" of such. Each "has one" is a condition of its own,
   * as two labels may meet two of them.
   */
  const collection = (field: 'labels' | 'subscribers', f: unknown, props: Props): Out => {
    if (!isObj(f)) return 'lost'
    const outs: Out[] = Object.entries(f).map(([k, v]) => {
      if ((k === 'and' || k === 'or') && Array.isArray(v)) return group(k, v.map((x) => collection(field, x, props)))
      // "has one that isn't Bug" isn't "doesn't have Bug"
      if (k === 'some') return condition(field, positive(select(v, props)))
      if (k === 'none') return condition(field, flip(positive(select(v, props))))
      // "every one isn't Bug" is "doesn't have Bug"
      if (k === 'every') {
        const s = select(v, props)
        return s !== 'any' && s !== 'lost' && s.op === 'not' ? condition(field, s) : 'lost'
      }
      return condition(field, positive(select({ [k]: v }, props)))
    })
    return group('and', outs)
  }

  /**
   * A date: from now ("-P1D") or a day ("2026-10-01"), each comparison its own line, all of them together. Only lines
   * the builder can show come over; "before" and "after" are to the day, and "in the next 7 days" takes in the 7th.
   */
  const dates = (field: DateField, cmp: unknown): Out => {
    if (!isObj(cmp)) return 'lost'
    const due = field === 'due'
    /** a line, if it's one the builder can show */
    const c = (op: DateCondition['op'], more: Partial<DateCondition> = {}): Out => {
      const line: DateCondition = { field, op, ...more }
      return isDateCondition(line) && dateReady(line) ? line : 'lost'
    }
    const anyOf = (...items: Out[]): Out => group('or', items)
    const outs = Object.entries(cmp).map(([k, v]): Out => {
      if (k === 'null') return v === true ? c('empty') : v === false ? c('set') : 'lost'
      if (!['gt', 'gte', 'lt', 'lte', 'eq'].includes(k)) return 'lost'
      const later = k === 'gt' || k === 'gte'
      const rel = duration(v)
      if (rel) {
        if (k === 'eq') return 'lost'
        const span = { amount: rel.amount, unit: rel.unit }
        if (!due) {
          if (later) return rel.sign < 0 ? c('within', span) : 'lost'
          if (rel.sign < 0) return c('ago', span)
          // a time is never in the future: "earlier than in a week" is any time at all
          return field === 'completed' ? c('set') : 'any'
        }
        // a due date is a day: hours only as whole days
        const days = rel.unit === 'hours' ? (rel.amount % 24 ? null : rel.amount / 24) : rel.unit === 'days' ? rel.amount : rel.unit === 'weeks' ? rel.amount * 7 : null
        if (later) {
          // later than a week ago: due in the last week, or from today on (the next ten years, as far as a line goes)
          const ahead = c('next', { amount: mostOf('days'), unit: 'days' })
          // later than in a week: no line starts a week from now
          if (rel.sign > 0) return 'lost'
          // from today on; later than today starts tomorrow, which "in the next" (today too) only comes near
          if (rel.sign === 0) {
            if (k === 'gt') lose()
            return ahead
          }
          if (days === null) {
            // months: "in the last month" takes in its first day, as "from a month ago" does, but "later than" doesn't
            if (k === 'gt') lose()
            return anyOf(c('within', span), ahead)
          }
          // later than 3 days ago is from 2 days ago on
          const back = k === 'gt' ? days - 1 : days
          return back < 1 ? ahead : anyOf(c('within', { amount: back, unit: 'days' }), ahead)
        }
        // "earlier than" is "up to the day before"; "up to" (lte) is that day too
        const upTo = k === 'lte'
        if (rel.sign === 0) {
          if (!upTo) return c('overdue')
          // overdue or due today: this says tomorrow too
          lose()
          return anyOf(c('overdue'), c('next', { amount: 1, unit: 'days' }))
        }
        if (rel.sign > 0) {
          if (days === null) {
            // a month on: "in the next month" takes in its last day too, which "earlier than" doesn't
            if (!upTo) lose()
            return anyOf(c('overdue'), c('next', span))
          }
          const n = upTo ? days : days - 1
          if (n < 1) {
            lose()
            return anyOf(c('overdue'), c('next', { amount: 1, unit: 'days' }))
          }
          return anyOf(c('overdue'), c('next', upTo && rel.unit === 'weeks' ? span : { amount: n, unit: 'days' }))
        }
        // in the past: "earlier than 3 days ago"; "up to 3 days ago" is "earlier than 2 days ago"
        if (!upTo) return c('ago', rel.unit === 'hours' && days ? { amount: days, unit: 'days' } : span)
        if (days === null) {
          lose()
          return c('ago', span)
        }
        return days - 1 < 1 ? c('overdue') : c('ago', { amount: days - 1, unit: 'days' })
      }
      const at = dayIn(v)
      if (!at) return 'lost'
      if (!at.start) lose()
      const day = at.day
      if (due) {
        if (k === 'eq') return group('and', [c('after', { date: dayPlus(day, -1) }), c('before', { date: dayPlus(day, 1) })])
        if (k === 'gt') return c('after', { date: day })
        if (k === 'gte') return c('after', { date: dayPlus(day, -1) })
        if (k === 'lt') return c('before', { date: day })
        return c('before', { date: dayPlus(day, 1) })
      }
      // a time: "on Oct 1" is near enough for one moment of it
      if (k === 'eq') {
        lose()
        return group('and', [c('after', { date: dayPlus(day, -1) }), c('before', { date: dayPlus(day, 1) })])
      }
      // from the start of the day it falls on, or up to the start of it (the end, when it's later in that day)
      return later ? c('after', { date: dayPlus(day, -1) }) : c('before', { date: at.start ? day : dayPlus(day, 1) })
    })
    return group('and', outs)
  }

  const FIELDS: Record<string, (f: unknown) => Out> = {
    state: (f) =>
      condition(
        'statuses',
        select(f, {
          id: (v) => comparator(v, stateTurn.id),
          name: (v) => comparator(v, stateTurn.name),
          type: (v) => comparator(v, stateTurn.type),
        }),
      ),
    assignee: (f) => condition('assignees', select(f, { ...userProps, null: nullProp })),
    subscribers: (f) => collection('subscribers', f, userProps),
    priority: (f) =>
      condition(
        'priorities',
        select(f, {
          ...Object.fromEntries(['eq', 'in', 'neq', 'nin'].map((k) => [k, (v: unknown) => comparator({ [k]: v }, (x) => (typeof x === 'number' && x >= 0 && x <= 4 ? x : undefined))])),
          // "more urgent than", as numbers: Linear's 0 is "no priority"
          ...Object.fromEntries(
            (['lt', 'lte', 'gt', 'gte'] as const).map((k) => [
              k,
              (v: unknown) =>
                typeof v === 'number' ? is([0, 1, 2, 3, 4].filter((p) => (k === 'lt' ? p < v : k === 'lte' ? p <= v : k === 'gt' ? p > v : p >= v))) : 'lost',
            ]),
          ),
        }),
      ),
    labels: (f) => collection('labels', f, labelProps),
    project: (f) => condition('projects', select(f, { id: (v) => comparator(v, (x) => (typeof x === 'string' ? ctx.project(x) : undefined)), null: nullProp })),
    team: (f) => {
      const one: Turn = (x) => (typeof x === 'string' ? ctx.team(x) : undefined)
      return condition('teams', select(f, { id: (v) => comparator(v, one), key: (v) => comparator(v, one) }))
    },
    ...Object.fromEntries(Object.entries(LINEAR_DATES).map(([k, field]) => [k, (f: unknown) => dates(field, f)])),
  }

  /**
   * "Assigned to Jan, or Jan is subscribed": here people follow what they're assigned to, so that's "Jan follows it",
   * which older versions can read too. With other people on each side it stays an "or".
   */
  const personOr = (items: unknown[], outs: Out[]): Out | undefined => {
    const only = items.every((x) => isObj(x) && Object.keys(x).length === 1 && ('assignee' in x || 'subscribers' in x))
    // an assignee side and a subscribers side; two assignee lines are an ordinary "or"
    const sides = items.some((x) => isObj(x) && 'assignee' in x) && items.some((x) => isObj(x) && 'subscribers' in x)
    const conds = outs.filter((o): o is FilterCondition => isCondition(o) && o.op === 'is' && (o.field === 'assignees' || o.field === 'subscribers'))
    if (!only || !sides || conds.length !== outs.length || conds.some((x) => has(x.values, null))) return undefined
    const first = conds[0].values
    if (!conds.every((x) => x.values.length === first.length && meet(x.values, first).length === first.length)) return undefined
    return { field: 'subscribers', op: 'is', values: first }
  }

  const walk = (f: unknown): Out => {
    if (!isObj(f)) return 'lost'
    const outs = Object.entries(f).map(([k, v]): Out => {
      if ((k === 'and' || k === 'or') && Array.isArray(v)) {
        const parts = v.map(walk)
        return (k === 'or' && personOr(v, parts)) || group(k, parts)
      }
      return FIELDS[k] ? FIELDS[k](v) : 'lost'
    })
    return group('and', outs)
  }

  const top = walk(filterData)
  // a view that shows no issue at all can't be said here either
  if (top === 'lost' || top === 'none') lose()
  let tree: FilterGroup = typeof top === 'string' ? { join: 'and', items: [] } : isGroup(top) ? top : { join: 'and', items: [top] }
  tree = normalise(cut(normalise(simplify(normalise(tree))), 1, lose))
  // with one line or none, "or" and "and" are the same
  if (tree.items.length <= 1) tree = { ...tree, join: 'and' }
  const nothing = !tree.items.length && !exact
  if (options.teamView && (tree.join === 'and' || tree.items.length <= 1)) {
    tree = normalise({ ...tree, items: tree.items.filter((n) => !(isCondition(n) && n.field === 'teams' && n.op === 'is')) })
  }
  return { tree, filters: storedFilters({}, tree), exact, nothing }
}

/**
 * Conditions on the same field in one group, said as one where that means the same: "is A" or "is B" is "is A or
 * B"; "is not A" and "is not B" is "is not A or B"; for a field an issue has one value of, any mix of them.
 */
function simplify(g: FilterGroup): FilterGroup {
  const items = g.items.map((n) => (isGroup(n) ? simplify(n) : n))
  const out: FilterNode[] = []
  const done = new Set<FilterNode>()
  for (const n of items) {
    if (done.has(n)) continue
    if (!isCondition(n) || n.statusIds) {
      out.push(n)
      continue
    }
    const fits = (x: FilterNode): x is FilterCondition => isCondition(x) && !x.statusIds && x.field === n.field
    const many = MANY.has(n.field)
    // labels: "has A" or "has B" is "has A or B", and "doesn't have A" and "doesn't have B" is "has neither"
    const joinable = (x: FilterCondition) => !many || x.op === (g.join === 'or' ? 'is' : 'not')
    const same = items.filter((x): x is FilterCondition => fits(x) && joinable(x))
    if (same.length < 2 || !same.includes(n)) {
      out.push(n)
      continue
    }
    const sels = same.map((x): Sel => ({ op: x.op, values: x.values }))
    // Me may be one of the people named: such lines stay as they are
    if (sels.some((a) => sels.some((b) => meMatters(g.join, a, b)))) {
      out.push(n)
      continue
    }
    const sel = sels.reduce(g.join === 'and' ? both : either)
    if (sel === 'any' || sel === 'lost' || !sel.values.length) {
      out.push(n)
      continue
    }
    same.forEach((x) => done.add(x))
    out.push({ ...n, op: sel.op, values: sel.values })
  }
  return { ...g, items: out }
}

/** groups deeper than MAX_DEPTH can't be kept: they go, and the view isn't exact */
function cut(g: FilterGroup, depth: number, lose: () => void): FilterGroup {
  const items: FilterNode[] = []
  for (const n of g.items) {
    if (!isGroup(n)) items.push(n)
    else if (depth + 1 > MAX_DEPTH) lose()
    else items.push(cut(n, depth + 1, lose))
  }
  return { ...g, items }
}
