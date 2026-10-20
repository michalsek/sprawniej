/**
 * Your favourites in the sidebar: they sit in the Workspace section, under Projects and Views, with no heading of
 * their own. Each opens its project or view. Drag one to change your order (on a phone, press and hold first), or
 * pick it up from the keyboard with Space, move it with the arrows and drop it with Space (Esc puts it back). Its ⋯
 * menu moves it up or down, or removes it. With none yet, one quiet hint says how to add some and opens Projects.
 *
 * Only the moved favourite changes on a drop: it gets an order key between its new neighbours (moveFavourite).
 */
import { useRef } from 'react'
import { Link, useLocation } from 'wouter'
import { ArrowDown, ArrowUp, Box, Layers, MoreHorizontal, StarOff } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { moveFavourite, moveFavouriteBy, removeFavourite } from '@/data/actions'
import { favouriteIds, starred, visibleFavourites } from '@/data/favourites'
import { useData } from '@/data/store'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { moveText } from './favouriteText'

/** a favourite moves only up and down, so the sidebar never scrolls sideways */
const upAndDown: Modifier = ({ transform }) => ({ ...transform, x: 0 })

function FavouriteRow({ id, first, last }: { id: string; first: boolean; last: boolean }) {
  const favourite = useData((s) => s.favourites.find((f) => f.id === id))
  const thing = useData((s) => (favourite ? starred(s, favourite) : undefined))
  const [location] = useLocation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  if (!favourite || !thing) return null
  const project = favourite.kind === 'project'
  const href = project ? `/project/${id}` : `/view/${id}`
  const active = location === href || location.startsWith(`${href}/`)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group/fav relative flex items-center rounded-lg hover:bg-sidebar-accent/60', active && 'bg-sidebar-accent', isDragging && 'z-10 bg-sidebar-accent shadow-sm')}
    >
      <Link
        href={href}
        // dnd-kit's attributes stay (aria-pressed while dragging tells shortcuts.ts to leave the arrows alone), but it
        // stays a link for screen readers, not the button dnd-kit would make it
        {...attributes}
        role={undefined}
        {...listeners}
        data-favourite-id={id}
        title={thing.name}
        aria-current={active ? 'page' : undefined}
        // NavItem's look in Sidebar.tsx, copied for now; one shared constant once the list is in the sidebar
        className={cn(
          'flex h-9 min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-lg px-3 text-[15px] text-sidebar-foreground/90 select-none [-webkit-touch-callout:none] [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-sidebar-foreground/80',
          active && 'text-sidebar-foreground',
        )}
      >
        {thing.emoji ? <span className="w-[18px] text-center text-base leading-none">{thing.emoji}</span> : project ? <Box /> : <Layers />}
        <span className="truncate">{thing.name}</span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`More actions for ${thing.name}`}
            className="mr-1 md:opacity-0 md:group-hover/fav:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={first} onSelect={() => moveFavouriteBy(id, -1)}>
            <ArrowUp /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={last} onSelect={() => moveFavouriteBy(id, 1)}>
            <ArrowDown /> Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => removeFavourite(id)}>
            <StarOff /> Remove from favourites
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

export function Favourites() {
  const ids = useData(useShallow(favouriteIds))
  const names = useData(useShallow((s) => visibleFavourites(s).map((f) => starred(s, f)?.name ?? '')))
  // the click that ends a mouse drag doesn't open the favourite
  const dropped = useRef(false)
  const sensors = useSensors(
    // the same thresholds as dragging issues (useIssueDrag.ts)
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // on a touch screen, press and hold to pick one up; a quick swipe still scrolls
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter still opens it; Space picks it up and drops it
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )

  if (!ids.length) {
    return (
      <Link href="/projects" className="mx-3 mt-2 rounded-lg border border-dashed px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground">
        Star a project or view to keep it here.
      </Link>
    )
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dropped.current = true
    setTimeout(() => (dropped.current = false))
    if (over && active.id !== over.id) moveFavourite(String(active.id), ids.indexOf(String(over.id)))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[upAndDown]}
      onDragEnd={onDragEnd}
      accessibility={{ announcements: moveText(ids.map((id, n) => ({ id, name: names[n] }))) }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label="Favourites" className="mt-2 flex flex-col gap-0.5" onClickCapture={(e) => dropped.current && e.preventDefault()}>
          {ids.map((id, n) => (
            <FavouriteRow key={id} id={id} first={n === 0} last={n === ids.length - 1} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
