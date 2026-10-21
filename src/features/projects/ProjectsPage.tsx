/**
 * Projects, as a list (name with emoji, status, progress ring and lead, target date and how many issues count, by
 * name) or as a board (a column per status). List or Board is remembered per page in this browser. "New project"
 * starts one.
 */
import { useState } from 'react'
import { Link, useParams } from 'wouter'
import { Box, Columns3, List, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useCrumbs } from '@/app/chrome'
import { PersonAvatar } from '@/components/Avatar'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmojiPicker } from '@/components/EmojiPicker'
import { FavouriteButton } from '@/components/FavouriteButton'
import { EmptyState } from '@/components/EmptyState'
import { InlineText } from '@/components/InlineText'
import { useRingTip } from '@/components/ringTip'
import { Segmented } from '@/components/Segmented'
import { deleteProject, updateProject } from '@/data/actions'
import { useDisplay } from '@/data/displays'
import { progressOf } from '@/data/select'
import { statusOfProject } from '@/data/statuses'
import { useData } from '@/data/store'
import { shortDate } from '@/features/issues/format'
import type { Person, Project } from '@/model/schema'
import { Button } from '@/ui/button'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { NewProjectDialog } from './NewProjectDialog'
import { ProjectBoard } from './ProjectBoard'
import { progressWords } from './progressText'
import { ProjectRing } from './ProjectRing'
import { StatusDot } from './StatusDot'
import { useArchiveForProgress, useProjectCounts } from './useProjectCounts'

// on a phone the status and lead columns shrink to their dot, ring and picture (the words stay for screen readers),
// so the name keeps the room
const STATUS = 'w-4 shrink-0 sm:w-32'
const LEAD = 'w-11 shrink-0 sm:w-44'

/** one project in the list: its emoji changes in place, the star keeps it in your sidebar, and ⋯ renames or deletes it */
function ProjectRow({ project: p, lead }: { project: Project; lead?: Person }) {
  const status = useData((s) => statusOfProject(p, s.statuses))
  const counts = useProjectCounts(p.id)
  const { total } = progressOf(counts)
  const tip = useRingTip()
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 sm:gap-4 sm:px-4 text-ui hover:bg-accent/60">
      <EmojiPicker value={p.emoji} onChange={(emoji) => updateProject(p.id, { emoji })} label={`Change the emoji of ${p.name}`} className="size-9 border-transparent text-emoji hover:border-border" />
      {renaming ? (
        <span className="min-w-0 flex-1">
          <InlineText value={p.name} onSave={(name) => updateProject(p.id, { name })} label="Project name" required autoFocus onDone={() => setRenaming(false)} className="text-field font-medium" />
        </span>
      ) : (
        <Link href={`/project/${p.id}`} {...tip.focusProps} className="flex min-w-0 flex-1 items-center gap-3 py-1.5 sm:gap-4">
          <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
          <span className={cn(STATUS, 'flex items-center gap-2 text-muted-foreground')}>
            <StatusDot status={status} /> <span className="truncate max-sm:sr-only">{status.name}</span>
          </span>
          <span className={cn(LEAD, 'flex items-center gap-2')}>
            <ProjectRing counts={counts} tip={tip} />
            <span className="sr-only">{progressWords(counts)[0]}</span>
            {p.lead ? (
              <>
                <PersonAvatar person={lead} login={p.lead} />
                <span className="truncate max-sm:sr-only">{lead?.name ?? p.lead}</span>
              </>
            ) : (
              <span className="truncate text-muted-foreground max-sm:sr-only">No lead</span>
            )}
          </span>
          <span className="hidden w-28 text-muted-foreground md:block">{p.targetDate ? shortDate(p.targetDate) : '–'}</span>
          <span className="hidden w-20 text-right text-muted-foreground tabular-nums md:block">{total || '–'}</span>
        </Link>
      )}
      <span className="flex items-center">
        <FavouriteButton kind="project" id={p.id} name={p.name} row />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${p.name}`} className="[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          {/* focus goes to the name field (or the dialog) next, not back to this button */}
          <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true))}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
              <Trash2 /> Delete project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete “${p.name}”?`} confirm="Delete project" onConfirm={() => deleteProject(p.id)}>
        The project goes away for everyone. Its issues stay, just without a project.
      </ConfirmDialog>
    </div>
  )
}

export function ProjectsPage() {
  const { key } = useParams<{ key?: string }>()
  const team = useData((s) => (key ? s.teams[key] : undefined))
  const projects = useData(useShallow((s) => Object.values(s.projects).filter((p) => (key ? p.teams.includes(key) : true))))
  useArchiveForProgress()
  const people = useData((s) => s.people)
  const { display, setDisplay } = useDisplay(key ? `projects:${key}` : 'projects')
  useCrumbs(team ? [{ label: `${team.emoji} ${team.name}` }, { label: 'Projects' }] : [{ label: 'Projects' }])
  // null: closed; a status id: open, starting in that status ("+" on a board column); '': open, in Planned
  const [creating, setCreating] = useState<string | null>(null)
  const dialog = creating !== null && <NewProjectDialog onOpenChange={(open) => !open && setCreating(null)} team={key} statusId={creating || undefined} />
  const newButton = (
    <Button variant="outline" onClick={() => setCreating('')}>
      <Plus /> New project
    </Button>
  )
  if (!projects.length) {
    return (
      <>
        <EmptyState icon={<Box />} title="No projects yet" action={newButton}>
          A project is a bigger goal made of several issues, like “New onboarding”. It shows how much is done.
        </EmptyState>
        {dialog}
      </>
    )
  }
  const board = display.layout === 'board'
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className={board ? 'flex min-h-0 flex-1 flex-col gap-4 px-4 pt-6 md:px-8' : 'flex-1 overflow-y-auto px-4 pt-6 md:px-8'}>
      <div className={cn('flex items-center justify-end gap-2', !board && 'mb-4')}>
        {newButton}
        <Segmented
          label="Layout"
          value={display.layout}
          onChange={(layout) => setDisplay({ layout })}
          options={[
            { value: 'list', name: 'List', label: <><List /> <span className="hidden sm:inline">List</span></> },
            { value: 'board', name: 'Board', label: <><Columns3 /> <span className="hidden sm:inline">Board</span></> },
          ]}
        />
      </div>
      {board ? (
        <div className="min-h-0 flex-1">
          <ProjectBoard projects={projects} onAdd={(statusId) => setCreating(statusId)} />
        </div>
      ) : (
        <>
          <div className="flex h-10 items-center gap-4 border-b px-2 text-sm text-muted-foreground sm:px-4">
            <span className="flex-1 pl-11 sm:pl-12">Name</span>
            <span className="hidden w-32 sm:block">Status</span>
            <span className="hidden w-44 sm:block">Lead</span>
            <span className="hidden w-28 md:block">Target date</span>
            <span className="hidden w-20 text-right md:block">Issues</span>
            <span className="w-16" />
          </div>
          {sorted.map((p) => (
            <ProjectRow key={p.id} project={p} lead={p.lead ? people[p.lead] : undefined} />
          ))}
        </>
      )}
      {dialog}
    </div>
  )
}
