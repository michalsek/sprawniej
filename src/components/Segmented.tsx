/** A row of joined buttons where one is chosen, like Punchcard's Day / Week / Month switch. */
import type { KeyboardEvent, ReactNode } from 'react'
import { arrowMove } from '@/lib/arrows'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** the accessible name, when the label can be just an icon (phones) */
  name?: string
}

/**
 * `fill`: as wide as its box, with equal buttons (a choice in a form, which has to fit a phone). One Tab stop, the
 * chosen button; ← and → move to the next one and choose it, as in a group of radio buttons. ↑ and ↓ stay the issue
 * list's.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  tour,
  fill,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
  label: string
  tour?: string
  fill?: boolean
}) {
  const chosen = Math.max(0, options.findIndex((o) => o.value === value))

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, at: number) {
    // with a modifier the key is the browser's (Alt+← is Back)
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
    const to = arrowMove(e.key, at, options.length)
    if (to === null) return
    // ← → Home End are ours here, not the app's shortcuts (src/app/shortcuts.ts)
    e.preventDefault()
    e.stopPropagation()
    // held down, it would choose again and again
    if (e.repeat) return
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus()
    if (options[to].value !== value) onChange(options[to].value)
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn('h-10 rounded-lg border', fill ? 'flex w-full' : 'inline-flex')} data-tour={tour}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.name}
          tabIndex={i === chosen ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={cn(
            '-m-px flex items-center gap-2 rounded-lg border border-transparent px-3 text-[15px] whitespace-nowrap sm:px-4 text-foreground/90 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
            fill && 'min-w-0 flex-1 justify-center px-2 sm:px-3',
            o.value === value && 'border-foreground/80 bg-accent',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
