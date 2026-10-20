/**
 * Projects as cards in columns, one column per shown project status (empty ones too, so there is somewhere to drop).
 * A hidden status that still has projects gets a column at the end, marked Hidden: cards can leave it, not join it.
 * Dragging a card to another column changes its status; dragging within a column changes its place.
 */
import { useMemo, type CSSProperties, type HTMLAttributes, type Ref } from 'react'
import { Link } from 'wouter'
import { CalendarDays, Plus } from 'lucide-react'
import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PersonAvatar } from '@/components/Avatar'
import { projectColumns, projectProgress, type ProjectColumn } from '@/data/select'
import { useData } from '@/data/store'
import { shortDate } from '@/features/issues/format'
import type { Issue, Project } from '@/model/schema'
import { cn } from '@/lib/utils'
import { AUTO_SCROLL, columnDropId } from '@/features/board/columnsDrag'
import { projectDragAnnouncements } from './dragText'
import { StatusDot } from './StatusDot'
import { useProjectDrag } from './useProjectDrag'

interface CardProps {
  project: Project
  issues: Issue[]
  dragRef?: Ref<HTMLAnchorElement>
  dragProps?: HTMLAttributes<HTMLElement>
  style?: CSSProperties
  ghost?: boolean
  lifted?: boolean
}

function ProjectCard({ project: p, issues, dragRef, dragProps, style, ghost, lifted }: CardProps) {
  const lead = useData((s) => (p.lead ? s.people[p.lead] : undefined))
  const { done, total } = projectProgress(p.id, issues)
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <Link
      ref={dragRef}
      {...dragProps}
      href={`/project/${p.id}`}
      style={style}
      className={cn(
        'flex flex-col gap-2.5 rounded-lg border bg-card p-3 text-[15px] shadow-xs hover:border-ring/60 focus-visible:border-ring focus-visible:outline-none touch-manipulation select-none [-webkit-touch-callout:none]',
        ghost && 'opacity-30',
        lifted && 'cursor-grabbing rotate-1 shadow-lg',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg leading-6">{p.emoji}</span>
        <span className="line-clamp-3 flex-1 font-medium leading-6">{p.name}</span>
        {p.lead && (
          <span className="mt-0.5">
            <PersonAvatar person={lead} login={p.lead} />
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        {p.targetDate && (
          <span className="flex items-center gap-1.5 [&_svg]:size-3.5">
            <CalendarDays /> {shortDate(p.targetDate)}
          </span>
        )}
        <span className="ml-auto flex w-28 items-center gap-2" role="img" aria-label={`${pct}% done`}>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-status-done" style={{ width: `${pct}%` }} />
          </span>
          <span className="w-9 text-right tabular-nums">{pct}%</span>
        </span>
      </div>
    </Link>
  )
}

function SortableCard({ project, issues }: { project: Project; issues: Issue[] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })
  return (
    <ProjectCard
      project={project}
      issues={issues}
      dragRef={setNodeRef}
      dragProps={{ ...attributes, role: undefined, ...listeners }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      ghost={isDragging}
    />
  )
}

const iconButton = 'rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground'

function Column({ column, ids, projectOf, issues, onAdd }: { column: ProjectColumn; ids: string[]; projectOf: (id: string) => Project | undefined; issues: Issue[]; onAdd?: (statusId: string) => void }) {
  const { status } = column
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(status.id), disabled: status.hidden })
  return (
    <section ref={setNodeRef} aria-label={status.name} className={cn('flex w-[21rem] shrink-0 flex-col rounded-xl bg-accent/30 transition-colors', isOver && 'bg-accent/50')}>
      <header className="flex h-12 items-center gap-2.5 px-4 text-[15px] font-medium">
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
            return project && <SortableCard key={id} project={project} issues={issues} />
          })}
          {ids.length === 0 && !status.hidden && <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Drop a project here</p>}
        </div>
      </SortableContext>
    </section>
  )
}

/** `issues`: what progress counts (useProgressIssues); `onAdd`: "+" on a column, a new project in that status */
export function ProjectBoard({ projects, issues, onAdd }: { projects: Project[]; issues: Issue[]; onAdd?: (statusId: string) => void }) {
  const statuses = useData((s) => s.statuses)
  const all = useData((s) => s.projects)
  const columns = useMemo(() => projectColumns(projects, statuses), [projects, statuses])
  const drag = useProjectDrag(columns)
  const active = drag.activeId ? drag.project(drag.activeId) : undefined
  return (
    <DndContext {...drag.dnd} autoScroll={AUTO_SCROLL} accessibility={{ announcements: projectDragAnnouncements(all, columns, drag.order) }}>
      <div className="flex h-full gap-4 overflow-x-auto pb-4" onClickCapture={(e) => drag.justDropped() && e.preventDefault()}>
        {columns.map((c) => (
          <Column key={c.status.id} column={c} ids={drag.order[c.status.id] ?? []} projectOf={drag.project} issues={issues} onAdd={onAdd} />
        ))}
      </div>
      <DragOverlay>{active && <ProjectCard project={active} issues={issues} lifted />}</DragOverlay>
    </DndContext>
  )
}
