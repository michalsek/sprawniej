/**
 * The filter builder: conditions as pills ("Status | is | 4 statuses | ×"), joined by "and" or "or" (click a connector
 * to switch its whole group), and groups of them up to three levels deep. A popover on wide screens, a sheet from the
 * bottom on phones. Every change applies and saves at once; there is nothing to confirm.
 *
 * It keeps a draft, so a condition with no values yet or an empty group can stay on screen while you fill it in;
 * what's saved is the tidy form (`normalise`). Closing it brings back what's saved. A teammate's change is laid over
 * the draft (`alignDraft`): it shows at once, while your unfinished lines and open menus stay.
 */
import { createContext, useContext, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Brackets, Check, Plus, X } from 'lucide-react'
import { Picker } from '@/components/Picker'
import { MAX_DEPTH, NEWER_FILTER, alignDraft, isCondition, isGroup, normalise, storedFilters, treeOf } from '@/data/filterTree'
import { useData } from '@/data/store'
import { equal } from '@/lib/equal'
import { useNarrow } from '@/lib/useNarrow'
import { cn } from '@/lib/utils'
import type { FilterCondition, FilterField, FilterGroup, FilterNode, Filters, Status } from '@/model/schema'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/ui/popover'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet'
import { ValuesLabel } from './FilterBar'
import { KINDS, kindOf, pickedOf, sayCondition, upperFirst, useFilterItems, withPicked, type FilterItems } from './filterKinds'

// Draft nodes are plain data; React keys come from here. An edit makes a new node, which takes over the old one's key.
const keys = new WeakMap<object, string>()
let lastKey = 0
function keyOf(n: object): string {
  let k = keys.get(n)
  if (!k) keys.set(n, (k = `f${++lastKey}`))
  return k
}
function replacing<T extends object>(old: object, next: T): T {
  keys.set(next, keyOf(old))
  return next
}

interface Shared {
  items: FilterItems
  /** the workspace's statuses: the Status picker shows them, the filter keeps categories (filterKinds.tsx, pickedOf) */
  statuses: Record<string, Status>
  /** fields the page decides already */
  hide: FilterField[]
  /** the condition whose values picker is open */
  pickerFor: string | null
  setPickerFor: (key: string | null) => void
  /** the group whose "+ Filter" menu is open */
  menuFor: string | null
  setMenuFor: (key: string | null) => void
  /** move focus to something in the builder, once it has rendered */
  focus: (selector: string) => void
}
const BuilderContext = createContext<Shared | null>(null)
const useBuilder = () => useContext(BuilderContext)!

/**
 * A menu whose choice moves the focus on (to a picker, a new row) does that once it has closed, instead of handing
 * the focus back to its button. Any sooner, and the closing menu takes the focus back.
 */
function thenFocus(e: Event, next: RefObject<(() => void) | null>) {
  if (!next.current) return
  e.preventDefault()
  next.current()
  next.current = null
}

const segment =
  'flex h-8 min-w-0 items-center gap-1 px-1.5 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset data-[state=open]:bg-accent/60 md:gap-1.5 md:px-2 [&_svg]:size-3.5 [&_svg]:shrink-0'
const quiet =
  'flex h-8 items-center rounded-md text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent/60'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  hide?: FilterField[]
  open: boolean
  setOpen: (open: boolean) => void
  /** what the popover hangs from: the summary chip, or the Filter button */
  anchor: RefObject<HTMLElement>
  align: 'start' | 'end'
  /** the summary chip and the Filter button: clicking them while it's open must not close and reopen it */
  triggers: RefObject<HTMLElement | null>[]
  /** issues the list shows now (the sheet says it, as the list behind it is hidden) */
  shown: number
  /** open the field menu at once: the Filter button, with no filters yet */
  startWithMenu: boolean
}

