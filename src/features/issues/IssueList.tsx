/** Issues as rows, grouped (by status unless the display says otherwise). Rows can be dragged (useIssueDrag.ts). */
import { memo, useMemo, useState, type CSSProperties, type HTMLAttributes, type Ref } from 'react'
import { Link } from 'wouter'
import { ChevronDown, Plus } from 'lucide-react'
import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { PersonAvatar } from '@/components/Avatar'
import { LabelChip } from '@/components/LabelChip'
import { ProjectChip } from '@/components/ProjectChip'
import { PROPERTY_DEFAULTS, type Fields } from '@/data/displays'
import { nestChildren, type Group } from '@/data/select'
import { issueRef, useData } from '@/data/store'
import type { Display, Issue } from '@/model/schema'
import { cn } from '@/lib/utils'
import { PriorityIcon, IssueStatusIcon } from './icons'
import { GroupIcon } from './GroupIcon'
import { DueChip, EstimateChip } from './DueDate'
import { shortDate } from './format'
import { SubIssueCount } from './SubIssueCount'
import { ChecklistCount } from './ChecklistCount'
import { TitleText } from './TitleText'
import { dragAnnouncements } from './dragText'
import { CarryCount } from './CarryCount'
import { selectionClick, useSelection } from './selection'
import { AUTO_SCROLL, columnDropId } from '@/features/board/columnsDrag'
import { useIssueDrag } from './useIssueDrag'
import { PriorityButton } from './PriorityButton'
import { ROW_CONTROL, useSortableRow } from './rowControls'

interface RowProps {
  issue: Issue
  depth?: number
  /** drag-n-drop wiring, when the row can be dragged */
  dragRef?: Ref<HTMLAnchorElement>
  dragProps?: HTMLAttributes<HTMLElement>
  style?: CSSProperties
  /** the place the row was picked up from, while it's being dragged */
  ghost?: boolean
  /** the copy under the pointer */
  lifted?: boolean
  /** what the row shows besides status and title (the page's Display) */
  fields?: Fields
}

/*
 * What fits goes by the row's own width (it's a container), never the window's: an open sidebar, a side panel and a
 * phone all count alike. In the order they give way: chips (they only get the room the title leaves), the estimate,
 * then progress (dropped whole, only when the title would get less than its room), then on rows under 23rem the ID
 * and the day it was made. Rows under 30rem are tighter. The steps (23, 30 and 38.5rem) keep the title at least 7rem
 * (8rem from 30rem) and stay clear of the widths common screens give (with or without a scroll bar), so nothing
 * comes and goes as a list starts scrolling. docs/design.md has the sums.
 */
