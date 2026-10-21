/**
 * What a picker shows for a search, best first. The menus sort it themselves: cmdk's own sorting leaves an item that
 * the previous search had hidden where it was, below the one it already picked, so Enter took the wrong one.
 */
import { plainFilter } from '@/lib/fuzzy'
import { plain } from '@/lib/plain'

/** cmdk's usual matching, except that typing an item's exact keyword ("ENG-1") puts it first, ahead of ENG-12 */
export function pickerScore(label: string, search: string, keywords?: string[]): number {
  const q = plain(search.trim())
  if (q && keywords?.some((k) => plain(k) === q)) return 1
  return plainFilter(label, search, keywords) * 0.99
}

/** the items a search finds, best first (equally good ones in their own order); all of them when nothing is typed */
export function searchItems<T extends { label: string; keywords?: string[] }>(items: T[], search: string): T[] {
  if (!search) return items
  return items
    .map((item, n) => ({ item, n, score: pickerScore(item.label, search, item.keywords) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .map((x) => x.item)
}
