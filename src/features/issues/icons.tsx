/** Status, priority and pull request icons: the same shapes everywhere, so people recognise them at a glance. */
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import type { PullRequest } from '@/model/schema'
import { pullStateName } from './format'
import type { Priority, StatusId } from '@/model/status'
import { statusOf } from '@/model/status'
import { cn } from '@/lib/utils'

const PIE: Partial<Record<StatusId, number>> = { in_progress: 0.5, in_review: 0.75 }

export function StatusIcon({ status, className }: { status: StatusId; className?: string }) {
  const color = statusOf(status).color
  const box = cn('size-3.5 shrink-0', className)
  if (status === 'done') {
    return (
      <svg viewBox="0 0 14 14" className={box} aria-label="Done">
        <circle cx="7" cy="7" r="6" fill={color} />
        <path d="M4.3 7.2 6.2 9l3.5-3.8" fill="none" stroke="var(--status-mark)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (status === 'canceled' || status === 'duplicate') {
    return (
      <svg viewBox="0 0 14 14" className={box} aria-label={statusOf(status).name}>
        <circle cx="7" cy="7" r="6" fill={color} />
        <path d="m5 5 4 4m0-4-4 4" stroke="var(--status-mark)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  const pie = PIE[status]
  // a circle of radius 1.75 with a 3.5-wide stroke paints a pie; dasharray sets how much of it
  const c = 2 * Math.PI * 1.75
  return (
    <svg viewBox="0 0 14 14" className={box} aria-label={statusOf(status).name}>
      <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={status === 'backlog' ? '1.4 1.74' : undefined} />
      {pie && <circle cx="7" cy="7" r="1.75" fill="none" stroke={color} strokeWidth="3.5" strokeDasharray={`${c * pie} ${c}`} transform="rotate(-90 7 7)" />}
    </svg>
  )
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const box = cn('size-3.5 shrink-0', className)
  if (priority === 0) {
    return (
      <svg viewBox="0 0 14 14" className={cn(box, 'text-muted-foreground')} aria-label="No priority">
        {[2, 6, 10].map((x) => (
          <rect key={x} x={x - 0.5} y="6.25" width="2" height="1.5" rx="0.5" fill="currentColor" />
        ))}
      </svg>
    )
  }
  if (priority === 1) {
    return (
      <svg viewBox="0 0 14 14" className={box} aria-label="Urgent">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--urgent)" />
        <path d="M7 3.8v4" stroke="var(--urgent-mark)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r="0.95" fill="var(--urgent-mark)" />
      </svg>
    )
  }
  const lit = { 2: 3, 3: 2, 4: 1 }[priority]
  return (
    <svg viewBox="0 0 14 14" className={cn(box, 'text-foreground')} aria-label={{ 2: 'High', 3: 'Medium', 4: 'Low' }[priority]}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={8 - i * 3} width="3" height={5 + i * 3} rx="1" fill="currentColor" opacity={i < lit ? 1 : 0.3} />
      ))}
    </svg>
  )
}

const PULL_STATE = {
  open: { Icon: GitPullRequest, color: 'var(--status-review)' },
  draft: { Icon: GitPullRequestDraft, color: 'var(--status-backlog)' },
  merged: { Icon: GitMerge, color: 'var(--status-done)' },
  closed: { Icon: GitPullRequestClosed, color: 'var(--status-canceled)' },
} as const

/** a pull request's state, in the colours of the statuses it moves issues to: open is In Review's, merged is Done's */
export function PullRequestIcon({ state, className }: { state: PullRequest['state']; className?: string }) {
  const { Icon, color } = PULL_STATE[state]
  return <Icon className={cn('size-3.5 shrink-0', className)} style={{ color }} aria-label={pullStateName(state)} />
}
