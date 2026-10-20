/** What dropping a project on the board changes (useProjectDrag). Plain, so it is easy to test (tests/projectDrop.test.ts). */

export interface Drop {
  /** the project */
  id: string
  /** the column it was picked up from */
  from: string
  /** the column it is in now, in the order on screen */
  to: string
  /** that column's order at the drop, with the project in it */
  ids: readonly string[]
  /** where it was in `from` before the drag (-1: gone meanwhile) */
  was: number
  /** the column under the pointer or the keyboard at the drop */
  over: string | undefined
  /** columns that take nothing: hidden statuses */
  closed: ReadonlySet<string>
}

/**
 * The move to save, or null for nothing: let go over a hidden status's column (other than the one it is in), the
 * project goes back where it came from; let go where it was, nothing changes.
 */
export function dropMove(d: Drop): { statusId?: string; place: { prev: string | null; next: string | null } } | null {
  if (d.over !== undefined && d.closed.has(d.over) && d.over !== d.to) return null
  const at = d.ids.indexOf(d.id)
  if (at < 0 || (d.from === d.to && at === d.was)) return null
  return { ...(d.from !== d.to && { statusId: d.to }), place: { prev: d.ids[at - 1] ?? null, next: d.ids[at + 1] ?? null } }
}
