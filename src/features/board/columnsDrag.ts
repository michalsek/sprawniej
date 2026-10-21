/**
 * The parts of drag-n-drop (dnd-kit) that every list of columns shares: the issue list and board, and the project
 * board. While you drag, the card moves between columns on screen (local state only); what a drop changes is up to
 * each page. On a touch screen you press and hold a card to pick it up; Space picks it up from the keyboard, arrows
 * move it, Space drops it and Esc puts it back. A column is a droppable with the id `columnDropId(key)`; a card is a
 * sortable with its own id.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  closestCenter,
  getFirstCollision,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
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

/**
 * Where Left or Right takes a dragged card. It starts from the column the card is in, or, while it is over a column
 * that takes nothing (a hidden status, the issue board's Hidden columns), from that one, so Left from there comes
 * back to the last open column. A column key: go there; 'stay': nothing to that side (Left in the first column);
 * undefined: leave it to dnd-kit (Right past the last open column, which reaches the hidden ones; a list, whose
 * groups are stacked).
 */
export function arrowTarget(o: {
  side: -1 | 1
  /** the column the card is in now */
  live: string
  /** the column it is over */
  over: string | undefined
  closed: ReadonlySet<string>
  /** every column on screen, closed ones too */
  columns: readonly { key: string; left: number; top: number }[]
  /** the card's top */
  top: number
}): string | 'stay' | undefined {
  const fromKey = o.over !== undefined && o.closed.has(o.over) ? o.over : o.live
  const from = o.columns.find((c) => c.key === fromKey)
  if (!from) return undefined
  const to = columnBeside(o.columns.filter((c) => !o.closed.has(c.key)), from, o.side, o.top)
  if (to !== undefined) return to
  if (o.side < 0 && o.columns.some((c) => c.left > from.left + 1)) return 'stay'
  return undefined
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The column a dragged card covers the most of (by area, not by share: a long column isn't worse than a short one),
 * undefined when it covers none. Only columns count, never cards, so moving the card between columns can't change
 * the answer: the columns stay where they are, or (stacked groups in a list) grow around the card.
 */
export function mostCovered<Id>(columns: readonly { id: Id; rect: Box }[], card: Box): Id | undefined {
  let best: Id | undefined
  let most = 0
  for (const { id, rect } of columns) {
    const w = Math.min(rect.left + rect.width, card.left + card.width) - Math.max(rect.left, card.left)
    const h = Math.min(rect.top + rect.height, card.top + card.height) - Math.max(rect.top, card.top)
    const area = w > 0 && h > 0 ? w * h : 0
    if (area > most) [best, most] = [id, area]
  }
  return best
}

/** the card nearest in height to `top` (a card moved sideways lands next to it), undefined in an empty column */
export function nearestCard(cards: readonly { id: string; top: number }[], top: number): string | undefined {
  return [...cards].sort((a, b) => Math.abs(a.top - top) - Math.abs(b.top - top))[0]?.id
}

const MOUSE = { activationConstraint: { distance: 6 } }
const TOUCH = { activationConstraint: { delay: 250, tolerance: 8 } }
const KEYS = { start: ['Space'], cancel: ['Escape'], end: ['Space'] }

/**
 * mouse, touch (press and hold; a quick swipe still scrolls) and keyboard (Space; Enter still opens the card). The
 * options stay the same objects from one render to the next, so dnd-kit keeps the rows' listeners and memoised rows
 * aren't drawn again.
 */
function useBoardSensors(coordinateGetter: KeyboardCoordinateGetter) {
  const keyboard = useMemo(() => ({ coordinateGetter, keyboardCodes: KEYS }), [coordinateGetter])
  return useSensors(useSensor(MouseSensor, MOUSE), useSensor(TouchSensor, TOUCH), useSensor(KeyboardSensor, keyboard))
}

/**
 * The new order, keeping each column's list from `prev` when it holds the same ids: a column whose issues didn't
 * change keeps the very same list, so dnd-kit (and the rows in it) see nothing new. `prev` itself when nothing
 * changed at all.
 */
export function keepSame(prev: ColumnOrder, next: ColumnOrder): ColumnOrder {
  const out: ColumnOrder = {}
  let same = Object.keys(prev).length === Object.keys(next).length
  for (const [key, ids] of Object.entries(next)) {
    const old = prev[key]
    const kept = old && old.length === ids.length && old.every((id, i) => id === ids[i])
    out[key] = kept ? old : ids
    if (!kept) same = false
  }
  return same ? prev : out
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
      const { active, over, collisionRect, droppableRects } = args.context
      const live = active ? columnOf(active.id) : undefined
      if (side && collisionRect && live !== undefined) {
        const columns = Object.keys(orderRef.current).flatMap((key) => {
          const rect = droppableRects.get(columnDropId(key))
          return rect ? [{ key, left: rect.left, top: rect.top }] : []
        })
        const to = arrowTarget({ side, live, over: over ? columnOf(over.id) : undefined, closed: closedRef.current, columns, top: collisionRect.top })
        if (to === 'stay') {
          event.preventDefault()
          return undefined
        }
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

  /**
   * The pointer's column, then the closest card in it (dnd-kit's multiple-containers recipe). Without a pointer in
   * one (the keyboard, or the pointer in a gap), the column the dragged card covers most. Never the card it overlaps
   * most: moving the card to another column moves the cards in both, and with cards of different heights the best
   * overlap could then be back in the first column, and so on forever (the board froze with "Maximum update depth").
   * A column keeps its place when a card moves.
   */
  const collisionDetection: CollisionDetection = useCallback((args) => {
    let overId = getFirstCollision(pointerWithin(args), 'id')
    if (overId == null && args.collisionRect) {
      const columns = args.droppableContainers.flatMap((c) => {
        const rect = isColumnId(c.id) ? args.droppableRects.get(c.id) : undefined
        return rect ? [{ id: c.id, rect }] : []
      })
      overId = mostCovered(columns, args.collisionRect) ?? null
    }
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