export function FilterBuilder({ filters, onChange, hide = [], open, setOpen, anchor, align, triggers, shown, startWithMenu }: Props) {
  const narrow = useNarrow()
  const items = useFilterItems()
  const statuses = useData((s) => s.statuses)
  const saved = treeOf(filters)
  const [draft, setDraft] = useState(saved)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const outside = useRef(false)

  // opening or closing starts from what's saved, so empty rows vanish
  const [wasOpen, setWasOpen] = useState(open)
  const [seen, setSeen] = useState(filters)
  if (wasOpen !== open || seen !== filters) {
    setWasOpen(open)
    setSeen(filters)
    if (!open || wasOpen !== open) setDraft(saved)
    // a teammate, another tab or Undo changed it (not just what this draft saves): show that, with the draft's lines
    // keeping their keys
    else if (!equal(storedFilters(filters, normalise(draft)), filters)) {
      const { tree, pairs } = alignDraft(draft, saved)
      for (const [from, to] of pairs) replacing(from, to)
      setDraft(tree)
    }
  }

  const change = (next: FilterGroup) => {
    setDraft(next)
    const f = storedFilters(filters, normalise(next))
    if (!equal(f, filters)) onChange(f)
  }

  const shared: Shared = {
    items,
    statuses,
    hide,
    pickerFor,
    setPickerFor,
    menuFor,
    setMenuFor,
    focus: (selector) => setTimeout(() => body.current?.querySelector<HTMLElement>(selector)?.focus()),
  }

  const onOpenAutoFocus = (e: Event) => {
    if (!startWithMenu) return
    e.preventDefault()
    // after the builder has found its place, so the menu opens next to "+ Filter"
    setTimeout(() => setMenuFor(keyOf(draft)))
  }
  const onCloseAutoFocus = (e: Event) => {
    e.preventDefault()
    if (!outside.current) (triggers.map((t) => t.current).find((t) => t?.isConnected) ?? null)?.focus()
    outside.current = false
  }
  const onInteractOutside = (e: Event) => {
    const target = e.target as Node | null
    if (triggers.some((t) => target && t.current?.contains(target))) e.preventDefault()
    else outside.current = true
  }

  const content = (
    <BuilderContext.Provider value={shared}>
      <div ref={body} className="text-sm">
        {draft.items.length === 0 && <p className="mb-2 text-muted-foreground">No filters yet. Add one to narrow down this list.</p>}
        <GroupRows group={draft} depth={1} onGroup={change} />
      </div>
    </BuilderContext.Provider>
  )

  if (narrow) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[85vh] gap-0 overflow-y-auto rounded-t-xl"
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <SheetHeader className="px-3 pb-3">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription aria-live="polite">
              Shows {shown} {shown === 1 ? 'issue' : 'issues'}
            </SheetDescription>
          </SheetHeader>
          <div className="px-3 pb-6">{content}</div>
          {/* after the filters, so the focus starts on the first of them */}
          <SheetClose className={cn(quiet, 'absolute top-3 right-3 w-8 justify-center')} aria-label="Close">
            <X className="size-4" />
          </SheetClose>
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align={align}
        aria-label="Filters"
        className="max-h-[70vh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto p-3"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onInteractOutside={onInteractOutside}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}

