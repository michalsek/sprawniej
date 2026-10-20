/**
 * Your favourites: the projects and views you starred, in your own order (the store keeps them sorted). Pure, so it
 * can be tested; the actions that change them are in actions.ts.
 *
 * A favourite can name something that isn't here: deleted a moment ago (its own deletion is on the way), or of a kind
 * a newer app knows. Those never show.
 */
import type { Announcements } from '@dnd-kit/core'
import { keyBetween } from './ordering'
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

/** the order key that puts `id` at `toIndex` of `list` (the list as shown); null when it doesn't move */
export function placeAt(list: readonly Pick<Favourite, 'id' | 'sortOrder'>[], id: string, toIndex: number): string | null {
  const from = list.findIndex((f) => f.id === id)
  const rest = list.filter((f) => f.id !== id)
  const at = Math.max(0, Math.min(toIndex, rest.length))
  if (from < 0 || at === from) return null
  return keyBetween(rest[at - 1]?.sortOrder ?? null, rest[at]?.sortOrder ?? null)
}

/** what a screen reader hears while a favourite is moved with the keyboard; `items`: the list as shown */
export function moveText(items: readonly { id: string; name: string }[]): Announcements {
  const name = (id: string | number) => items.find((f) => f.id === String(id))?.name ?? 'Favourite'
  const place = (id: string | number) => `${items.findIndex((f) => f.id === String(id)) + 1} of ${items.length}`
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}. Use the arrow keys to move it, Space to drop it, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} is now number ${place(over.id)}.` : `${name(active.id)} is outside the list.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${name(active.id)} at number ${place(over.id)}.` : `${name(active.id)} was put back.`),
    onDragCancel: ({ active }) => `${name(active.id)} was put back.`,
  }
}
