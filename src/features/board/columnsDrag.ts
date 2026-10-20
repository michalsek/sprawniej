/**
 * The parts of drag-n-drop (dnd-kit) that every list of columns shares: the issue list and board, and the project
 * board. While you drag, the card moves between columns on screen (local state only); what a drop changes is up to
 * each page. On a touch screen you press and hold a card to pick it up; Space picks it up from the keyboard, arrows
 * move it, Space drops it and Esc puts it back. A column is a droppable with the id `columnDropId(key)`; a card is a
 * sortable with its own id.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closestCenter,
  getFirstCollision,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragOverEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'

/** card ids in each column, by the column's key */
export type ColumnOrder = Record<string, string[]>

const COLUMN = 'group:'
export const columnDropId = (key: string) => `${COLUMN}${key}`
export const isColumnId = (id: UniqueIdentifier) => String(id).startsWith(COLUMN)
/** the column a droppable id stands for */
export const columnKey = (id: UniqueIdentifier) => String(id).slice(COLUMN.length)

/** scroll only when the pointer is close to the edge (dnd-kit's default, 20%, scrolls a wide board too eagerly) */
export const AUTO_SCROLL = { threshold: { x: 0.08, y: 0.12 } }

/** mouse, touch (press and hold; a quick swipe still scrolls) and keyboard (Space; Enter still opens the card) */
export function useBoardSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )
}

/**
 * The live order while dragging, and the dnd-kit pieces that keep it. `closed`: columns that don't take a card while
 * you hover them (nothing moves on screen; the page decides what a drop on one does).
 */
export function useColumnsDrag(base: ColumnOrder, closed: ReadonlySet<string>) {
  /** only while dragging: the order on screen */
  const [live, setLive] = useState<ColumnOrder | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const order = live ?? base
  const orderRef = useRef(order)
  useEffect(() => {
    orderRef.current = order
  })
  const startColumn = useRef<string | null>(null)
  const lastOver = useRef<UniqueIdentifier | null>(null)
  const movedColumn = useRef(false)
  const dropped = useRef(false)

  useEffect(() => {
    requestAnimationFrame(() => (movedColumn.current = false))
  }, [live])

  const sensors = useBoardSensors()

  const columnOf = useCallback((id: UniqueIdentifier): string | undefined => {
    if (isColumnId(id)) return columnKey(id)
    return Object.keys(orderRef.current).find((k) => orderRef.current[k].includes(String(id)))
  }, [])

  /** the pointer's column, then the closest card in it (dnd-kit's multiple-containers recipe) */
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const within = pointerWithin(args)
    const hits = within.length ? within : rectIntersection(args)
    let overId = getFirstCollision(hits, 'id')
    if (overId != null) {
      if (isColumnId(overId)) {
        const ids = orderRef.current[columnKey(overId)] ?? []
        if (ids.length) {
          const closest = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => ids.includes(String(c.id))) })
          overId = closest[0]?.id ?? overId
        }
      }
      lastOver.current = overId
      return [{ id: overId }]
    }
    // just moved to another column: its layout is still settling, stay where we are
    if (movedColumn.current) lastOver.current = args.active.id
    return lastOver.current ? [{ id: lastOver.current }] : []
  }, [])

  /** a card was picked up */
  const start = (id: string) => {
    setActiveId(id)
    startColumn.current = columnOf(id) ?? null
    setLive(base)
  }

  /** a card moved over another column: it moves there on screen, above or below the card it is over */
  const over = ({ active, over }: DragOverEvent) => {
    if (!over) return
    const from = columnOf(active.id)
    const to = columnOf(over.id)
    if (!from || !to || from === to || closed.has(to)) return
    setLive((o) => {
      const cur = o ?? base
      const target = cur[to].filter((x) => x !== active.id)
      let at = target.length
      if (!isColumnId(over.id)) {
        const translated = active.rect.current.translated
        const below = translated && translated.top > over.rect.top + over.rect.height / 2
        at = Math.max(0, target.indexOf(String(over.id))) + (below ? 1 : 0)
      }
      movedColumn.current = true
      return { ...cur, [from]: cur[from].filter((x) => x !== active.id), [to]: [...target.slice(0, at), String(active.id), ...target.slice(at)] }
    })
  }

  /** a drag ended (dropped or put back): the click that ends it mustn't open the card */
  const ended = () => {
    dropped.current = true
    setTimeout(() => (dropped.current = false))
  }

  /** the column the card was picked up from (until reset) */
  const startedIn = () => startColumn.current

  /** the order of column `to` at the drop: over a card of the same column, the dragged one takes that card's place */
  const finalOrder = (activeId: string, overId: UniqueIdentifier, to: string): string[] => {
    const ids = orderRef.current[to] ?? []
    if (isColumnId(overId) || overId === activeId || !ids.includes(String(overId)) || !ids.includes(activeId)) return ids
    return arrayMove(ids, ids.indexOf(activeId), ids.indexOf(String(overId)))
  }

  const reset = () => {
    setLive(null)
    setActiveId(null)
    startColumn.current = null
  }

  return {
    order,
    activeId,
    columnOf,
    sensors,
    collisionDetection,
    start,
    over,
    ended,
    startedIn,
    finalOrder,
    reset,
    /** true right after a drop, so the click that ends a drag doesn't open the card */
    justDropped: () => dropped.current,
  }
}
