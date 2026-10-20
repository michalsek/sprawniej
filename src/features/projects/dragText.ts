/** What a screen reader hears while a project is dragged with the keyboard on the board. */
import type { Announcements } from '@dnd-kit/core'
import type { ProjectColumn } from '@/data/select'
import type { Project } from '@/model/schema'
import { columnKey, isColumnId, type ColumnOrder } from '@/features/board/columnsDrag'

export function projectDragAnnouncements(projects: Record<string, Project>, columns: ProjectColumn[], order: ColumnOrder): Announcements {
  const name = (id: string | number) => projects[id]?.name ?? 'Project'
  const columnOf = (id: string | number) => (isColumnId(id) ? columnKey(id) : Object.keys(order).find((k) => order[k].includes(String(id))))
  /** where the card is: the column it is over (dnd-kit tells before the order on screen moves), or, over a hidden status's column, which takes nothing, the one it is in */
  const where = (active: string | number, over: string | number | undefined) => {
    const key = over === undefined ? undefined : columnOf(over)
    const c = columns.find((x) => x.status.id === key && !x.status.hidden) ?? columns.find((x) => x.status.id === columnOf(active))
    return c ? ` in ${c.status.name}` : ''
  }
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}. Use the arrow keys to move it, Space to drop it, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} is now${where(active.id, over.id)}.` : `${name(active.id)} is outside the board.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${name(active.id)}${where(active.id, over.id)}.` : `${name(active.id)} was put back.`),
    onDragCancel: ({ active }) => `${name(active.id)} was put back.`,
  }
}
