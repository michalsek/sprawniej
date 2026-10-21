/**
 * The workspace's statuses of one kind (Settings › Statuses), group by group: rename, recolour, reorder, hide and
 * show them, and add new ones. Every member may (like labels). Statuses are never deleted: hiding one keeps it on the
 * things that have it. Each group keeps at least one shown status. Everything saves by itself.
 *
 * On screen this says "group", never "category" (CLAUDE.md, writing). One component for every kind of status; what
 * differs per kind (issues, projects) is in KIND_TEXT.
 */
import { useMemo, useRef, useState, type ReactElement } from 'react'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type Announcements, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, MoreHorizontal, Plus } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { InlineText } from '@/components/InlineText'
import { createStatus, moveStatus, updateStatus } from '@/data/actions'
import { canHide, defaultStatus, statusesOf, statusNamed } from '@/data/statuses'
import { useData } from '@/data/store'
import { STATUS_COLORS } from '@/model/colors'
import type { Status } from '@/model/schema'
import type { StatusKind } from '@/model/status'
import { StatusIcon } from '@/features/issues/icons'
import { StatusDot } from '@/features/projects/StatusDot'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { cn } from '@/lib/utils'
import { KIND_TEXT, type GroupInfo, type KindText } from './statusKinds'

const MAX_NAME = 40
const CANT_HIDE = 'Each group needs at least one status that isn’t hidden. Add or show another one first.'

/** "New status", or "New status 2" when that's taken: names are unique */
function freshName(statuses: Record<string, Status>, kind: StatusKind): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'New status' : `New status ${n}`
    if (!statusNamed(statuses, kind, name)) return name
  }
}

interface RowProps {
  status: Status
  statuses: Record<string, Status>
  /** how many have it */
  uses: number
  text: KindText
  /** the group's default, marked when the group has a choice */
  isDefault: boolean
  /** just added: its name is ready to type over */
  fresh: boolean
  /** its neighbours in the group, to move it up or down (null at an end) */
  above: string | null
  below: string | null
  aboveAbove: string | null
  belowBelow: string | null
}

