/**
 * How much is done, as a small ring: a grey track and an indigo arc that closes into a full circle when everything is
 * done (no fill, no check: those are the Done status's look). With nothing to count the track is fainter, so "no
 * issues" doesn't look like "none done yet". Its tooltip gives the numbers, a line each. It opens on hover, on a tap
 * (a tap on the ring doesn't open the link it sits in; a second tap or one elsewhere closes it), and on keyboard focus
 * of the link around it (`tip`, from useRingTip) or of the ring itself (`focusable`). Esc closes it. Pressing and
 * holding the ring still picks its card up, as anywhere on the card.
 */
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { arcShare, ringClick, useRingTip, type RingTip } from './ringTip'

const R = 6.5
const C = 2 * Math.PI * R

interface Props {
  done: number
  total: number
  /** the tooltip, a line each; the first says it all, and is what a screen reader hears */
  lines: string[]
  /** the tooltip's state, when the link around the ring opens it on focus (useRingTip) */
  tip?: RingTip
  /** no tooltip: the copy of a card under the pointer while it is dragged, or a card being dragged */
  still?: boolean
  /** a Tab stop of its own, read as the first line, for a ring that isn't inside a link */
  focusable?: boolean
  className?: string
}

export function ProgressRing({ done, total, lines, tip, still, focusable, className }: Props) {
  const own = useRingTip()
  const { open, setOpen, focusProps } = tip ?? own
  // what the press that ends in a click was, and whether the tooltip was open before it (Radix closes it on press)
  const press = useRef<{ type: string; wasOpen: boolean } | null>(null)
  const share = arcShare(done, total)
  const ring = (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <circle cx="8" cy="8" r={R} fill="none" strokeWidth="2" className={cn('stroke-progress-track', total <= 0 && 'opacity-50')} />
      {share > 0 && (
        <circle
          cx="8"
          cy="8"
          r={R}
          fill="none"
          strokeWidth="2"
          strokeLinecap="butt"
          strokeDasharray={share < 1 ? `${C * share} ${C}` : undefined}
          transform="rotate(-90 8 8)"
          className="stroke-status-done"
        />
      )}
    </svg>
  )
  // `relative` keeps the hidden sentence inside the ring, not against the page (an off-screen column widened it)
  const box = cn('relative -m-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full p-1', className)
  // inside a link the sentence is part of what the link says; a ring of its own says it as its label
  const said = !focusable && <span className="sr-only">{lines[0]}</span>
  if (still) {
    return (
      <span className={box}>
        {ring}
        {said}
      </span>
    )
  }
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        asChild
        onPointerDown={(e) => (press.current = { type: e.pointerType, wasOpen: open })}
        onClick={(e) => {
          const p = press.current
          press.current = null
          if (ringClick(p?.type, e.defaultPrevented) === 'link') return
          e.preventDefault()
          e.stopPropagation()
          setOpen(!p?.wasOpen)
        }}
      >
        <span
          className={cn(box, focusable && 'outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          {...(focusable && { tabIndex: 0, role: 'img', 'aria-label': lines[0], ...focusProps })}
        >
          {ring}
          {said}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-left">
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}
