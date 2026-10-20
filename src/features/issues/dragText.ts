/** What a screen reader hears while an issue is dragged with the keyboard. */
import type { Announcements } from '@dnd-kit/core'
import type { Group } from '@/data/select'
import { issueRef } from '@/data/store'
import type { Issue } from '@/model/schema'
import { columnKey, isColumnId } from '@/features/board/columnsDrag'

export function dragAnnouncements(issues: Record<string, Issue>, groups: Group[], order: Record<string, string[]>): Announcements {
  const name = (id: string | number) => (issues[id] ? issueRef(issues[id]) : 'Issue')
  const where = (id: string | number | undefined) => {
    if (id === undefined) return ''
    const key = isColumnId(id) ? columnKey(id) : Object.keys(order).find((k) => order[k].includes(String(id)))
    const g = groups.find((x) => x.key === key)
    return g ? ` in ${g.title}` : ''
  }
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}. Use the arrow keys to move it, Space to drop it, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} is now${where(over.id)}.` : `${name(active.id)} is outside the list.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${name(active.id)}${where(over.id)}.` : `${name(active.id)} was put back.`),
    onDragCancel: ({ active }) => `${name(active.id)} was put back.`,
  }
}
