/**
 * The star that keeps a project or view in your sidebar (your favourites), or takes it out. Grey, filled with the
 * text colour when on: bright colours are only for meaning (docs/design.md).
 */
import { Star } from 'lucide-react'
import { toggleFavourite } from '@/data/actions'
import { isFavourite } from '@/data/favourites'
import { useData } from '@/data/store'
import { cn } from '@/lib/utils'
import type { FavouriteKind } from '@/model/schema'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/** on a list row: shown on hover or keyboard focus where there is a mouse, always on touch screens, and always when on */
const ON_ROW = '[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100'

export function FavouriteButton({ kind, id, name, row, className }: { kind: FavouriteKind; id: string; name?: string; row?: boolean; className?: string }) {
  const on = useData((s) => isFavourite(s, id))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={name ? `Favourite: ${name}` : 'Favourite'}
          aria-pressed={on}
          onClick={() => toggleFavourite(kind, id)}
          className={cn(row && ON_ROW, className)}
        >
          <Star className={cn(on ? 'fill-current text-foreground' : 'text-muted-foreground')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{on ? 'Remove from favourites' : 'Add to favourites (it shows in your sidebar)'}</TooltipContent>
    </Tooltip>
  )
}
