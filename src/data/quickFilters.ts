/**
 * Quick filters: the side panel's rows (Assignees, Labels, Priority, Projects) that narrow a list with one click. They
 * are a layer of their own, just for the person looking, joined with "and" to the page's filters and their own (on a
 * view: the view's). They are never written into a view by themselves: "Add to view" does that on purpose.
 *
 * Inside one field any picked value is enough ("or"); different fields must all match ("and"). Pure functions, no
 * React and no store (tests/quickFilters.test.ts).
 */
import type { FilterGroup, FilterValue, Filters, Issue } from '@/model/schema'
import { normalise, storedFilters, treeOf, valueKey } from './filterTree'

/** the fields the side panel offers, in the order of its tabs */
export const QUICK_FIELDS = ['assignees', 'labels', 'priorities', 'projects'] as const
export type QuickField = (typeof QUICK_FIELDS)[number]
export const isQuickField = (v: unknown): v is QuickField => (QUICK_FIELDS as readonly unknown[]).includes(v)

/** what is picked per field: logins (null = no one), label ids, priorities (0 = no priority), project ids (null = none) */
export type QuickFilters = Partial<Record<QuickField, FilterValue[]>>

/** something is picked */
export const hasQuick = (q: QuickFilters): boolean => QUICK_FIELDS.some((f) => !!q[f]?.length)

/** picked or not */
export const isPicked = (q: QuickFilters, field: QuickField, value: FilterValue): boolean => !!q[field]?.some((v) => valueKey(v) === valueKey(value))

/** `value` picked if it wasn't, let go if it was; a field with nothing picked goes */
export function toggleQuick(q: QuickFilters, field: QuickField, value: FilterValue): QuickFilters {
  const now = q[field] ?? []
  const next = isPicked(q, field, value) ? now.filter((v) => valueKey(v) !== valueKey(value)) : [...now, value]
  const out: QuickFilters = { ...q }
  if (next.length) out[field] = next
  else delete out[field]
  return out
}

/** the picks without values that are gone (a label or project a teammate deleted); the same object when none are */
export function withoutGone(q: QuickFilters, known: (field: QuickField, value: FilterValue) => boolean): QuickFilters {
  let changed = false
  const out: QuickFilters = {}
  for (const f of QUICK_FIELDS) {
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
  return { join: 'and', items: QUICK_FIELDS.flatMap((field) => (q[field]?.length ? [{ field, op: 'is' as const, values: [...q[field]] }] : [])) }
}

/**
 * Your filters (or a view's) with the quick filters on top, as a view keeps them: "Save as view" and "Add to view".
 * Flat filters plus flat quick filters on other fields stay flat, so older versions read them as before.
 */
export function withQuick(own: Filters, q: QuickFilters): Filters {
  if (!hasQuick(q)) return own
  return storedFilters(own, normalise({ join: 'and', items: [treeOf(own), ...quickTree(q).items] }))
}

/** an issue's values for a field, as `valueKey`s: one for most, one per label (none for an issue without labels) */
function keysOf(i: Issue, field: QuickField): string[] {
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

export type QuickCounts = Record<QuickField, Map<string, number>>

/**
 * In one pass: the issues the list shows with the quick filters on (`shown`), and how many issues each row of each
 * tab would show (`counts`, by `valueKey`).
 *
 * `base` is what the list shows without quick filters (the page's, your own and the tab's filters, and kept issues).
 * `counted` says whether the list really shows an issue (the display can leave out finished ones and sub-issues), so
 * the numbers match the list. Issues in `keep` (just dropped on a hidden column) stay shown whatever is picked.
 *
 * Counts look at the other tabs' picks, not their own: with Ana picked under Assignees, Assignees still counts every
 * person (picking Ben too adds his), while Labels counts only Ana's issues. So an issue that fails one field's picks
 * counts only on that field's tab, and one that fails two counts nowhere.
 */
export function splitAndCount(base: readonly Issue[], q: QuickFilters, counted: (i: Issue) => boolean, keep: ReadonlySet<string> = new Set()): { shown: Issue[]; counts: QuickCounts } {
  const active = QUICK_FIELDS.flatMap((f) => (q[f]?.length ? [{ field: f, picked: new Set(q[f].map(valueKey)) }] : []))
  const counts: QuickCounts = { assignees: new Map(), labels: new Map(), priorities: new Map(), projects: new Map() }
  const add = (i: Issue, f: QuickField) => {
    const m = counts[f]
    for (const k of keysOf(i, f)) m.set(k, (m.get(k) ?? 0) + 1)
  }
  const shown: Issue[] = []
  for (const i of base) {
    let failed: QuickField | null = null
    let fails = 0
    for (const a of active) {
      if (keysOf(i, a.field).some((k) => a.picked.has(k))) continue
      failed = a.field
      if (++fails > 1) break
    }
    if (fails === 0 || keep.has(i.id)) shown.push(i)
    if (!counted(i)) continue
    if (fails === 0) for (const f of QUICK_FIELDS) add(i, f)
    else if (fails === 1 && failed) add(i, failed)
  }
  return { shown, counts }
}
