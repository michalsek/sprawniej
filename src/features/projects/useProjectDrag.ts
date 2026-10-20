/**
 * Drag-n-drop on the project board (the shared parts: src/features/board/columnsDrag.ts). A project dropped in
 * another column takes that column's status; anywhere, it takes its new place among its neighbours. Columns of hidden
 * statuses let projects out but don't take them in.
 */
import { useMemo } from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { moveProject } from '@/data/actions'
import type { ProjectColumn } from '@/data/select'
import type { Project } from '@/model/schema'
import { useColumnsDrag } from '@/features/board/columnsDrag'

export function useProjectDrag(columns: ProjectColumn[]) {
  const base = useMemo(() => Object.fromEntries(columns.map((c) => [c.status.id, c.projects.map((p) => p.id)])), [columns])
  const closed = useMemo(() => new Set(columns.filter((c) => c.status.hidden).map((c) => c.status.id)), [columns])
  const projects = useMemo(() => new Map(columns.flatMap((c) => c.projects.map((p) => [p.id, p] as const))), [columns])
  const cols = useColumnsDrag(base, closed)

  const onDragStart = ({ active }: DragStartEvent) => cols.start(String(active.id))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id)
    const from = cols.startedIn()
    // the project is wherever the live order put it (never in a hidden column it didn't start in)
    const to = cols.columnOf(active.id)
    cols.ended()
    if (over && from && to && projects.has(id)) {
      const ids = cols.finalOrder(id, over.id, to)
      const at = ids.indexOf(id)
      if (from !== to || at !== (base[from]?.indexOf(id) ?? -1)) {
        moveProject(id, { ...(from !== to && { statusId: to }), place: { prev: ids[at - 1] ?? null, next: ids[at + 1] ?? null } })
      }
    }
    cols.reset()
  }

  return {
    order: cols.order,
    activeId: cols.activeId,
    project: (id: string): Project | undefined => projects.get(id),
    justDropped: cols.justDropped,
    dnd: { sensors: cols.sensors, collisionDetection: cols.collisionDetection, onDragStart, onDragOver: cols.over, onDragEnd, onDragCancel: cols.reset },
  }
}
