/** Moving along a row of choices with the keyboard (src/components/Segmented.tsx). */

/** where an arrow key, Home or End moves from option `at` of `count` (round at the ends), or null for other keys */
export function arrowMove(key: string, at: number, count: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (at + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (at - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
