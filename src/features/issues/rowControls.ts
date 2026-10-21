/**
 * Controls inside a list row or board card (the priority button): the row is a link that can be dragged, so a
 * control has to keep its clicks, keys and focus to itself. See PriorityButton.tsx.
 */
import { useCallback, useMemo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/** what marks a control inside a row or card: a click on it never opens the issue */
export const ROW_CONTROL = '[data-row-control]'

/** the issues in the list or board on the page, top to bottom */
const rows = () => [...document.querySelectorAll<HTMLElement>('main [data-issue-id]')]

/**
 * Whether the last thing a person did was a key (rather than a click or tap): then a moved row is scrolled to. Kept
 * on the page, not in this module, so a reloaded module (while developing) doesn't listen twice.
 */
const INPUT = Symbol.for('sprawniej.rowControls.input')
type Input = { viaKeys: boolean }
function input(): Input {
  const g = globalThis as { [INPUT]?: Input }
  if (!g[INPUT]) {
    const state: Input = { viaKeys: false }
    g[INPUT] = state
    window.addEventListener('keydown', () => (state.viaKeys = true), true)
    window.addEventListener('pointerdown', () => (state.viaKeys = false), true)
  }
  return g[INPUT]
}

/**
 * Where a row's menu goes back to when it closes. Call it when the menu opens (it starts listening for keys then, and
 * notes where the row is), and call the result when it closes.
 */
export function rowReturn(id: string): () => void {
  const state = input()
  const at = rows().findIndex((el) => el.getAttribute('data-issue-id') === id)
  return () => {
    const scroll = state.viaKeys
    requestAnimationFrame(() => {
      const all = rows()
      // the row, wherever it is now (a new priority may move it to another group); if it's gone (deleted, or a filter
      // leaves it out now), the one that took its place
      const row = all.find((el) => el.getAttribute('data-issue-id') === id) ?? (at >= 0 ? all[Math.min(at, all.length - 1)] : undefined)
      if (!row) return
      row.focus({ preventScroll: true })
      if (scroll) row.scrollIntoView({ block: 'nearest' })
    })
  }
}

/**
 * A row or card's drag-n-drop wiring, the same objects from one render to the next while nothing about the drag
 * changes, so a memoised row isn't drawn again when the list around it is.
 */
export function useSortableRow(id: string) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  const dragRef = useDragRefs(setNodeRef, setActivatorNodeRef)
  // keep it a link for screen readers; dnd-kit would make it a button
  const dragProps = useMemo(() => ({ ...attributes, role: undefined, ...listeners }), [attributes, listeners])
  const moved = CSS.Translate.toString(transform)
  const style = useMemo(() => ({ transform: moved, transition }), [moved, transition])
  return { dragRef, dragProps, style, ghost: isDragging }
}

/**
 * One ref for a sortable row or card that is also where its drag starts: dnd-kit's keyboard drag then ignores a
 * Space pressed on a control inside it or in that control's menu.
 */
function useDragRefs(setNodeRef: (el: HTMLElement | null) => void, setActivatorNodeRef: (el: HTMLElement | null) => void) {
  return useCallback(
    (el: HTMLElement | null) => {
      setNodeRef(el)
      setActivatorNodeRef(el)
    },
    [setNodeRef, setActivatorNodeRef],
  )
}
