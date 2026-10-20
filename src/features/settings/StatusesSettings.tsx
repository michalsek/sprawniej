/**
 * The workspace's statuses of one kind (Settings › Statuses), group by group: rename, recolour, reorder, hide and
 * show them, and add new ones. Every member may (like labels). Statuses are never deleted: hiding one keeps it on the
 * issues that have it. Each group keeps at least one shown status. Everything saves by itself.
 *
 * On screen this says "group", never "category" (CLAUDE.md, writing). One component for every kind of status: issue
 * statuses now, project statuses later (`kind`).
 */
import { useMemo, useState } from 'react'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type Announcements, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, EyeOff, GripVertical, Plus } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { InlineText } from '@/components/InlineText'
import { createStatus, moveStatus, updateStatus } from '@/data/actions'
import { canHide, defaultStatus, statusesOf, statusNamed } from '@/data/statuses'
import { useData } from '@/data/store'
import { STATUS_COLORS } from '@/model/colors'
import type { Status } from '@/model/schema'
import { CATEGORIES, KIND_CATEGORIES, type StatusKind } from '@/model/status'
import { StatusIcon } from '@/features/issues/icons'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { cn } from '@/lib/utils'

/** a group as the page shows it: its name, what it decides, and an idea for splitting it */
interface GroupInfo {
  id: string
  name: string
  description: string
  /** "like Testing or Design review" */
  example: string
}

const ISSUE_EXAMPLES: Record<string, string> = {
  backlog: 'like Ideas or Later',
  todo: 'like Ready or Next up',
  in_progress: 'like Testing or Design review',
  in_review: 'like Code review or QA',
  done: 'like Released',
  canceled: 'like Won’t do or Not now',
  duplicate: 'like Already reported',
}

/** the groups of a kind, in order (project groups come with project statuses) */
function groupsOf(kind: StatusKind): GroupInfo[] {
  return KIND_CATEGORIES[kind].map((id) => {
    const c = kind === 'issue' ? CATEGORIES.find((x) => x.id === id) : undefined
    return { id, name: c?.name ?? id, description: c?.description ?? '', example: ISSUE_EXAMPLES[id] ?? '' }
  })
}

const MAX_NAME = 40
const CANT_HIDE = 'Each group needs at least one status that isn’t hidden. Add or show another one first.'

/** "New status", or "New status 2" when that's taken: names are unique */
function freshName(statuses: Record<string, Status>, kind: StatusKind): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'New status' : `New status ${n}`
    if (!statusNamed(statuses, kind, name)) return name
  }
}

const issuesText = (n: number) => (n === 1 ? '1 issue' : `${n} issues`)

interface RowProps {
  status: Status
  statuses: Record<string, Status>
  uses: number
  isDefault: boolean
  /** just added: its name is ready to type over */
  fresh: boolean
}

function StatusRow({ status, statuses, uses, isDefault, fresh }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })
  const [problem, setProblem] = useState<string | null>(null)
  const hideable = status.hidden || canHide(status, statuses)
  const taken = (name: string) => !!statusNamed(statuses, status.kind, name, status.id)
  const hint = `status-hint-${status.id}`

  const hide = (
    <Button
      variant="ghost"
      size="sm"
      className="w-[4.75rem] shrink-0 justify-start text-muted-foreground"
      disabled={!hideable}
      aria-describedby={!hideable ? hint : undefined}
      onClick={() => updateStatus(status.id, { hidden: !status.hidden })}
    >
      {status.hidden ? <Eye /> : <EyeOff />} {status.hidden ? 'Show' : 'Hide'}
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
          className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <ColorPicker
          value={status.color}
          colors={STATUS_COLORS}
          onPick={(color) => updateStatus(status.id, { color })}
          label={`Colour of ${status.name}`}
          swatch={(color, where) => <StatusIcon status={{ ...status, color }} className={where === 'menu' ? 'size-4' : undefined} />}
        />
        <span className={cn('flex min-w-0 flex-1 items-center gap-2', status.hidden && 'opacity-60')}>
          <InlineText
            value={status.name}
            onSave={(name) => updateStatus(status.id, { name })}
            allowed={(v) => !taken(v)}
            onTyping={(v) => setProblem(v === null ? null : !v.trim() ? 'Give it a name.' : taken(v.trim()) ? 'Another status is called that. Pick another name.' : null)}
            label={`Name of ${status.name}`}
            required
            maxLength={MAX_NAME}
            autoFocus={fresh}
            className="h-8 min-w-0 text-[15px]"
          />
          {status.hidden && <span className="shrink-0 text-sm text-muted-foreground">Hidden</span>}
          {isDefault && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="hidden shrink-0 rounded-sm text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:inline">
                  Default
                </span>
              </TooltipTrigger>
              <TooltipContent>Issues that come into this group without a status of their own (from GitHub or the import) get this one</TooltipContent>
            </Tooltip>
          )}
        </span>
        <span className="w-16 shrink-0 text-right text-sm text-muted-foreground tabular-nums sm:w-20">{issuesText(uses)}</span>
        {hideable ? (
          hide
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* a disabled button hears no pointer, so the reason sits on what holds it */}
              <span tabIndex={0} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                {hide}
              </span>
            </TooltipTrigger>
            <TooltipContent>{CANT_HIDE}</TooltipContent>
          </Tooltip>
        )}
        {!hideable && (
          <span id={hint} className="sr-only">
            {CANT_HIDE}
          </span>
        )}
      </div>
      {problem && (
        <p role="status" className="pb-1 pl-[4.75rem] text-sm text-destructive-text">
          {problem}
        </p>
      )}
    </li>
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

function StatusGroup({ kind, group, list, statuses, uses, fresh, onAdd }: GroupProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // on a touch screen, press and hold the handle a moment; a swipe elsewhere still scrolls
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
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
            {list.map((s) => (
              <StatusRow key={s.id} status={s} statuses={statuses} uses={uses.get(s.id) ?? 0} isDefault={s.id === first?.id} fresh={s.id === fresh} />
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
  const [fresh, setFresh] = useState<string | null>(null)
  const all = useMemo(() => statusesOf(statuses, kind), [statuses, kind])
  // open issues per status (the archive isn't counted: it isn't read until something needs it)
  const uses = useMemo(() => {
    const out = new Map<string, number>()
    if (kind === 'issue') for (const i of Object.values(issues)) out.set(i.statusId, (out.get(i.statusId) ?? 0) + 1)
    return out
  }, [issues, kind])
  const add = (group: string) => {
    const made = createStatus(kind, group, freshName(statuses, kind))
    if (made) setFresh(made.id)
  }

  return (
    <div className="flex flex-col divide-y">
      {groupsOf(kind).map((g) => (
        <StatusGroup key={g.id} kind={kind} group={g} list={all.filter((s) => s.category === g.id)} statuses={statuses} uses={uses} fresh={fresh} onAdd={add} />
      ))}
    </div>
  )
}
