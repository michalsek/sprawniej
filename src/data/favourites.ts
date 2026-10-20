/**
 * Your favourites: the projects and views you starred, in your own order (the store keeps them sorted). Pure, so it
 * can be tested; the actions that change them are in actions.ts.
 *
 * A favourite can name something that isn't here: deleted a moment ago (its own deletion is on the way), or of a kind
 * a newer app knows. Those never show.
 */
import { keyBetween, keysBetween } from './ordering'
import type { DataState } from './store'
import type { Favourite, FavouriteKind } from '@/model/schema'

type Starrable = Pick<DataState, 'favourites' | 'projects' | 'views'>

/** the project or view a favourite stars, when it's here */
export function starred(s: Pick<DataState, 'projects' | 'views'>, f: Pick<Favourite, 'id' | 'kind'>): { name: string; emoji: string } | undefined {
  return f.kind === 'project' ? s.projects[f.id] : f.kind === 'view' ? s.views[f.id] : undefined
}

/** the favourites to list: their project or view is here; in your order */
export function visibleFavourites(s: Starrable): Favourite[] {
  return s.favourites.filter((f) => starred(s, f))
}

/** the ids of visibleFavourites, for a selector that redraws only when they change (useShallow) */
export const favouriteIds = (s: Starrable): string[] => visibleFavourites(s).map((f) => f.id)

export const isFavourite = (s: Pick<DataState, 'favourites'>, id: string): boolean => s.favourites.some((f) => f.id === id)

/** what a new favourite is: a project or a view, by its id */
export function kindOf(s: Pick<DataState, 'projects' | 'views'>, id: string): FavouriteKind | undefined {
  return s.projects[id] ? 'project' : s.views[id] ? 'view' : undefined
}

/** the order key that puts a new favourite at the bottom */
export const endKey = (list: readonly Pick<Favourite, 'sortOrder'>[]): string => keyBetween(list.at(-1)?.sortOrder ?? null, null)

/**
 * The new order keys that put `id` at `toIndex` of `list` (the list as shown, sorted by key): its own first, and
 * usually only that. Where the neighbours share a key (starred in two tabs at once), no key fits between them, so the
 * ones after it that share the key get new keys too. Null when it doesn't move.
 */
export function placeAt(list: readonly Pick<Favourite, 'id' | 'sortOrder'>[], id: string, toIndex: number): { id: string; sortOrder: string }[] | null {
  const from = list.findIndex((f) => f.id === id)
  const rest = list.filter((f) => f.id !== id)
  const at = Math.max(0, Math.min(toIndex, rest.length))
  if (from < 0 || at === from) return null
  const lo = rest[at - 1]?.sortOrder ?? null
  let end = at
  while (lo !== null && end < rest.length && rest[end].sortOrder <= lo) end++
  const tied = rest.slice(at, end)
  const keys = keysBetween(lo, rest[end]?.sortOrder ?? null, 1 + tied.length)
  return [{ id, sortOrder: keys[0] }, ...tied.map((f, n) => ({ id: f.id, sortOrder: keys[n + 1] }))]
}
