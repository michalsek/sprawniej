/**
 * The parts of a progress ring (src/components/ProgressRing.tsx) that aren't drawing: how much of the circle it
 * fills, and whether its tooltip is open. A ring inside a link (a project card or row) is not a Tab stop of its own:
 * the link spreads `focusProps`, so moving to it with the keyboard opens the tooltip and leaving closes it. A click
 * focuses the link too, but that focus isn't `:focus-visible`, so a click opens the project without the tooltip
 * flashing up.
 */
import { useMemo, useState, type FocusEvent } from 'react'

/** a little done shows as a little arc, and nearly done still leaves a gap: only all done closes the circle */
const MIN = 0.06
const MAX = 0.94

/** the share of the circle the arc covers, 0..1 */
export function arcShare(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0
  if (done >= total) return 1
  return Math.min(MAX, Math.max(MIN, done / total))
}

export interface RingTip {
  open: boolean
  setOpen: (open: boolean) => void
  focusProps: { onFocus: (e: FocusEvent<HTMLElement>) => void; onBlur: (e: FocusEvent<HTMLElement>) => void }
}

/** focus that came from the keyboard (or that the browser would ring anyway) */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}

export function useRingTip(): RingTip {
  const [open, setOpen] = useState(false)
  const focusProps = useMemo(
    () => ({
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if (e.target === e.currentTarget && focusVisible(e.currentTarget)) setOpen(true)
      },
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (e.target === e.currentTarget) setOpen(false)
      },
    }),
    [],
  )
  return { open, setOpen, focusProps }
}
