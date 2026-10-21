/**
 * Filters as a tree: conditions ("Status is In Progress or In Review", "Labels don't include Bug") joined by "and" or
 * "or", in groups up to three levels deep. Pure functions, no React and no store (tests/filterTree.test.ts).
 *
 * How it's stored (a view's `filters`): a filter the old flat keys can say exactly is stored as those keys only, so
 * older versions of the app read it as they always did. Anything else is stored as `tree`, plus the flat keys as a
 * rougher copy for older versions: it may show them more issues, never fewer (`storedFilters`).
 *
 * A condition or group this version can't read (a newer one wrote it) is left out of matching, and kept as it is.
 */
import type { Comment, FilterCondition, FilterField, FilterGroup, FilterNode, FilterValue, Filters, Issue, Person, Project, Status } from '@/model/schema'
import { ME, isFilterField } from '@/model/schema'
import { equal } from '@/lib/equal'
import { CATEGORIES, TAB_GROUPS, type IssueCategory, type IssueTab } from '@/model/status'
import { followers } from './notify'
import { matchesStatus, statusOfProject } from './statuses'

/** groups go this deep: the whole filter, a group in it, and a group in that */
export const MAX_DEPTH = 3

/** the fields the flat keys can hold, in the order they show */
export const FLAT_FIELDS = ['statuses', 'assignees', 'subscribers', 'priorities', 'labels', 'projects', 'teams'] as const satisfies readonly FilterField[]
type FlatField = (typeof FLAT_FIELDS)[number]
const isFlatField = (v: unknown): v is FlatField => (FLAT_FIELDS as readonly unknown[]).includes(v)

/** fields an issue can have several values of: "Labels include Bug" and "Labels include Design" can both be true */
const MANY: ReadonlySet<FilterField> = new Set(['labels', 'subscribers'])

/** one value as a string, to compare values of any kind ("1" and 1 are different) */
export const valueKey = (v: unknown) => JSON.stringify(v)

/** what the app calls a condition or group it can't read */
export const NEWER_FILTER = 'a filter from a newer version'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function isGroup(n: unknown): n is FilterGroup {
  return isObject(n) && (n.join === 'and' || n.join === 'or') && Array.isArray(n.items)
}

/** a condition this version understands (a Status refinement that isn't a list of ids makes it one it doesn't) */
export function isCondition(n: unknown): n is FilterCondition & { field: FilterField } {
  if (!isObject(n) || !isFilterField(n.field) || (n.op !== 'is' && n.op !== 'not') || !Array.isArray(n.values)) return false
  return n.statusIds === undefined || (Array.isArray(n.statusIds) && n.statusIds.every((x) => typeof x === 'string'))
}

/** the condition looking at another field: no values yet, and no Status refinement */
export const withField = (c: FilterCondition, field: FilterField): FilterCondition => ({ ...c, field, values: [], statusIds: undefined })

/** fields a newer version put on a node: such a node can't be rewritten in another shape without losing them */
const hasMore = (n: Record<string, unknown>, known: readonly string[]) => Object.keys(n).some((k) => !known.includes(k) && n[k] !== undefined)
const GROUP_KEYS = ['join', 'items']
const CONDITION_KEYS = ['field', 'op', 'values', 'statusIds']

/** "or" with a single item means the same as "and" */
const allMustMatch = (g: FilterGroup) => g.join === 'and' || g.items.length <= 1

