/**
 * Things that happened to you: assigned, mentioned, a comment or a status change on an issue you follow. Opening a note (or
 * its issue) marks it read. Old notes tidy themselves away (the database's nightly job).
 */
import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { Check, CheckCheck, Inbox, MoreHorizontal, Trash2, X } from 'lucide-react'
import { useCrumbs } from '@/app/chrome'
import { PersonAvatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { deleteInboxItems, markAllRead, markRead } from '@/data/actions'
import { loadArchive } from '@/backend'
import { isUnread } from '@/data/select'
import { issueRef, useData } from '@/data/store'
import { shortDate } from '@/features/issues/format'
import { StatusIcon } from '@/features/issues/icons'
import { jumpToComment } from '@/features/issues/jumpTo'
import { statusOf } from '@/model/status'
import type { InboxItem } from '@/model/schema'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/** a comment's first words, without Markdown marks */
function snippet(md: string | undefined): string {
  if (!md) return ''
  const text = md.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~[\]]|\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

function useWhat(n: InboxItem): string {
  const body = useData((s) => (n.comment ? s.comments[n.issue]?.find((c) => c.id === n.comment)?.body : undefined))
  switch (n.type) {
    case 'assigned':
      return 'assigned you'
    case 'mentioned':
      return body ? `mentioned you: ${snippet(body)}` : 'mentioned you'
    case 'commented':
      return body ? `commented: ${snippet(body)}` : 'commented'
    case 'status':
      return n.status ? `marked it ${statusOf(n.status).name}` : 'changed the status'
  }
}

function Note({ n, unread }: { n: InboxItem; unread: boolean }) {
  const [, navigate] = useLocation()
  // a note can be about an issue archived since
  const issue = useData((s) => s.issues[n.issue] ?? s.archive[n.issue])
  const actor = useData((s) => s.people[n.actor])
  const what = useWhat(n)
  const open = () => {
    markRead([n.id])
    if (!issue) return
    jumpToComment(n.comment)
    navigate(`/issue/${issueRef(issue)}`)
  }
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center gap-4 rounded-md px-4 py-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className={cn('size-2 shrink-0 rounded-full', unread && 'bg-status-done')} aria-label={unread ? 'Unread' : undefined} />
        <PersonAvatar person={actor} login={n.actor} className="size-8 text-xs" />
        <span className="min-w-0 flex-1">
          <span className={cn('flex items-center gap-2 truncate text-[15px]', !unread && 'text-foreground/80')}>
            {issue ? (
              <>
                <StatusIcon status={issue.status} />
                <span className="shrink-0 text-muted-foreground">{issueRef(issue)}</span>
                <span className={cn('truncate', unread && 'font-medium')}>{issue.title}</span>
              </>
            ) : (
              'A deleted issue'
            )}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {actor?.name ?? n.actor} {what}
          </span>
        </span>
        <span className="text-sm text-muted-foreground group-hover:invisible group-focus-within:invisible">{shortDate(n.at)}</span>
      </button>
      <span className="invisible absolute top-1/2 right-3 flex -translate-y-1/2 gap-1 group-hover:visible group-focus-within:visible">
        {unread && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Mark as read" onClick={() => markRead([n.id])}>
                <Check />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mark as read</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => deleteInboxItems([n.id])}>
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      </span>
    </li>
  )
}

export function InboxPage() {
  const inbox = useData((s) => s.inbox)
  const read = useData((s) => s.readState)
  const gone = useData((s) => s.inbox.some((n) => !s.issues[n.issue]))
  useEffect(() => {
    if (gone) loadArchive()
  }, [gone])
  useCrumbs([{ label: 'Inbox' }])
  const unread = inbox.filter((n) => isUnread(n, read)).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 md:px-8">
        <h1 className="text-[15px] font-medium">Inbox</h1>
        {unread > 0 && <span className="text-sm text-muted-foreground">{unread} unread</span>}
        {inbox.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={!unread} onClick={markAllRead}>
              <CheckCheck /> Mark all as read
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More inbox actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={unread === inbox.length} onSelect={() => deleteInboxItems(undefined, { readOnly: true })}>
                  <Trash2 /> Delete read notes
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => deleteInboxItems()}>
                  <Trash2 /> Delete all notes
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {inbox.length ? (
        <ol className="flex-1 overflow-y-auto px-4 py-3">
          {inbox.map((n) => (
            <Note key={n.id} n={n} unread={isUnread(n, read)} />
          ))}
        </ol>
      ) : (
        <EmptyState icon={<Inbox />} title="You're all caught up">
          When someone assigns you an issue, mentions you, or comments on your issue, you'll see it here.
        </EmptyState>
      )}
    </div>
  )
}
