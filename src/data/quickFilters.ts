/**
 * Quick filters: the side panel's lines (Assignees, Labels, Priority, Projects) that narrow a list with one click. They
 * are a layer of their own, just for the person looking, joined with "and" to the page's filters and their own (on a
 * view: the view's). They are never written into a view by themselves: "Add to view" does that on purpose.
 *
 * Inside one field any picked value is enough ("or"); different fields must all match ("and"). Pure functions, no
 * React and no store (tests/quickFilters.test.ts).
 */
import type { FilterGroup, FilterValue, Filters, Issue } from '@/model/schema'
import { PRIORITY_ORDER } from '@/model/status'
import { isCondition, normalise, storedFilters, treeOf, valueKey } from './filterTree'

/** the fields the side panel offers, in the order of its tabs */
export const PANEL_FIELDS = ['assignees', 'labels', 'priorities', 'projects'] as const
export type PanelField = (typeof PANEL_FIELDS)[number]
export const isPanelField = (v: unknown): v is PanelField => (PANEL_FIELDS as readonly unknown[]).includes(v)

/** what is picked per field: logins (null = no one), label ids, priorities (0 = no priority), project ids (null = none) */
export type QuickFilters = Partial<Record<PanelField, FilterValue[]>>

/** something is picked */
export const hasQuick = (q: QuickFilters): boolean => PANEL_FIELDS.some((f) => !!q[f]?.length)

/** picked or not */
export const isPicked = (q: QuickFilters, field: PanelField, value: FilterValue): boolean => !!q[field]?.some((v) => valueKey(v) === valueKey(value))

/** one pick per tab, like radio buttons: `value` takes the place of what was picked there, or is let go if it was it */
export function toggleQuick(q: QuickFilters, field: PanelField, value: FilterValue): QuickFilters {
  const out: QuickFilters = { ...q }
  if (isPicked(q, field, value)) delete out[field]
  else out[field] = [value]
  return out
}

/** the picks without values that are gone (a label or project a teammate deleted); the same object when none are */
export function withoutGone(q: QuickFilters, known: (field: PanelField, value: FilterValue) => boolean): QuickFilters {
  let changed = false
  const out: QuickFilters = {}
  for (const f of PANEL_FIELDS) {
    const values = q[f]
    if (!values) continue
    const kept = values.filter((v) => known(f, v))
    if (kept.length !== values.length) changed = true
    if (kept.length) out[f] = kept
  }
  return changed ? out : q
}

/** the picks as a filter: one "is" line per field, joined by "and" */
export function quickTree(q: QuickFilters): FilterGroup {
  return { join: 'and', items: PANEL_FIELDS.flatMap((field) => (q[field]?.length ? [{ field, op: 'is' as const, values: [...q[field]] }] : [])) }
}

/**
 * The filter already says what these picks would: an "is" line on the same field at the top of an "and", whose values
 * are all among the picked ones. Every issue it lets through then has one of the picks ("Labels include Bug" and a
 * picked Bug; "Assignee is Ana" and picked Ana or Ben).
 */
export function impliedBy(tree: FilterGroup, field: PanelField, picked: readonly FilterValue[]): boolean {
  if (tree.join !== 'and' && tree.items.length > 1) return false
  const want = new Set(picked.map(valueKey))
  return tree.items.some((n) => isCondition(n) && n.field === field && n.op === 'is' && n.values.length > 0 && n.values.every((v) => want.has(valueKey(v))))
}

/**
 * Your filters (or a view's) with the quick filters on top, as a view keeps them: "Save as view" and "Add to view".
 * Picks the filters already say are left out, and with nothing new to add the same filters come back. Flat filters
 * plus flat quick filters on other fields stay flat, so older versions read them as before.
 */
export function withQuick(own: Filters, q: QuickFilters): Filters {
  const tree = treeOf(own)
  const added = quickTree(q).items.filter((c) => isCondition(c) && !impliedBy(tree, c.field as PanelField, c.values))
  if (!added.length) return own
  return storedFilters(own, normalise({ join: 'and', items: [tree, ...added] }))
}

/** an issue's values for a field, as `valueKey`s: one for most, one per label (none for an issue without labels) */
function keysOf(i: Issue, field: PanelField): string[] {
  switch (field) {
    case 'assignees':
      return [valueKey(i.assignee ?? null)]
    case 'labels':
      return i.labels.map(valueKey)
    case 'priorities':
      return [valueKey(i.priority)]
    case 'projects':
      return [valueKey(i.project ?? null)]
  }
}

export type QuickCounts = Record<PanelField, Map<string, number>>

