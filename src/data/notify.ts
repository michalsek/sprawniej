/**
 * Who hears about a change (their Inbox). Pure rules, so they're unit-tested (tests/notify.test.ts):
 * - assigned: the new assignee
 * - mentioned: anyone newly @mentioned in a description or comment
 * - commented: everyone following the issue
 * - status: everyone following the issue, when its status changes (also to another status of the same category)
 * People follow an issue they created, are assigned to, commented on or were mentioned in, and any issue they
 * subscribed to; unsubscribing stops all of that. Nobody hears about their own changes, and only people in the
 * workspace get notes (not people from Linear who haven't joined).
 */
import { isGuest, type Comment, type InboxItem, type Issue, type Person } from '@/model/schema'
import type { IssueCategory } from '@/model/status'
import { mentionedLogins, newMentions } from './mentions'

/** people who follow an issue without asking: its creator, assignee, commenters and everyone mentioned in it */
export function implicitFollowers(issue: Issue, comments: Comment[], people: Record<string, Person>): string[] {
  const out = [issue.createdBy, issue.assignee, ...comments.map((c) => c.author), ...mentionedLogins(issue.description, people)]
  for (const c of comments) out.push(...mentionedLogins(c.body, people))
  return [...new Set(out.filter((l): l is string => !!l && !!people[l]))]
}

/** everyone who hears about an issue's comments and status changes */
export function followers(issue: Issue, comments: Comment[], people: Record<string, Person>): string[] {
  const off = new Set(issue.unsubscribed ?? [])
  return [...new Set([...implicitFollowers(issue, comments, people), ...(issue.subscribers ?? [])])].filter((l) => !off.has(l) && !!people[l])
}

/** the subscribed and unsubscribed lists that make exactly `wanted` follow the issue */
export function followLists(issue: Issue, comments: Comment[], people: Record<string, Person>, wanted: string[]): Pick<Issue, 'subscribers' | 'unsubscribed'> {
  const implicit = implicitFollowers(issue, comments, people)
  const want = new Set(wanted)
  // people who left the workspace keep whatever they had
  const gone = (l: string) => !people[l]
  return {
    subscribers: [...new Set([...wanted.filter((l) => !implicit.includes(l)), ...(issue.subscribers ?? []).filter(gone)])].sort(),
    unsubscribed: [...new Set([...implicit.filter((l) => !want.has(l)), ...(issue.unsubscribed ?? []).filter(gone)])].sort(),
  }
}

export interface Note {
  to: string
  type: InboxItem['type']
  comment?: string
  /** the new status's category */
  status?: IssueCategory
  /** the new status ('' or missing: not known, the database takes the issue's) */
  statusId?: string
}

function keep(notes: Note[], actor: string, people: Record<string, Person>): Note[] {
  const seen = new Set<string>()
  return notes.filter((n) => {
    const key = `${n.to}:${n.type}`
    // people from Linear who haven't joined have no inbox
    if (n.to === actor || !people[n.to] || isGuest(n.to) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** notes for a new issue (`before` = null) or a change to one; `comments` = the comments on it */
export function issueNotes(before: Issue | null, after: Issue, actor: string, people: Record<string, Person>, comments: Comment[] = []): Note[] {
  const notes: Note[] = []
  if (after.assignee && after.assignee !== before?.assignee) notes.push({ to: after.assignee, type: 'assigned' })
  if (after.description !== before?.description) {
    for (const to of newMentions(before?.description ?? '', after.description, people)) notes.push({ to, type: 'mentioned' })
  }
  if (before && (before.status !== after.status || before.statusId !== after.statusId)) {
    // a new assignee already hears about it being theirs
    const told = new Set(notes.filter((n) => n.type === 'assigned').map((n) => n.to))
    const status = { status: after.status, ...(after.statusId && { statusId: after.statusId }) }
    for (const to of followers(after, comments, people)) if (!told.has(to)) notes.push({ to, type: 'status', ...status })
  }
  return keep(notes, actor, people)
}

/**
 * notes for a new comment (`before` = null) or an edited one (`before` = its old text; only new mentions count).
 * `earlier` = the comments already on the issue.
 */
export function commentNotes(issue: Issue, comment: Comment, before: string | null, earlier: Comment[], actor: string, people: Record<string, Person>): Note[] {
  const mentioned = before === null ? mentionedLogins(comment.body, people) : newMentions(before, comment.body, people)
  const notes: Note[] = mentioned.map((to) => ({ to, type: 'mentioned', comment: comment.id }))
  if (before === null) {
    const told = new Set(mentioned)
    for (const to of followers(issue, earlier, people)) if (!told.has(to)) notes.push({ to, type: 'commented', comment: comment.id })
  }
  return keep(notes, actor, people)
}
