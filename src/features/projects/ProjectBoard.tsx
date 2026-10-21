/**
 * Projects as cards in columns, one column per shown project status (empty ones too, so there is somewhere to drop).
 * A hidden status that still has projects gets a column at the end, marked Hidden: cards can leave it, not join it.
 * Dragging a card to another column changes its status; dragging within a column changes its place.
 */
import { useId, useMemo, useState, type CSSProperties, type HTMLAttributes, type Ref } from 'react'
import { Link } from 'wouter'
import { CalendarDays, Plus } from 'lucide-react'
import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PersonAvatar } from '@/components/Avatar'
import { useRingTip } from '@/components/ringTip'
import { progressOf, projectColumns, type ProjectColumn } from '@/data/select'
import { useData } from '@/data/store'
import { shortDate } from '@/features/issues/format'
import type { Project } from '@/model/schema'
import { cn } from '@/lib/utils'
import { shortText } from '@/lib/text'
import { AUTO_SCROLL, columnDropId } from '@/features/board/columnsDrag'
import { projectDragAnnouncements } from './dragText'
import { issueCountText } from './progressText'
import { ProjectRing } from './ProjectRing'
import { StatusDot } from './StatusDot'
import { useProjectCounts } from './useProjectCounts'
import { useProjectDrag } from './useProjectDrag'

interface CardProps {
  project: Project
  dragRef?: Ref<HTMLAnchorElement>
  dragProps?: HTMLAttributes<HTMLElement>
  style?: CSSProperties
  ghost?: boolean
  lifted?: boolean
}

/**
 * A project on the board: emoji, name, progress ring and lead; the start of its description; its target date and how
 * many issues count. A screen reader hears the emoji and name, the ring's first line ("66% done: 8 of 12 issues"),
 * the lead and the target date (the count is in the ring's line), then how to drag it and the description, as the
 * card's description.
 */
function ProjectCard({ project: p, dragRef, dragProps, style, ghost, lifted }: CardProps) {
  const lead = useData((s) => (p.lead ? s.people[p.lead] : undefined))
  const counts = useProjectCounts(p.id)
  const { total } = progressOf(counts)
  const tip = useRingTip()
  // a card picked up (or its copy under the pointer) shows no tooltip, and doesn't bring it back when dropped
  const still = !!(ghost || lifted)
  const [wasStill, setWasStill] = useState(still)
  if (still !== wasStill) {
    setWasStill(still)
    if (still) tip.setOpen(false)
  }
  const description = useMemo(() => shortText(p.description), [p.description])
  const descriptionId = useId()
  const describedBy = [dragProps?.['aria-describedby'], description && descriptionId].filter(Boolean).join(' ') || undefined
  return (
    <Link
      ref={dragRef}
      {...dragProps}
      {...(!lifted && tip.focusProps)}
      aria-describedby={describedBy}
      href={`/project/${p.id}`}
      style={style}
      className={cn(
        'relative flex flex-col gap-2 rounded-lg border bg-card p-3 text-ui shadow-xs hover:border-ring/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring touch-manipulation select-none [-webkit-touch-callout:none]',
        ghost && 'opacity-30',
        lifted && 'cursor-grabbing rotate-1 shadow-lg',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-emoji leading-6">{p.emoji}</span>
        <span className="line-clamp-3 min-w-0 flex-1 font-medium leading-6 [overflow-wrap:anywhere]">{p.name}</span>
        <span className="flex h-6 shrink-0 items-center gap-2">
          <ProjectRing counts={counts} tip={tip} still={still} />
          {p.lead && <PersonAvatar person={lead} login={p.lead} />}
        </span>
      </div>
      {description && (
        <p id={descriptionId} aria-hidden className="line-clamp-2 text-sm break-words text-muted-foreground [overflow-wrap:anywhere]">
          {description}
        </p>
      )}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        {p.targetDate && (
          <span className="flex items-center gap-1.5 [&_svg]:size-3.5">
            <CalendarDays /> {shortDate(p.targetDate)}
          </span>
        )}
        <span className="ml-auto tabular-nums" aria-hidden>
          {issueCountText(total)}
        </span>
      </div>
    </Link>
  )
}

function SortableCard({ project }: { project: Project }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })
  return (
    <ProjectCard
      project={project}
      dragRef={setNodeRef}
      dragProps={{ ...attributes, role: undefined, ...listeners }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      ghost={isDragging}
    />
  )
}

const iconButton = 'rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground'

function Column({ column, ids, projectOf, onAdd }: { column: ProjectColumn; ids: string[]; projectOf: (id: string) => Project | undefined; onAdd?: (statusId: string) => void }) {
  const { status } = column
  // a hidden status's column takes nothing, but stays a droppable, so a project let go over it goes back where it came
  // from (useProjectDrag) instead of into the column next to it
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(status.id) })
  return (
    <section ref={setNodeRef} aria-label={status.name} className={cn('flex w-[21rem] shrink-0 flex-col rounded-xl bg-accent/30 transition-colors', isOver && !status.hidden && 'bg-accent/50')}>
      <header className="flex h-12 items-center gap-2.5 px-4 text-ui font-medium">
        <StatusDot status={status} />
        <span className="truncate">{status.name}</span>
        <span className="font-normal text-muted-foreground tabular-nums">{ids.length}</span>
        {status.hidden ? (
          <span className="ml-auto rounded-md border px-1.5 text-xs font-normal text-muted-foreground" title="This status is hidden: projects can leave it, but not be put in it">
            Hidden
          </span>
        ) : (
          onAdd && (
            <button type="button" onClick={() => onAdd(status.id)} className={cn(iconButton, 'ml-auto')} aria-label={`New project in ${status.name}`}>
              <Plus className="size-4" />
            </button>
          )
        )}
      </header>
      <SortableContext id={status.id} items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {ids.map((id) => {
            const project = projectOf(id)
            return project && <SortableCard key={id} project={project} />
          })}
          {ids.length === 0 && !status.hidden && <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Drop a project here</p>}
        </div>
      </SortableContext>
    </section>
  )
}

/** `onAdd`: "+" on a column, a new project in that status. Each card reads its own counts (useProjectCounts). */
export function ProjectBoard({ projects, onAdd }: { projects: Project[]; onAdd?: (statusId: string) => void }) {
  const statuses = useData((s) => s.statuses)
  const all = useData((s) => s.projects)
  const columns = useMemo(() => projectColumns(projects, statuses), [projects, statuses])
  const drag = useProjectDrag(columns)
  const active = drag.activeId ? drag.project(drag.activeId) : undefined
  return (
    <DndContext {...drag.dnd} autoScroll={AUTO_SCROLL} accessibility={{ announcements: projectDragAnnouncements(all, columns, drag.order) }}>
      <div className="flex h-full gap-4 overflow-x-auto pb-4" onClickCapture={(e) => drag.justDropped() && e.preventDefault()}>
        {columns.map((c) => (
          <Column key={c.status.id} column={c} ids={drag.order[c.status.id] ?? []} projectOf={drag.project} onAdd={onAdd} />
        ))}
      </div>
      <DragOverlay>{active && <ProjectCard project={active} lifted />}</DragOverlay>
    </DndContext>
  )
}