function StatusRow({ status, statuses, uses, text, isDefault, fresh, above, below, aboveAbove, belowBelow }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })
  const [problem, setProblem] = useState<string | null>(null)
  const hideable = status.hidden || canHide(status, statuses)
  const taken = (name: string) => !!statusNamed(statuses, status.kind, name, status.id)
  const dim = status.hidden && 'opacity-60'

  const hide = (
    <Button
      variant="ghost"
      size="sm"
      className={cn('w-8 shrink-0 justify-center px-0 text-muted-foreground sm:w-[4.75rem] sm:justify-start sm:px-2.5', !hideable && 'cursor-not-allowed opacity-50 hover:bg-transparent')}
      aria-label={`${status.hidden ? 'Show' : 'Hide'} ${status.name}`}
      // stays focusable, so the reason can be read
      aria-disabled={!hideable || undefined}
      onClick={() => hideable && updateStatus(status.id, { hidden: !status.hidden })}
    >
      {status.hidden ? <Eye /> : <EyeOff />}
      {/* a phone shows only the eye, so the name has room */}
      <span className="hidden sm:inline">{status.hidden ? 'Show' : 'Hide'}</span>
    </Button>
  )

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('rounded-md', isDragging && 'relative z-10 bg-popover shadow-lg')}
      data-status={status.name}
    >
      <div className="group flex h-11 items-center gap-1 px-1 hover:bg-accent/40 sm:gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Move ${status.name}`}
          aria-roledescription="handle to reorder"
          className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <span className={cn('shrink-0', dim)}>
          <ColorPicker
            value={status.color}
            colors={STATUS_COLORS}
            onPick={(color) => updateStatus(status.id, { color })}
            label={`Colour of ${status.name}`}
            swatch={(color, where) =>
              status.kind === 'project' ? (
                <StatusDot status={{ ...status, color }} className={where === 'menu' ? 'size-3.5' : 'size-3'} />
              ) : (
                <StatusIcon status={{ ...status, color }} className={where === 'menu' ? 'size-4' : undefined} />
              )
            }
          />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn('min-w-0 flex-1', dim)}>
            <InlineText
              value={status.name}
              onSave={(name) => updateStatus(status.id, { name })}
              allowed={(v) => !taken(v)}
              onTyping={(v) => setProblem(v === null ? null : !v.trim() ? 'Give it a name.' : taken(v.trim()) ? 'Another status is called that. Pick another name.' : null)}
              label={`Name of ${status.name}`}
              required
              maxLength={MAX_NAME}
              autoFocus={fresh}
              className="h-8 min-w-0 text-field"
            />
          </span>
          {status.hidden && <Hint text={text.hiddenHint}>Hidden</Hint>}
          {isDefault && <Hint text={text.defaultHint}>Default</Hint>}
        </span>
        <span className={cn('w-16 shrink-0 text-right text-sm text-muted-foreground tabular-nums sm:w-20', dim)}>{text.count(uses)}</span>
        {hideable ? hide : <Reason text={CANT_HIDE}>{hide}</Reason>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={`More for ${status.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!above} onSelect={() => moveStatus(status.id, { prev: aboveAbove, next: above })}>
              <ArrowUp /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!below} onSelect={() => moveStatus(status.id, { prev: below, next: belowBelow })}>
              <ArrowDown /> Move down
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {problem && (
        <p role="status" className="pb-1 pl-[4.75rem] text-sm text-destructive-text">
          {problem}
        </p>
      )}
    </li>
  )
}

/** why a button can't be used, in a tooltip that opens on keyboard focus as surely as on hover */
function Reason({ text, children }: { text: string; children: ReactElement }) {
  const [open, setOpen] = useState(false)
  // a click focuses the button too; that focus doesn't open it (hovering already did, and the click closes it)
  const pressed = useRef(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        asChild
        onPointerDown={() => (pressed.current = true)}
        onFocus={() => {
          if (!pressed.current) setOpen(true)
          pressed.current = false
        }}
        onBlur={() => setOpen(false)}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}

/** a quiet word with its longer meaning in a tooltip */
function Hint({ text, children }: { text: string; children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="shrink-0 rounded-sm text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}

interface GroupProps {
  kind: StatusKind
  group: GroupInfo
  list: Status[]
  statuses: Record<string, Status>
  uses: ReadonlyMap<string, number>
  fresh: string | null
  onAdd: (group: string) => void
}

function GroupSection({ kind, group, list, statuses, uses, fresh, onAdd }: GroupProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // on a touch screen, press and hold the handle a moment; a swipe elsewhere still scrolls
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const text = KIND_TEXT[kind]
  const ids = list.map((s) => s.id)
  const nameOf = (id: unknown) => statuses[String(id)]?.name ?? 'The status'
  const at = (id: unknown) => `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, at ${at(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} goes to ${at(over.id)}.` : `${nameOf(active.id)} is outside the list.`),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} dropped at ${at(over.id)}.` : `${nameOf(active.id)} put back.`),
    onDragCancel: ({ active }) => `${nameOf(active.id)} put back.`,
  }
  const end = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const order = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    const n = order.indexOf(String(active.id))
    moveStatus(String(active.id), { prev: order[n - 1] ?? null, next: order[n + 1] ?? null })
  }
  const first = defaultStatus(statuses, kind, group.id)
  // Default says something only when the group has more than one status to pick from
  const choice = list.filter((s) => !s.hidden).length > 1

  return (
    <section aria-labelledby={`group-${kind}-${group.id}`} className="py-3">
      <h3 id={`group-${kind}-${group.id}`} className="text-sm font-medium text-muted-foreground">
        {group.name}
      </h3>
      {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
      <DndContext
        sensors={sensors}
        onDragEnd={end}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: 'To move a status, press Space or Enter, then the arrow keys, then Space or Enter again. Escape puts it back.' },
        }}
      >
        <SortableContext id={`${kind}-${group.id}`} items={ids} strategy={verticalListSortingStrategy}>
          <ul className="mt-2 flex flex-col">
            {list.map((s, n) => (
              <StatusRow
                key={s.id}
                status={s}
                statuses={statuses}
                uses={uses.get(s.id) ?? 0}
                text={text}
                isDefault={choice && s.id === first?.id}
                fresh={s.id === fresh}
                above={ids[n - 1] ?? null}
                aboveAbove={ids[n - 2] ?? null}
                below={ids[n + 1] ?? null}
                belowBelow={ids[n + 2] ?? null}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onAdd(group.id)}>
          <Plus /> Add status
        </Button>
        {list.length === 1 && group.example && (
          <span className="text-sm text-muted-foreground">
            Add a status to split {group.name} into steps, {group.example}.
          </span>
        )}
      </div>
    </section>
  )
}

export function StatusesSettings({ kind }: { kind: StatusKind }) {
  const statuses = useData((s) => s.statuses)
  const issues = useData((s) => s.issues)
  const projects = useData((s) => s.projects)
  const counter = KIND_TEXT[kind].uses
  const uses = useMemo(() => counter({ issues, projects }), [counter, issues, projects])
  const [fresh, setFresh] = useState<string | null>(null)
  const all = useMemo(() => statusesOf(statuses, kind), [statuses, kind])
  const add = (group: string) => {
    const made = createStatus(kind, group, freshName(statuses, kind))
    if (made) setFresh(made.id)
  }

  return (
    <div className="flex flex-col divide-y">
      {KIND_TEXT[kind].groups.map((g) => (
        <GroupSection key={g.id} kind={kind} group={g} list={all.filter((s) => s.category === g.id)} statuses={statuses} uses={uses} fresh={fresh} onAdd={add} />
      ))}
    </div>
  )
}
