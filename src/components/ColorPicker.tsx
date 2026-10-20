/** The colour button for a label or a status: a small swatch that opens the calm set to pick from. */
import type { ReactNode } from 'react'
import { COLOR_NAMES } from '@/model/colors'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { cn } from '@/lib/utils'

interface Props {
  /** the colour it has now */
  value: string
  colors: readonly string[]
  onPick: (color: string) => void
  /** what the button says to a screen reader ("Colour of Bug") */
  label: string
  /** how a colour looks here (a label's dot, a status's icon), on the button or in the menu */
  swatch: (color: string, where: 'button' | 'menu') => ReactNode
}

export function ColorPicker({ value, colors, onPick, label, swatch }: Props) {
  return (
    <Popover>
      <PopoverTrigger className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent/60" aria-label={label}>
        {swatch(value, 'button')}
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('grid w-auto gap-1 p-2', colors.length > 10 ? 'grid-cols-6' : 'grid-cols-5')}>
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            className={cn('flex size-8 items-center justify-center rounded-md hover:bg-accent', c === value && 'bg-accent')}
            aria-label={`Use ${COLOR_NAMES[c] ?? c}`}
            aria-pressed={c === value}
          >
            {swatch(c, 'menu')}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
