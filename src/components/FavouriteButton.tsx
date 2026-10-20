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

export function FavouriteButton({ kind, id, name, className }: { kind: FavouriteKind; id: string; name?: string; className?: string }) {
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
          className={className}
        >
          <Star className={cn(on ? 'fill-current text-foreground' : 'text-muted-foreground')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{on ? 'Remove from favourites' : 'Add to favourites (it shows in your sidebar)'}</TooltipContent>
    </Tooltip>
  )
}
