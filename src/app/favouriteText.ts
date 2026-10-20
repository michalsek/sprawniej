/** What a screen reader hears while a favourite in the sidebar is moved with the keyboard. */
import type { Announcements } from '@dnd-kit/core'

/** `items`: the list as shown */
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
