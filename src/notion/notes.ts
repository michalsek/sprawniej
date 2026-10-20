/**
 * Who hears about an issue made from a Notion page (their Inbox), by the same rules as the app (src/data/notify.ts):
 * the assignee, unless they made it, and everyone @mentioned in its description. Pure, so it's unit-tested
 * (tests/notion.test.ts). notion_apply checks every note again.
 */
import { ulid } from 'ulid'
import { issueNotes } from '@/data/notify'
import type { Issue, Person } from '@/model/schema'

interface NewIssueNote {
  id: string
  /** a profile id */
  to: string
  type: 'assigned' | 'mentioned'
}

/**
 * `people`: the workspace's members, with the handle each shows now when they changed it, so an @mention of that
 * handle counts; `actor` and `assignee` are profile ids (null: nobody)
 */
export function notesFor(o: {
  description: string
  assignee: string | null
  actor: string | null
  people: { id: string; login: string; handle?: string | null }[]
}): NewIssueNote[] {
  const loginOf = new Map(o.people.map((p) => [p.id, p.login]))
  const idOf = new Map(o.people.map((p) => [p.login, p.id]))
  const people: Record<string, Person> = Object.fromEntries(
    o.people.map((p) => [p.login, { login: p.login, ...(p.handle && { handle: p.handle }), githubId: 0, name: '', avatarUrl: '' }]),
  )
  const actor = (o.actor && loginOf.get(o.actor)) || ''
  const issue: Issue = {
    id: '',
    team: '',
    number: 1,
    title: '',
    description: o.description,
    status: 'todo',
    priority: 0,
    assignee: (o.assignee && loginOf.get(o.assignee)) || null,
    labels: [],
    project: null,
    parent: null,
    sortOrder: '',
    createdBy: actor,
    createdAt: '',
    updatedAt: '',
  }
  return issueNotes(null, issue, actor, people).flatMap((n) => {
    const to = idOf.get(n.to)
    return to && (n.type === 'assigned' || n.type === 'mentioned') ? [{ id: ulid(), to, type: n.type }] : []
  })
}
