/** A row of joined buttons where one is chosen, like Punchcard's Day / Week / Month switch. */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** the accessible name, when the label can be just an icon (phones) */
  name?: string
}

/** `fill`: as wide as its box, with equal buttons (a choice in a form, which has to fit a phone) */
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
  return (
    <div role="radiogroup" aria-label={label} className={cn('h-10 rounded-lg border', fill ? 'flex w-full' : 'inline-flex')} data-tour={tour}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.name}
          onClick={() => onChange(o.value)}
          className={cn(
            '-m-px flex items-center gap-2 rounded-lg border border-transparent px-3 text-[15px] whitespace-nowrap sm:px-4 text-foreground/90 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4',
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
