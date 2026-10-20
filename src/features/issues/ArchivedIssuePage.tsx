/**
 * An archived issue (IssuePage shows this when the link is to one): out of every list and board, but still here to read, link to and find. Nothing on it can change
 * until someone brings it back with Restore.
 */
import type { ReactNode } from 'react'
import { Archive } from 'lucide-react'
import { toast } from 'sonner'
import { PersonAvatar } from '@/components/Avatar'
import { LabelChip } from '@/components/LabelChip'
import { Markdown } from '@/components/Markdown'
import { restoreIssue } from '@/data/actions'
import { issueRef, useData } from '@/data/store'
import { useMedia } from '@/lib/useNarrow'
import { cn } from '@/lib/utils'
import type { ArchivedIssue } from '@/model/schema'
import { PRIORITY_NAMES } from '@/model/status'
import { Button } from '@/ui/button'
import { Comments } from './Comments'
import { PullRequests } from './PullRequests'
import { DueChip, EstimateIcon } from './DueDate'
import { estimateName, shortDate } from './format'
import { IssueStatusName, PriorityIcon } from './icons'

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      <span className="w-24 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-2 text-[15px]">{children}</div>
    </div>
  )
}

const none = <span className="text-muted-foreground">None</span>

export function ArchivedIssuePage({ issue }: { issue: ArchivedIssue }) {
  const people = useData((s) => s.people)
  const labels = useData((s) => s.labels)
  const project = useData((s) => (issue.project ? s.projects[issue.project] : undefined))
  const stacked = useMedia('(max-width: 1023px)')
  const assignee = issue.assignee ? people[issue.assignee] : undefined

  const restore = () => {
    const back = restoreIssue(issue.id)
    if (back) toast(`Restored ${issueRef(back)}`, { description: 'It’s back in its team’s lists.' })
  }

  const properties = (
    <div className="flex flex-col gap-1">
      <Property label="Status">
        <IssueStatusName issue={issue} />
      </Property>
      <Property label="Priority">
        <PriorityIcon priority={issue.priority} /> {PRIORITY_NAMES[issue.priority]}
      </Property>
      <Property label="Assignee">
        {issue.assignee ? (
          <>
            <PersonAvatar person={assignee} login={issue.assignee} /> {assignee?.name ?? issue.assignee}
          </>
        ) : (
          <span className="text-muted-foreground">No one</span>
        )}
      </Property>
      <Property label="Labels">{issue.labels.filter((id) => labels[id]).length ? issue.labels.map((id) => labels[id] && <LabelChip key={id} label={labels[id]} />) : none}</Property>
      <Property label="Project">
        {project ? (
          <>
            <span className="w-4 text-center leading-none">{project.emoji}</span> {project.name}
          </>
        ) : (
          none
        )}
      </Property>
      <Property label="Due date">{issue.dueDate ? <DueChip day={issue.dueDate} closed className="border-0 px-0 text-[15px]" /> : none}</Property>
      <Property label="Estimate">
        {issue.estimate != null ? (
          <>
            <EstimateIcon /> {estimateName(issue.estimate)}
          </>
        ) : (
          none
        )}
      </Property>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1">
      <article className="min-w-0 flex-1 overflow-y-auto px-4 py-6 lg:px-12 lg:py-10">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border bg-accent/30 px-4 py-3 text-sm" role="status">
            <Archive className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              {issue.archivedBy ? (
                <>
                  Archived {shortDate(issue.archivedAt)} by {people[issue.archivedBy]?.name ?? 'someone'}.
                </>
              ) : (
                <>Archived automatically {shortDate(issue.archivedAt)}.</>
              )}{' '}
              It’s out of every list, but you can still read it here.
            </span>
            <Button size="sm" variant="outline" onClick={restore}>
              Restore
            </Button>
          </div>
          <h1 className="text-2xl font-semibold break-words">{issue.title}</h1>
          <PullRequests issueId={issue.id} />
          {stacked && <div className="mt-4 rounded-lg border px-2 py-2">{properties}</div>}
          {issue.description ? (
            <div className="prose-sprawniej mt-4">
              <Markdown references>{issue.description}</Markdown>
            </div>
          ) : (
            <p className="mt-4 text-muted-foreground">No description.</p>
          )}
          <Comments issue={issue} archived={issue} />
        </div>
      </article>
      {!stacked && (
        <aside className="w-80 shrink-0 overflow-y-auto border-l px-5 py-8">
          {properties}
          <p className={cn('mt-8 px-2 text-xs text-muted-foreground')}>
            Created {shortDate(issue.createdAt)}
            {issue.createdBy && <> by {people[issue.createdBy]?.name ?? issue.createdBy}</>}
          </p>
        </aside>
      )}
    </div>
  )
}