/** memoised: a list of thousands draws again only the rows whose issue (or what they show) changed */
export const IssueRow = memo(function IssueRow({ issue, depth = 0, dragRef, dragProps, style, ghost, lifted, fields = PROPERTY_DEFAULTS.list }: RowProps) {
  const assignee = useData((s) => (issue.assignee ? s.people[issue.assignee] : undefined))
  const labels = useData((s) => s.labels)
  const picked = useSelection((s) => s.ids.includes(issue.id))
  const carried = useSelection((s) => s.draggingMany) && picked && !lifted
  const closed = issue.status === 'done' || issue.status === 'canceled' || issue.status === 'duplicate'
  const shownLabels = fields.labels ? issue.labels.filter((id) => labels[id]) : []
  const chips = (fields.project && issue.project) || shownLabels.length > 0
  return (
    <Link
      ref={dragRef}
      {...dragProps}
      href={`/issue/${issueRef(issue)}`}
      data-issue-id={lifted ? undefined : issue.id}
      data-picked={picked || undefined}
      aria-selected={picked || undefined}
      // capture: the link itself leaves ⌘/Shift-clicks to the browser (new tab), before an onClick would run
      onClickCapture={(e) => selectionClick(e, issue.id)}
      // a click on the priority button (or another control in the row) only works that control
      onClick={(e) => (e.target as Element).closest(ROW_CONTROL) && e.preventDefault()}
      className={cn(
        'group @container block h-11 rounded-md pl-4 pr-2 text-ui sm:pr-4 hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring touch-manipulation select-none [-webkit-touch-callout:none]',
        (ghost || carried) && 'opacity-30',
        picked && !lifted && 'bg-accent ring-1 ring-inset ring-ring',
        lifted && 'cursor-grabbing border bg-popover shadow-lg',
      )}
      style={style}
    >
      {/* sub-issues sit further in, inside the row, so every row of a list has the same width to fill */}
      <span className="flex h-full items-center gap-1.5 @min-[30rem]:gap-3" style={depth ? { paddingLeft: `${depth * 2}rem` } : undefined}>
        {fields.priority && (lifted ? <PriorityIcon priority={issue.priority} /> : <PriorityButton issue={issue} look="row" />)}
        {fields.id && (
          <span className="hidden shrink-0 whitespace-nowrap text-ref text-muted-foreground tabular-nums @min-[23rem]:inline @min-[30rem]:min-w-[5.75em]">{issueRef(issue)}</span>
        )}
        <IssueStatusIcon issue={issue} />
        <span className={cn('min-w-0 truncate text-row-title', closed && 'text-muted-foreground')}>
          <TitleText title={issue.title} />
        </span>
        {fields.progress && (
          // gives way (whole, onto a line that isn't shown) before the title gets less than its room
          <span className="flex h-6 min-w-0 shrink-[1000000] flex-wrap items-center gap-2 overflow-hidden empty:hidden">
            <SubIssueCount id={issue.id} className="shrink-0" />
            <ChecklistCount description={issue.description} className="shrink-0" />
          </span>
        )}
        {chips && (
          // the room after the title: chips that don't fit drop out whole from the end (they wrap onto a line that isn't
          // shown), one alone ends in "…", and with almost no room there are none
          <span
            className="@container hidden h-6 min-w-0 flex-1 basis-0 flex-wrap justify-end gap-2 overflow-hidden @min-[38.5rem]:flex"
            title={shownLabels.length ? shownLabels.map((id) => labels[id].name).join(', ') : undefined}
          >
            {fields.project && <ProjectChip id={issue.project} className="max-w-40 shrink @max-[3rem]:hidden" />}
            {shownLabels.map((id) => (
              <LabelChip key={id} label={labels[id]} className="min-w-0 max-w-32 shrink @max-[3rem]:hidden" />
            ))}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 @min-[30rem]:gap-2">
          {fields.estimate && issue.estimate != null && <EstimateChip points={issue.estimate} className="hidden @min-[38.5rem]:inline-flex" />}
          {fields.dueDate && issue.dueDate && <DueChip day={issue.dueDate} closed={closed} />}
          {fields.assignee && <PersonAvatar person={assignee} login={issue.assignee} />}
          {fields.created && (
            <span className="hidden text-right text-sm text-muted-foreground @min-[23rem]:inline @min-[30rem]:w-14" title={`Created ${shortDate(issue.createdAt)}`}>
              {shortDate(issue.createdAt)}
            </span>
          )}
        </span>
      </span>
    </Link>
  )
})

const SortableRow = memo(function SortableRow({ issue, depth, fields }: { issue: Issue; depth: number; fields: Fields }) {
  return <IssueRow issue={issue} depth={depth} fields={fields} {...useSortableRow(issue.id)} />
})

interface SectionProps {
  group: Group
  ids: string[]
  issueOf: (id: string) => Issue | undefined
  onAdd?: (group: Group) => void
  fields: Fields
}

function GroupSection({ group, ids, issueOf, onAdd, fields }: SectionProps) {
  const [open, setOpen] = useState(true)
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(group.key) })
  // how deep each row sits (sub-issues under their parent); an issue dragged in from elsewhere sits at the top level
  const depths = useMemo(() => new Map(nestChildren(group.issues).map((r) => [r.issue.id, r.depth])), [group.issues])
  return (
    <section ref={setNodeRef} className={cn('rounded-lg', isOver && !open && 'ring-1 ring-ring')}>
      <div className="sticky top-0 z-10 flex h-11 items-center gap-3 rounded-lg bg-accent/70 px-4 backdrop-blur">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 text-ui font-medium" aria-expanded={open}>
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
          <GroupIcon group={group} />
          {group.title}
          <span className="font-normal text-muted-foreground tabular-nums">{ids.length}</span>
        </button>
        {onAdd && (
          <button type="button" onClick={() => onAdd(group)} className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`New issue in ${group.title}`}>
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <SortableContext id={group.key} items={ids} strategy={verticalListSortingStrategy}>
          <div className="min-h-2 py-1">
            {ids.map((id) => {
              const issue = issueOf(id)
              return issue && <SortableRow key={id} issue={issue} depth={depths.get(id) ?? 0} fields={fields} />
            })}
          </div>
        </SortableContext>
      )}
    </section>
  )
}

export function IssueList({ groups, display, onAdd, fields }: { groups: Group[]; display: Display; onAdd?: (group: Group) => void; fields: Fields }) {
  const drag = useIssueDrag(groups, display, { nest: true })
  const active = drag.activeId ? drag.issue(drag.activeId) : undefined
  const issues = useData((s) => s.issues)
  return (
    <DndContext {...drag.dnd} autoScroll={AUTO_SCROLL} accessibility={{ announcements: dragAnnouncements(issues, groups, drag.order) }}>
      <div className="flex flex-col gap-1" onClickCapture={(e) => drag.justDropped() && e.preventDefault()}>
        {groups
          // a group that empties while you drag stays put until you drop
          .filter((g) => g.issues.length > 0 || drag.order[g.key]?.length > 0)
          .map((g) => (
            <GroupSection key={g.key} group={g} ids={drag.order[g.key] ?? []} issueOf={drag.issue} onAdd={onAdd} fields={fields} />
          ))}
      </div>
      <DragOverlay>
        {active && (
          <div className="relative">
            <IssueRow issue={active} lifted fields={fields} />
            <CarryCount />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
