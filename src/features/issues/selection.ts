/**
 * Picking several issues: ⌘/Ctrl-click (or X) adds or removes one, Shift-click adds everything between the last
 * one you picked and this one, Esc clears. Dragging a picked issue moves all of them; S, P, A, L and the bar at the
 * bottom change all of them.
 */
import type { MouseEvent } from 'react'
import { create } from 'zustand'

interface Selection {
  ids: string[]
  /** the last issue picked, where a Shift-click range starts */
  anchor: string | null
  /** something is being dragged (menus close) */
  dragging: boolean
  /** several picked issues are being dragged together */
  draggingMany: boolean
}

export const useSelection = create<Selection>()(() => ({ ids: [], anchor: null, dragging: false, draggingMany: false }))

export const clearSelection = () => useSelection.getState().ids.length && useSelection.setState({ ids: [], anchor: null })

export function toggleSelected(id: string) {
  const { ids } = useSelection.getState()
  useSelection.setState({ ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id], anchor: id })
}

/** the issues on screen, top to bottom (and column by column on a board) */
const onScreen = () => [...document.querySelectorAll('main [data-issue-id]')].map((el) => el.getAttribute('data-issue-id')!)

function selectRange(id: string) {
  const { ids, anchor } = useSelection.getState()
  const all = onScreen()
  const from = anchor ? all.indexOf(anchor) : -1
  const to = all.indexOf(id)
  if (from === -1 || to === -1) return toggleSelected(id)
  const range = all.slice(Math.min(from, to), Math.max(from, to) + 1)
  useSelection.setState({ ids: [...new Set([...ids, ...range])], anchor: id })
}

/** a click on a row or card: true when it picked (⌘/Ctrl/Shift held), so the issue shouldn't open */
export function selectionClick(e: MouseEvent, id: string): boolean {
  if (e.shiftKey) selectRange(id)
  else if (e.metaKey || e.ctrlKey) toggleSelected(id)
  else return false
  e.preventDefault()
  return true
}

/**
 * Which issues a change made from one row or card is for: all the picked ones when this one is among several picked,
 * otherwise just this one (picking others doesn't pull in a row you didn't pick).
 */
export function targetsFor(id: string, picked: readonly string[]): string[] {
  return picked.length > 1 && picked.includes(id) ? [...picked] : [id]
}
