/**
 * Merging two versions of a text line by line, from the version both started from: changes to different lines both
 * stay, even on neighbouring lines (you tick one item, a teammate the next); where both changed the same line, ours
 * (`ours`) is kept. The editor uses it when a teammate's text arrives while you are typing.
 */
import { diff3Merge } from 'node-diff3'

/** `textConflicts` counts the places where both changed the same lines (ours kept) */
export interface MergeCount {
  conflicts: number
  textConflicts?: number
}

export function mergeText(base: string, ours: string, theirs: string, ctx: MergeCount = { conflicts: 0 }): string {
  if (ours === theirs || theirs === base) return ours
  if (ours === base) return theirs
  const lines = (s: string) => s.split('\n')
  const out: string[] = []
  for (const region of diff3Merge(lines(ours), lines(base), lines(theirs))) {
    if (region.ok) out.push(...region.ok)
    else if (region.conflict) {
      const { a, o, b } = region.conflict
      // lines changed next to each other, none added or taken away: each line on its own
      let clash = a.length !== o.length || b.length !== o.length
      if (clash) out.push(...a)
      else {
        for (let k = 0; k < o.length; k++) {
          if (a[k] === o[k]) out.push(b[k])
          else {
            out.push(a[k])
            if (b[k] !== o[k] && b[k] !== a[k]) clash = true
          }
        }
      }
      if (clash) ctx.textConflicts = (ctx.textConflicts ?? 0) + 1
    }
  }
  return out.join('\n')
}
