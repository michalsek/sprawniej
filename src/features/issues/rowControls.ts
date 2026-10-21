/**
 * Controls inside a list row or board card (the priority button): the row is a link that can be dragged, so a
 * control has to keep its clicks, keys and focus to itself. See PriorityButton.tsx.
 */
import { useCallback } from 'react'

/** what marks a control inside a row or card: a click on it never opens the issue */
export const ROW_CONTROL = '[data-row-control]'

/** whether the last thing a person did was a key (rather than a click or tap): then a moved row is scrolled to */
let viaKeys = false
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (viaKeys = true), true)
  window.addEventListener('pointerdown', () => (viaKeys = false), true)
}

/** back to the row a menu was opened from, wherever it is now (a new priority may move it to another group) */
export function focusRow(id: string) {
  const scroll = viaKeys
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(`main [data-issue-id="${CSS.escape(id)}"]`)
    if (!row) return
    row.focus({ preventScroll: true })
    if (scroll) row.scrollIntoView({ block: 'nearest' })
  })
}

/**
 * One ref for a sortable row or card that is also where its drag starts: dnd-kit's keyboard drag then ignores a
 * Space pressed on a control inside it or in that control's menu.
 */
export function useDragRefs(setNodeRef: (el: HTMLElement | null) => void, setActivatorNodeRef: (el: HTMLElement | null) => void) {
  return useCallback(
    (el: HTMLElement | null) => {
      setNodeRef(el)
      setActivatorNodeRef(el)
    },
    [setNodeRef, setActivatorNodeRef],
  )
}