function unique(values: FilterValue[]): FilterValue[] {
  const seen = new Set<string>()
  return values.filter((v) => {
    const k = valueKey(v)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** the flat filters as a tree: one "and" group, one "is" condition per field (Status with its `statusIds`) */
export function fromFlat(f: Filters): FilterGroup {
  return {
    join: 'and',
    items: FLAT_FIELDS.flatMap((field) => {
      const values = f[field]
      if (!Array.isArray(values) || !values.length) return []
      const only = field === 'statuses' && f.statusIds?.length ? { statusIds: [...f.statusIds] } : {}
      return [{ field, op: 'is' as const, values: [...values], ...only }]
    }),
  }
}

/** the same filter in the flat keys, or undefined when they can't say it exactly */
export function toFlat(tree: FilterGroup): Filters | undefined {
  if (hasMore(tree, GROUP_KEYS) || !allMustMatch(tree)) return undefined
  const out: Record<string, FilterValue[]> = {}
  for (const n of tree.items) {
    if (!isCondition(n) || hasMore(n, CONDITION_KEYS) || n.op !== 'is' || !isFlatField(n.field)) return undefined
    if (!n.values.length || n.field in out || n.values.includes(ME)) return undefined
    if (n.statusIds && (n.field !== 'statuses' || !Array.isArray(n.statusIds))) return undefined
    out[n.field] = [...n.values]
    if (n.statusIds?.length) out.statusIds = [...n.statusIds]
  }
  return out
}

/**
 * Flat keys that let through every issue the tree lets through (and maybe more), for older versions of the app: the
 * "is" conditions right in a top "and" group. Conditions with Me are left out (an older version can't say "whoever
 * is looking"), and so is a field whose conditions no single issue value could meet together.
 */
export function mirrorOf(tree: FilterGroup): Filters {
  if (!allMustMatch(tree)) return {}
  const out: Partial<Record<FlatField, FilterValue[] | null>> = {}
  for (const n of tree.items) {
    if (!isCondition(n) || n.op !== 'is' || !isFlatField(n.field) || !n.values.length || n.values.includes(ME)) continue
    const before = out[n.field]
    if (before === undefined) out[n.field] = unique(n.values)
    // an issue has one status, so both conditions leave only the statuses they share; with labels, the first
    // condition alone already lets through everything both do
    else if (before && !MANY.has(n.field)) {
      const now = new Set(n.values.map(valueKey))
      const both = before.filter((v) => now.has(valueKey(v)))
      out[n.field] = both.length ? both : null
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v))
}

/**
 * What a view keeps for this tree: only the flat keys when they say it exactly (older versions read it as before),
 * otherwise the tree plus its flat mirror. Other keys already in `prev` (from a newer version) are kept.
 */
export function storedFilters(prev: Filters, tree: FilterGroup): Filters {
  const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => !isFlatField(k) && k !== 'statusIds' && k !== 'tree'))
  const flat = toFlat(tree)
  return flat ? { ...rest, ...flat } : { ...rest, ...mirrorOf(tree), tree }
}

/** the filter as a tree: the stored one when there is one (the flat keys are only its copy then), else the flat keys */
export const treeOf = (f: Filters): FilterGroup => (isGroup(f.tree) ? f.tree : fromFlat(f))

/**
 * The tidy form that's saved: conditions with no values and empty groups go, repeated values go, a group of one is
 * that one item, and a group with the same join as its parent joins it. Nodes this version can't read stay.
 */
export function normalise(tree: FilterGroup): FilterGroup {
  const g = tidy(tree)
  const only = g.items.length === 1 ? g.items[0] : undefined
  return isGroup(only) && !hasMore(g, GROUP_KEYS) ? only : g
}

function tidy(g: FilterGroup): FilterGroup {
  const items: FilterNode[] = []
  const add = (n: FilterNode) => (isGroup(n) && n.join === g.join && !hasMore(n, GROUP_KEYS) ? items.push(...n.items) : items.push(n))
  for (const n of g.items) {
    if (isGroup(n)) {
      const inner = tidy(n)
      if (!inner.items.length) continue
      if (inner.items.length === 1 && !hasMore(inner, GROUP_KEYS)) add(inner.items[0])
      else add(inner)
    } else if (isCondition(n)) {
      const values = unique(n.values)
      const statusIds = n.statusIds && [...new Set(n.statusIds)]
      if (!values.length) continue
      const same = values.length === n.values.length && statusIds?.length === n.statusIds?.length
      items.push(same ? n : { ...n, values, ...(statusIds && { statusIds }) })
    } else items.push(n)
  }
  return { ...g, items }
}

/** how many filters are set: conditions with values, and ones from a newer version */
export function countConditions(tree: FilterGroup): number {
  return tree.items.reduce<number>((n, i) => n + (isGroup(i) ? countConditions(i) : !isCondition(i) || i.values.length ? 1 : 0), 0)
}

/** what some fields need to know besides the issue */
export interface MatchContext {
  /** for Subscribers: who follows an issue depends on its comments and on who is in the workspace */
  comments: Record<string, Comment[]>
  people: Record<string, Person>
  /** for Project status */
  projects?: Record<string, Project>
  /** the workspace's statuses: for Status, which category each belongs to; for Project status, which a project shows */
  statuses?: Record<string, Status>
  /** your login, for Me */
  me?: string
}

type Test = (issue: Issue) => boolean

/**
 * The tree as a test for issues, built once for a whole list. A condition or group that's empty, can't be read, or
 * needs context that wasn't given is left out of its group; a group with nothing left is left out of its own.
 */
export function matcher(tree: FilterGroup, ctx?: MatchContext): Test {
  return compile(tree, ctx) ?? (() => true)
}

function compile(n: unknown, ctx?: MatchContext): Test | null {
  if (isGroup(n)) {
    const tests = n.items.map((i) => compile(i, ctx)).filter((t): t is Test => !!t)
    if (tests.length <= 1) return tests[0] ?? null
    return n.join === 'and' ? (i) => tests.every((t) => t(i)) : (i) => tests.some((t) => t(i))
  }
  if (!isCondition(n)) return null
  const values = n.values.flatMap((v) => (v !== ME ? [v] : ctx?.me ? [ctx.me] : []))
  const test = values.length ? fieldTest(n.field, new Set<unknown>(values), ctx, n.statusIds) : null
  if (!test) return null
  return n.op === 'not' ? (i) => !test(i) : test
}

/** "is any of these" for one field; `statusIds` refines Status, as in the flat filters */
function fieldTest(field: FilterField, set: ReadonlySet<unknown>, ctx?: MatchContext, statusIds?: string[]): Test | null {
  switch (field) {
    case 'statuses': {
      // one of these categories, and of these statuses where `statusIds` names any of that category's; a category
      // this version doesn't know matches nothing, as in the flat filters
      const f = { statuses: [...set].filter((v): v is IssueCategory => typeof v === 'string'), statusIds }
      const statuses = ctx?.statuses ?? {}
      return (i) => matchesStatus(i, f, statuses)
    }
    case 'assignees':
      return (i) => set.has(i.assignee)
    case 'priorities':
      return (i) => set.has(i.priority)
    case 'labels':
      return (i) => i.labels.some((l) => set.has(l))
    case 'projects':
      return (i) => set.has(i.project)
    case 'teams':
      return (i) => set.has(i.team)
    case 'subscribers': {
      if (!ctx) return null
      const { comments, people } = ctx
      return (i) => followers(i, comments[i.id] ?? [], people).some((l) => set.has(l))
    }
    case 'projectStatuses': {
      const projects = ctx?.projects
      if (!projects) return null
      const statuses = ctx?.statuses ?? {}
      // no project, no project status: such an issue never "is" one, and always "is not"
      return (i) => {
        const p = i.project ? projects[i.project] : undefined
        return !!p && set.has(statusOfProject(p, statuses).id)
      }
    }
  }
}

/**
 * A deleted label, project or team comes out of the conditions where other values are left. Where it was the only
 * value the condition stays, so the view keeps showing nothing rather than suddenly everything. Returns the same
 * tree when nothing changed.
 */
export function treeWithout(tree: FilterGroup, field: FilterField, id: string): FilterGroup {
  let changed = false
  const items = tree.items.map((n) => {
    if (isGroup(n)) {
      const next = treeWithout(n, field, id)
      if (next !== n) changed = true
      return next
    }
    if (!isCondition(n) || n.field !== field || !n.values.includes(id)) return n
    const rest = n.values.filter((v) => v !== id)
    if (!rest.length) return n
    changed = true
    return { ...n, values: rest }
  })
  return changed ? { ...tree, items } : tree
}

/**
 * The tree, and only these statuses (Save as view from the Active or Backlog tab keeps what the tab showed). A status
 * condition already at the top shrinks to the statuses both allow; when they share none, both stay (nothing matches,
 * as on the tab).
 */
export function andStatuses(tree: FilterGroup, ids: readonly string[]): FilterGroup {
  const tab: FilterCondition = { field: 'statuses', op: 'is', values: [...ids] }
  if (!allMustMatch(tree)) return { join: 'and', items: [tab, tree] }
  const at = tree.items.findIndex((n) => isCondition(n) && n.field === 'statuses' && n.op === 'is')
  const own = at >= 0 ? (tree.items[at] as FilterCondition) : undefined
  const both = own ? own.values.filter((v) => ids.includes(v as string)) : []
  const items = own && both.length ? tree.items.map((n, k) => (k === at ? { ...own, values: both } : n)) : [...tree.items, tab]
  return { ...tree, join: 'and', items }
}

/**
 * What "Save as view" saves: the page's own filters (except the team, which the view's scope says) and yours, both.
 * A view has no tabs, so the tab you were on (Active, Backlog) becomes a status filter and the view shows the same
 * issues.
 */
export function viewFilters(page: Filters, own: Filters, tab: IssueTab): Filters {
  const both = normalise({ join: 'and', items: [...fromFlat({ ...page, teams: undefined }).items, treeOf(own)] })
  if (tab === 'all') return storedFilters(own, both)
  const inTab = CATEGORIES.filter((c) => TAB_GROUPS[tab].includes(c.group)).map((c) => c.id)
  return storedFilters(own, normalise(andStatuses(both, inTab)))
}

/**
 * What every issue on the list has for sure, in the flat keys: the top "is" conditions of an "and" group, with Me as
 * `me`. A new issue added on the list starts from it.
 */
export function presetFrom(tree: FilterGroup, me?: string): Filters {
  if (!allMustMatch(tree)) return {}
  const out: Record<string, FilterValue[]> = {}
  for (const n of tree.items) {
    if (!isCondition(n) || n.op !== 'is' || !isFlatField(n.field) || n.field in out) continue
    const values = n.values.flatMap((v) => (v !== ME ? [v] : me ? [me] : []))
    if (values.length) out[n.field] = values
  }
  return out
}

/** the whole filter as a sentence ("Status is Todo and (Assignee is Me or Labels include Bug)") */
export function describeTree(tree: FilterGroup, say: (c: FilterCondition & { field: FilterField }) => string): string {
  return tree.items
    .map((n) => (isGroup(n) ? `(${describeTree(n, say)})` : isCondition(n) ? say(n) : NEWER_FILTER))
    .join(` ${tree.join} `)
}

/** nothing to match yet: a condition with no values, or a group of such (only the builder's draft has them) */
const isPending = (n: FilterNode): boolean => (isGroup(n) ? n.items.every(isPending) : isCondition(n) && !n.values.length)

/** how deep the groups go: 1 = no groups inside */
const depthOf = (g: FilterGroup): number => 1 + Math.max(0, ...g.items.filter(isGroup).map(depthOf))

/**
 * A tree as text in which order doesn't count (a group's lines, a line's values, keys): two trees with the same text
 * mean the same. Saved in the simple flat shape, lines come back in a fixed order, not in the order they were added.
 */
function meaningOf(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(meaningOf).join(',')}]`
  if (!isObject(v)) return JSON.stringify(v) ?? 'null'
  // with one line or none, and / or makes no difference
  if (isGroup(v) && v.join === 'or' && v.items.length <= 1) return meaningOf({ ...v, join: 'and' })
  const unordered = (k: string) => (k === 'items' && isGroup(v)) || ((k === 'values' || k === 'statusIds') && isCondition(v))
  const fields = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => {
      const value = v[k]
      const text = unordered(k) && Array.isArray(value) ? `[${value.map(meaningOf).sort().join(',')}]` : meaningOf(value)
      return `${JSON.stringify(k)}:${text}`
    })
  return `{${fields.join(',')}}`
}

/** the lines in a tree that aren't groups (conditions, and nodes this version can't read), in order */
const linesOf = (n: FilterNode): FilterNode[] => (isGroup(n) ? n.items.flatMap(linesOf) : [n])

export interface Aligned {
  tree: FilterGroup
  /** each draft node, and the node that takes its place */
  pairs: [from: FilterNode, to: FilterNode][]
}

/**
 * A teammate's (or another tab's) change, laid over the builder's draft. The result always means what's saved. Where
 * it can, it keeps the draft's shape: its groups (also one that `normalise` lifted, or merged into its parent, when
 * saving), the order of its lines, its conditions with no values yet, and which line is which (`pairs`), so a line
 * stays the same line on screen and its open picker stays open. A finished line is the same line when it's equal, or when it's the only
 * one on its field that changed on both sides; a line the teammate removed goes, and its picker closes.
 *
 * When the draft's shape can't say what's saved (say, the teammate moved lines between groups), the result is the
 * saved tree with the same lines kept, and the draft's unfinished lines in groups are lost; ones at the top stay.
 */
export function alignDraft(draft: FilterGroup, saved: FilterGroup): Aligned {
  // which draft line is which saved line: equal ones first, then the one changed line on a field
  const draftLines = linesOf(draft).filter((n) => !isPending(n))
  const savedLines = linesOf(saved)
  const same = new Map<FilterNode, FilterNode>()
  const taken = new Set<FilterNode>()
  const pair = (d: FilterNode, s: FilterNode) => {
    same.set(d, s)
    taken.add(s)
  }
  for (const d of draftLines) {
    const s = savedLines.find((x) => !taken.has(x) && equal(x, d))
    if (s) pair(d, s)
  }
  for (const d of draftLines) {
    if (same.has(d) || !isCondition(d)) continue
    const onField = (x: FilterNode) => isCondition(x) && x.field === d.field
    const free = savedLines.filter((x) => !taken.has(x) && onField(x))
    if (free.length === 1 && draftLines.filter((x) => !same.has(x) && onField(x)).length === 1) pair(d, free[0])
  }

  // the parents of the saved tree's nodes, to find the group that holds some lines
  const parent = new Map<FilterNode, FilterGroup>()
  const walk = (g: FilterGroup) => {
    for (const n of g.items) {
      parent.set(n, g)
      if (isGroup(n)) walk(n)
    }
  }
  walk(saved)
  const groupsAbove = (n: FilterNode): FilterGroup[] => {
    const p = parent.get(n)
    return p ? [p, ...groupsAbove(p)] : []
  }
  /** the innermost saved group that holds all these saved lines */
  const holder = (lines: FilterNode[]): FilterGroup | undefined => {
    const all = lines.filter((l) => parent.has(l)).map(groupsAbove)
    return all[0]?.find((g) => all.every((c) => c.includes(g)))
  }

  // the draft's shape, with the saved lines in place of its own; a group with two or more finished lines stands for
  // the saved group that holds them, and takes its join
  const pairs: Aligned['pairs'] = [...same]
  // saved group → the outermost draft group standing for it, and what it became (an outer group is done after the
  // groups inside it, so it's the one left here)
  const draftFor = new Map<FilterGroup, { from: FilterGroup; to: FilterGroup }>()
  const rebuild = (g: FilterGroup): FilterGroup => {
    const items: FilterNode[] = []
    for (const n of g.items) {
      if (isPending(n)) items.push(n)
      else if (isGroup(n)) {
        const r = rebuild(n)
        if (r.items.length) items.push(r)
      } else {
        const s = same.get(n)
        if (s) items.push(s)
      }
    }
    const finished = items.filter((n) => !isPending(n))
    const home = finished.length >= 2 ? holder(finished.flatMap(linesOf)) : undefined
    const out = { ...g, join: home?.join ?? g.join, items }
    if (home) draftFor.set(home, { from: g, to: out })
    pairs.push([g, out])
    return out
  }
  const tree = rebuild(draft)

  // lines and groups the teammate added go into the group that stands for theirs, after what comes before them
  const placed = new Set(taken)
  const holds = (n: FilterNode, s: FilterNode): boolean => linesOf(s).some((l) => linesOf(n).includes(l))
  const place = (sg: FilterGroup) => {
    const into = draftFor.get(sg)?.to ?? (sg === saved ? tree : undefined)
    sg.items.forEach((n, k) => {
      if (!into || linesOf(n).some((l) => placed.has(l))) return
      const before = sg.items.slice(0, k).reverse().find((x) => linesOf(x).some((l) => placed.has(l)))
      const after = before ? into.items.findIndex((x) => holds(x, before)) : -1
      into.items.splice(!before ? 0 : after >= 0 ? after + 1 : into.items.length, 0, n)
      linesOf(n).forEach((l) => placed.add(l))
    })
    sg.items.filter(isGroup).forEach(place)
  }
  place(saved)

  if (meaningOf(normalise(tree)) === meaningOf(normalise(saved)) && depthOf(tree) <= Math.max(MAX_DEPTH, depthOf(saved))) return { tree, pairs }
  // the saved tree as it is, with the lines (and groups) that stayed the same, and the unfinished lines at the top
  const top = { ...saved, items: [...saved.items, ...draft.items.filter(isPending)] }
  const kept: Aligned['pairs'] = [...same, [draft, top]]
  for (const [home, { from }] of draftFor) if (home !== saved && from !== draft) kept.push([from, home])
  return { tree: top, pairs: kept }
}