/**
 * In one pass: the issues the list shows with the quick filters on (`shown`), how many issues each line of each tab
 * would show (`counts`, by `valueKey`), and how many issues there are to filter (`total`).
 *
 * `base` is what the list shows without quick filters (the page's, your own and the tab's filters, and kept issues).
 * `counted` says whether the list really shows an issue (the display can leave out finished ones and sub-issues), so
 * the numbers match the list. Issues in `keep` (just dropped on a hidden column) stay shown whatever is picked.
 * `count: false` (the panel is hidden) leaves the counts empty.
 *
 * Counts look at the other tabs' picks, not their own: with Ana picked under Assignees, Assignees still counts every
 * person (picking Ben too adds his), while Labels counts only Ana's issues. So an issue that fails one field's picks
 * counts only on that field's tab, and one that fails two counts nowhere.
 */
export function splitAndCount(
  base: readonly Issue[],
  q: QuickFilters,
  counted: (i: Issue) => boolean,
  { keep = new Set(), count = true }: { keep?: ReadonlySet<string>; count?: boolean } = {},
): { shown: Issue[]; counts: QuickCounts; total: number } {
  const active = PANEL_FIELDS.flatMap((f) => (q[f]?.length ? [{ field: f, picked: new Set(q[f].map(valueKey)) }] : []))
  const counts: QuickCounts = { assignees: new Map(), labels: new Map(), priorities: new Map(), projects: new Map() }
  const add = (i: Issue, f: PanelField) => {
    const m = counts[f]
    for (const k of keysOf(i, f)) m.set(k, (m.get(k) ?? 0) + 1)
  }
  const shown: Issue[] = []
  let total = 0
  for (const i of base) {
    let failed: PanelField | null = null
    let fails = 0
    for (const a of active) {
      if (keysOf(i, a.field).some((k) => a.picked.has(k))) continue
      failed = a.field
      if (++fails > 1) break
    }
    if (fails === 0 || keep.has(i.id)) shown.push(i)
    if (!counted(i)) continue
    total++
    if (!count) continue
    if (fails === 0) for (const f of PANEL_FIELDS) add(i, f)
    else if (fails === 1 && failed) add(i, failed)
  }
  return { shown, counts, total }
}

/** a value a tab can offer: a person, label, priority or project, with its name */
export interface PanelItem {
  value: FilterValue
  label: string
}

export type PanelLine<I extends PanelItem> = I & { count: number; picked: boolean }

const PRIORITY_RANK = new Map<unknown, number>(PRIORITY_ORDER.map((p, k) => [p, k]))

/**
 * The lines of one tab: the values some issue has, and the picked ones even at 0. Picked ones first (so a picked one
 * at 0 isn't lost at the bottom), then most issues first and by name; Priority keeps its own order after the picked.
 * Someone assigned who isn't among `items` (not loaded, or gone) gets a line from `unknown`.
 */
export function panelLines<I extends PanelItem>(field: PanelField, items: readonly I[], counts: QuickCounts, picks: QuickFilters, unknown: (login: string) => I): PanelLine<I>[] {
  const m = counts[field]
  const all: I[] = [...items]
  if (field === 'assignees') {
    const known = new Set(items.map((i) => valueKey(i.value)))
    const others = new Set([...m.keys(), ...(picks.assignees ?? []).map(valueKey)].filter((k) => !known.has(k)))
    for (const k of others) {
      const login: unknown = JSON.parse(k)
      if (typeof login === 'string') all.push(unknown(login))
    }
  }
  const lines = all.map((i) => ({ ...i, count: m.get(valueKey(i.value)) ?? 0, picked: isPicked(picks, field, i.value) })).filter((l) => l.count > 0 || l.picked)
  const rank = (l: PanelLine<I>) => PRIORITY_RANK.get(l.value) ?? PRIORITY_RANK.size
  return lines.sort(
    (a, b) => Number(b.picked) - Number(a.picked) || (field === 'priorities' ? rank(a) - rank(b) : b.count - a.count || a.label.localeCompare(b.label)),
  )
}

/** the name the browser tab keeps everyone's picks under (sessionStorage); signing out forgets them */
export const QUICK_KEY = 'sprawniej-quick-filters'

/** where a page's picks are kept for the browser tab: per workspace and page ("team:ENG:active", "view:01J…") */
export const quickScope = (workspace: string | undefined, page: string) => `${workspace ?? ''}|${page}`

/** the kept picks with this scope's changed; nothing picked takes the scope out */
export function withPicksAt(kept: Readonly<Record<string, QuickFilters>>, scope: string, picks: QuickFilters): Record<string, QuickFilters> {
  const { [scope]: _, ...rest } = kept
  return hasQuick(picks) ? { ...rest, [scope]: picks } : rest
}
