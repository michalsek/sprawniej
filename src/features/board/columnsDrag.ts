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
  type KeyboardCoordinateGetter,
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

/**
 * The column beside the one a card is in, on one side (-1 left, 1 right): the nearest by its left edge, and among
 * columns stacked at that edge, the one nearest in height to `top`. Undefined when there is none (a list: the
 * groups are stacked, so there is no side).
 */
export function columnBeside(columns: readonly { key: string; left: number; top: number }[], from: { left: number }, side: -1 | 1, top: number): string | undefined {
  const there = columns.filter((c) => (side < 0 ? c.left < from.left - 1 : c.left > from.left + 1))
  return there.sort((a, b) => Math.abs(a.left - from.left) - Math.abs(b.left - from.left) || Math.abs(a.top - top) - Math.abs(b.top - top))[0]?.key
}

/** the card nearest in height to `top` (a card moved sideways lands next to it), undefined in an empty column */
export function nearestCard(cards: readonly { id: string; top: number }[], top: number): string | undefined {
  return [...cards].sort((a, b) => Math.abs(a.top - top) - Math.abs(b.top - top))[0]?.id
}

/** mouse, touch (press and hold; a quick swipe still scrolls) and keyboard (Space; Enter still opens the card) */
export function useBoardSensors(coordinateGetter: KeyboardCoordinateGetter = sortableKeyboardCoordinates) {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter,
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

  const columnOf = useCallback((id: UniqueIdentifier): string | undefined => {
    if (isColumnId(id)) return columnKey(id)
    return Object.keys(orderRef.current).find((k) => orderRef.current[k].includes(String(id)))
  }, [])

  // Left and right go to the column beside, next to the card nearest in height. dnd-kit's own arrow keys pick the
  // nearest droppable on that side, and the card's own column starts a little left of the card, so Left stayed put.
  // Up and Down, and a list (no columns side by side), keep dnd-kit's.
  const closedRef = useRef(closed)
  useEffect(() => {
    closedRef.current = closed
  })
  const coordinateGetter: KeyboardCoordinateGetter = useCallback(
    (event, args) => {
      const side = event.code === 'ArrowLeft' ? -1 : event.code === 'ArrowRight' ? 1 : 0
      const { active, collisionRect, droppableRects } = args.context
      const here = active ? columnOf(active.id) : undefined
      const from = here !== undefined ? droppableRects.get(columnDropId(here)) : undefined
      if (side && collisionRect && from) {
        const columns = Object.keys(orderRef.current).flatMap((key) => {
          const rect = closedRef.current.has(key) ? undefined : droppableRects.get(columnDropId(key))
          return rect ? [{ key, left: rect.left, top: rect.top }] : []
        })
        const to = columnBeside(columns, from, side, collisionRect.top)
        if (to !== undefined) {
          event.preventDefault()
          const cards = orderRef.current[to].flatMap((id) => {
            const rect = droppableRects.get(id)
            return rect ? [{ id, top: rect.top }] : []
          })
          const card = nearestCard(cards, collisionRect.top)
          const rect = droppableRects.get(card ?? columnDropId(to))
          if (rect) return { x: rect.left, y: rect.top }
        }
      }
      return sortableKeyboardCoordinates(event, args)
    },
    [columnOf],
  )
  const sensors = useBoardSensors(coordinateGetter)

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