/** a group's rows: the first plain, the others after the group's "and" / "or"; then "+ Filter" */
function GroupRows({ group, depth, onGroup, onRemove }: { group: FilterGroup; depth: number; onGroup: (g: FilterGroup) => void; onRemove?: () => void }) {
  const { focus } = useBuilder()
  const setItem = (at: number, next: FilterNode) => onGroup(replacing(group, { ...group, items: group.items.map((n, k) => (k === at ? next : n)) }))
  const remove = (at: number) => {
    const after = group.items[at + 1]
    onGroup(replacing(group, { ...group, items: group.items.filter((_, k) => k !== at) }))
    // focus goes to the next line, or to "+ Filter" when it was the last
    focus(after ? `[data-row="${keyOf(after)}"] :is([data-focus], [data-add])` : `[data-add="${keyOf(group)}"]`)
  }
  const switchJoin = () => onGroup(replacing(group, { ...group, join: group.join === 'and' ? 'or' : 'and' }))
  const connector = <Connector join={group.join} onSwitch={switchJoin} />

  return (
    <div className="flex flex-col gap-1.5">
      {group.items.map((n, at) => (
        <div key={keyOf(n)} data-row={keyOf(n)} className="flex min-w-0 flex-wrap items-start gap-1 md:flex-nowrap">
          {at > 0 && connector}
          <div className="flex min-w-0 flex-1">
            {isGroup(n) ? (
              <NestedGroup group={n} depth={depth + 1} onGroup={(g) => setItem(at, g)} onRemove={() => remove(at)} />
            ) : isCondition(n) ? (
              <ConditionPill condition={n} onChange={(c) => setItem(at, c)} onRemove={() => remove(at)} />
            ) : (
              <UnknownPill onRemove={() => remove(at)} />
            )}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1 md:flex-nowrap">
        {group.items.length > 0 && connector}
        <AddMenu group={group} depth={depth} onGroup={onGroup} />
        {/* on a phone a nested group's × sits here, so its rows get the whole width */}
        {onRemove && <RemoveGroup onRemove={onRemove} className="ml-auto md:hidden" />}
      </div>
    </div>
  )
}

function Connector({ join, onSwitch }: { join: FilterGroup['join']; onSwitch: () => void }) {
  const other = join === 'and' ? 'or' : 'and'
  return (
    // on a phone it has a short line of its own above the next line, so every group gets the whole width; only the
    // word is a button (with a taller invisible edge, to be easy to tap), so tapping the empty line does nothing
    <div className="basis-full md:shrink-0 md:basis-auto">
      <button
        type="button"
        onClick={onSwitch}
        className={cn(
          quiet,
          "relative h-6 min-w-8 justify-center px-1.5 after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] md:h-8 md:w-10 md:px-0 md:after:hidden",
        )}
        aria-label={`${join}. Switch this group to ${other}`}
        title={`Switch to ${other}`}
      >
        {join}
      </button>
    </div>
  )
}

function NestedGroup({ group, depth, onGroup, onRemove }: { group: FilterGroup; depth: number; onGroup: (g: FilterGroup) => void; onRemove: () => void }) {
  return (
    <div role="group" aria-label={`Group of filters joined by ${group.join}`} className="flex min-w-0 flex-1 items-start gap-1 rounded-lg border bg-accent/30 p-1 md:p-2">
      <div className="min-w-0 flex-1">
        {group.items.length === 0 && <p className="mb-1.5 px-1 text-muted-foreground">This group is empty. Add a filter, or remove the group.</p>}
        <GroupRows group={group} depth={depth} onGroup={onGroup} onRemove={onRemove} />
      </div>
      <RemoveGroup onRemove={onRemove} className="hidden md:flex" />
    </div>
  )
}

function RemoveGroup({ onRemove, className }: { onRemove: () => void; className: string }) {
  return (
    <button type="button" onClick={onRemove} className={cn(quiet, 'w-8 shrink-0 justify-center', className)} aria-label="Remove this group">
      <X className="size-3.5" />
    </button>
  )
}

/** "+ Filter": a field for a new condition, or a group of filters (not at the deepest level) */
function AddMenu({ group, depth, onGroup }: { group: FilterGroup; depth: number; onGroup: (g: FilterGroup) => void }) {
  const { hide, setPickerFor, menuFor, setMenuFor, focus } = useBuilder()
  const key = keyOf(group)
  const next = useRef<(() => void) | null>(null)
  const add = (n: FilterNode) => onGroup(replacing(group, { ...group, items: [...group.items, n] }))
  const addCondition = (field: FilterField) => {
    const c: FilterCondition = { field, op: 'is', values: [] }
    add(c)
    next.current = () => setPickerFor(keyOf(c))
  }
  const addGroup = () => {
    // a group inside an "and" is most useful as an "or", and the other way round
    const g: FilterGroup = { join: group.join === 'and' ? 'or' : 'and', items: [] }
    add(g)
    next.current = () => focus(`[data-add="${keyOf(g)}"]`)
  }
  // not modal: inside the builder, a modal menu would hold on to the focus while it closes
  return (
    <DropdownMenu modal={false} open={menuFor === key} onOpenChange={(o) => setMenuFor(o ? key : null)}>
      <DropdownMenuTrigger asChild>
        <button type="button" data-add={key} className={cn(quiet, 'gap-1.5 border px-2.5 text-foreground/90 [&_svg]:size-3.5')}>
          <Plus /> Filter
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" loop className="w-52" onCloseAutoFocus={(e) => thenFocus(e, next)}>
        {KINDS.filter((k) => !hide.includes(k.key)).map((k) => (
          <DropdownMenuItem key={k.key} onSelect={() => addCondition(k.key)} className="[&_svg]:text-muted-foreground">
            {k.icon} {k.name}
          </DropdownMenuItem>
        ))}
        {depth < MAX_DEPTH && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={addGroup} className="[&_svg]:text-muted-foreground">
              <Brackets /> Group of filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** one condition as four joined segments: the field, is / is not, the values, × */
function ConditionPill({ condition: c, onChange, onRemove }: { condition: FilterCondition & { field: FilterField }; onChange: (c: FilterCondition) => void; onRemove: () => void }) {
  const { items, statuses, hide, pickerFor, setPickerFor } = useBuilder()
  const key = keyOf(c)
  const kind = kindOf(c.field)
  const [word, other] = c.op === 'is' ? [kind.is, kind.not] : [kind.not, kind.is]
  const next = useRef<(() => void) | null>(null)
  const setField = (field: FilterField) => {
    if (field === c.field) return
    onChange(replacing(c, { ...c, field, values: [] }))
    // a new field starts with no values: its picker opens next
    next.current = () => setPickerFor(key)
  }
  return (
    <Pill onRemove={onRemove} label={`the ${kind.name.toLowerCase()} filter`}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          {/* a pill too long for its line gives way here first, so it stays on one line */}
          <button
            type="button"
            data-focus
            className={cn(segment, 'min-w-14 shrink-[3] [&_svg]:text-muted-foreground')}
            aria-label={`${kind.name}. Change the field`}
          >
            {kind.icon}{' '}
            <span className="truncate" title={kind.name}>
              {kind.name}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" loop className="w-52" onCloseAutoFocus={(e) => thenFocus(e, next)}>
          {KINDS.filter((k) => !hide.includes(k.key) || k.key === c.field).map((k) => (
            // one field is the current one, ticked, and said so to screen readers
            <DropdownMenuItem
              key={k.key}
              role="menuitemradio"
              aria-checked={k.key === c.field}
              onSelect={() => setField(k.key)}
              className="[&>svg:first-child]:text-muted-foreground"
            >
              {k.icon} {k.name}
              <Check className={cn('ml-auto', k.key !== c.field && 'invisible')} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={() => onChange(replacing(c, { ...c, op: c.op === 'is' ? 'not' : 'is' }))}
        className={cn(segment, 'shrink-0 border-l whitespace-nowrap text-muted-foreground hover:text-foreground')}
        aria-label={`${word}. Switch to ${other}`}
      >
        {word}
      </button>
      <Picker
        multiple
        placeholder={`${kind.name}…`}
        items={items[c.field]}
        value={pickedOf(c, statuses)}
        onSelect={(values) => onChange(replacing(c, withPicked(c, values, statuses)))}
        open={pickerFor === key}
        onOpenChange={(o) => setPickerFor(o ? key : null)}
      >
        <button type="button" className={cn(segment, 'max-w-60 border-l')} aria-label={`${sayCondition(c, items, statuses)}. Change the values`}>
          {/* the whole of it on hover, when it's cut short (on the inside, so a screen reader doesn't hear it twice) */}
          <span className="flex min-w-0" title={sayCondition(c, items, statuses)}>
            <ValuesLabel field={c.field} values={pickedOf(c, statuses)} items={items} />
          </span>
        </button>
      </Picker>
    </Pill>
  )
}

/** a condition a newer version wrote: it's left out of matching here, and only removing it is offered */
function UnknownPill({ onRemove }: { onRemove: () => void }) {
  return (
    <Pill onRemove={onRemove} label={NEWER_FILTER} focusRemove>
      <span className="flex h-8 min-w-0 items-center px-2.5 text-muted-foreground italic">
        <span className="truncate">{upperFirst(NEWER_FILTER)}</span>
      </span>
    </Pill>
  )
}

function Pill({ children, onRemove, label, focusRemove }: { children: ReactNode; onRemove: () => void; label: string; focusRemove?: boolean }) {
  return (
    <span className="flex min-w-0 max-w-full items-stretch rounded-lg border">
      <span className="flex min-w-0 items-stretch overflow-hidden rounded-l-lg">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        data-focus={focusRemove || undefined}
        className={cn(segment, 'shrink-0 self-stretch rounded-r-lg border-l text-muted-foreground hover:text-foreground')}
        aria-label={`Remove ${label}`}
      >
        <X />
      </button>
    </span>
  )
}
