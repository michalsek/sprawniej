/**
 * Where a dragged issue lands. Order is a `sortOrder` string per issue (fractional-indexing), so a drop changes only
 * the moved issue: it gets a key between its new neighbours. Dropping into another group also changes the
 * property that group stands for.
 */
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Grouping, Issue } from '@/model/schema'
import type { IssuePatch } from './actions'

/** a key that sorts between `prev` and `next` (either can be missing: top or bottom) */
export function keyBetween(prev: string | null, next: string | null): string {
  // two issues can share a key (merged from two people, or edited by hand); then just go right after `prev`
  if (prev !== null && next !== null && prev >= next) return generateKeyBetween(prev, null)
  return generateKeyBetween(prev, next)
}

/** `n` keys in a row between `prev` and `next`, for several issues dropped together */
export function keysBetween(prev: string | null, next: string | null, n: number): string[] {
  if (prev !== null && next !== null && prev >= next) return generateNKeysBetween(prev, null, n)
  return generateNKeysBetween(prev, next, n)
}

/** what dropping into a group changes; nothing when grouping is off */
export function groupPatch(grouping: Grouping, value: string | number | null): IssuePatch {
  switch (grouping) {
    case 'status':
      return { status: value as Issue['status'] }
    case 'priority':
      return { priority: value as Issue['priority'] }
    case 'assignee':
      return { assignee: value as string | null }
    case 'project':
      return { project: value as string | null }
    case 'none':
      return {}
  }
}

/** only the fields that really change, so a drop in the same group touches nothing but the order */
export function changedOnly(issue: Issue, patch: IssuePatch): IssuePatch {
  const out: IssuePatch = {}
  for (const [k, v] of Object.entries(patch) as [keyof IssuePatch, unknown][]) if (issue[k] !== v) (out as Record<string, unknown>)[k] = v
  return out
}

/**
 * The neighbours that decide a dropped issue's key: the closest issues above and below it at the same level.
 * In a list, sub-issues sit under their parent, so a top-level issue is placed among top-level issues and a
 * sub-issue among its siblings. `ids` is the group's final order with the dropped issue in it.
 */
export function neighbours(ids: string[], moved: string, levelOf: (id: string) => string | null): { prev: string | null; next: string | null } {
  const at = ids.indexOf(moved)
  const level = levelOf(moved)
  let prev: string | null = null
  let next: string | null = null
  for (let i = at - 1; i >= 0; i--) if (levelOf(ids[i]) === level) { prev = ids[i]; break }
  for (let i = at + 1; i < ids.length; i++) if (levelOf(ids[i]) === level) { next = ids[i]; break }
  return { prev, next }
}
