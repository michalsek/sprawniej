/**
 * What a GitHub pull request means for the issues it mentions (docs/github-app.md). Pure, so it's unit-tested
 * (tests/github.test.ts); the Edge Function (handler.ts) runs it. Nothing here runs in the browser.
 */
import { issueNotes } from '@/data/notify'
import { withoutCode } from '@/data/mentions'
import type { Comment, Issue, Person } from '@/model/schema'
import { TEAM_KEY } from '@/model/schema'
import type { StatusId } from '@/model/status'

// ---------- the signature ----------

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

/** GitHub signs every delivery with the webhook secret: `X-Hub-Signature-256: sha256=<hex HMAC of the body>` */
export async function signatureOk(secret: string, body: Uint8Array<ArrayBuffer>, header: string | null): Promise<boolean> {
  if (!secret || !header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const want = `sha256=${hex(await crypto.subtle.sign('HMAC', key, body))}`
  // the same time whatever matches, so the answer's timing says nothing about the secret
  if (header.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ header.charCodeAt(i)
  return diff === 0
}

// ---------- which issues ----------

/** the most refs one pull request can move */
export const MAX_REFS = 50

const REF = `(?<![A-Za-z0-9])(${TEAM_KEY})-(\\d{1,7})(?![A-Za-z0-9])`

/**
 * The issue refs a pull request mentions, in order, without repeats: in its branch name in any case
 * (`eng-12-fix-login`), and in its title and description as people write them (`ENG-12`), skipping code.
 */
export function findRefs(pr: { branch?: string | null; title?: string | null; body?: string | null }): string[] {
  const out = new Set<string>()
  const add = (text: string, flags: string) => {
    for (const m of text.matchAll(new RegExp(REF, flags))) out.add(`${m[1].toUpperCase()}-${Number(m[2])}`)
  }
  add(pr.branch ?? '', 'gi')
  add(pr.title ?? '', 'g')
  add(withoutCode(pr.body ?? ''), 'g')
  return [...out].slice(0, MAX_REFS)
}

// ---------- where they go ----------

export interface Move {
  to: StatusId
  /** an issue moves only from one of these: nothing goes backwards */
  from: StatusId[]
}

export const TO_REVIEW: Move = { to: 'in_review', from: ['backlog', 'todo', 'in_progress'] }
export const TO_DONE: Move = { to: 'done', from: ['backlog', 'todo', 'in_progress', 'in_review'] }

export interface PullRequestEvent {
  action: string
  draft?: boolean
  merged?: boolean
  state?: string
  /** for `edited`: what changed (`{"title": {"from": …}}`) */
  changes?: Record<string, unknown>
}

/** what a pull request event does to the issues it mentions; null: nothing */
export function moveFor(e: PullRequestEvent): Move | null {
  const open = e.state === 'open' && !e.draft
  switch (e.action) {
    case 'opened':
    case 'reopened':
    case 'ready_for_review':
      return open ? TO_REVIEW : null
    case 'edited':
      // a ref added to the title or the description; a new base branch changes nothing
      return open && (!!e.changes?.title || !!e.changes?.body) ? TO_REVIEW : null
    case 'closed':
      return e.merged ? TO_DONE : null
    default:
      return null
  }
}

// ---------- how it stands (shown on the issue page) ----------

export type PullState = 'open' | 'draft' | 'merged' | 'closed'

/** the pull request events that change what the issue page shows: it opens, closes, is renamed or changes from or to a draft */
export const SHOWN_ACTIONS = ['opened', 'reopened', 'edited', 'ready_for_review', 'converted_to_draft', 'closed']

export function pullState(pr: { state?: string; draft?: boolean; merged?: boolean }): PullState {
  if (pr.merged) return 'merged'
  if (pr.state === 'closed') return 'closed'
  return pr.draft ? 'draft' : 'open'
}

// ---------- what the database says (github_lookup) ----------

export interface LookupIssue {
  id: string
  ref: string
  former_refs: string[]
  status: StatusId
  created_by: string | null
  assignee_id: string | null
  description: string
  followers: { profile_id: string; following: boolean }[]
  comments: { author_id: string | null; body: string }[]
}

export interface Lookup {
  connection: string
  workspace: string
  /** the pull request's author, when they are a member of this workspace with GitHub */
  actor: string | null
  /** the workspace's members now */
  people: { id: string; login: string }[]
  issues: LookupIssue[]
}

/** the move for each issue that will move, with the ref the pull request used for it */
export function movesFor(issues: LookupIssue[], refs: string[], move: Move): { issue: string; ref: string; from: StatusId[]; to: StatusId }[] {
  const out = []
  for (const i of issues) {
    if (!move.from.includes(i.status)) continue
    const ref = refs.find((r) => r === i.ref || i.former_refs.includes(r)) ?? i.ref
    out.push({ issue: i.id, ref, from: move.from, to: move.to })
  }
  return out
}

// ---------- who hears about it ----------

export interface StatusNote {
  issue: string
  /** a profile id */
  to: string
  status: StatusId
}

/**
 * The Inbox notes for an issue moving to `to`, by the same rules as the app (src/data/notify.ts): everyone following
 * it hears about it, except whoever moved it.
 */
export function notesFor(issue: LookupIssue, to: StatusId, actor: string, members: Lookup['people']): StatusNote[] {
  const loginOf = new Map(members.map((p) => [p.id, p.login]))
  const idOf = new Map(members.map((p) => [p.login, p.id]))
  // someone who left keeps their profile id here: no login, so no note
  const login = (id: string | null) => (id ? (loginOf.get(id) ?? id) : null)
  const people: Record<string, Person> = Object.fromEntries(members.map((p) => [p.login, { login: p.login, githubId: 0, name: '', avatarUrl: '' }]))
  const comments: Comment[] = issue.comments.map((c, n) => ({ id: String(n), issue: issue.id, author: login(c.author_id) ?? '', createdAt: '', body: c.body }))
  const before: Issue = {
    id: issue.id,
    team: '',
    number: 1,
    title: '',
    description: issue.description,
    status: issue.status,
    priority: 0,
    assignee: login(issue.assignee_id),
    labels: [],
    project: null,
    parent: null,
    sortOrder: '',
    createdBy: login(issue.created_by) ?? '',
    createdAt: '',
    updatedAt: '',
    subscribers: issue.followers.filter((f) => f.following).map((f) => login(f.profile_id) ?? ''),
    unsubscribed: issue.followers.filter((f) => !f.following).map((f) => login(f.profile_id) ?? ''),
  }
  const by = loginOf.get(actor) ?? actor
  return issueNotes(before, { ...before, status: to }, by, people, comments)
    .filter((n) => n.type === 'status')
    .flatMap((n) => {
      const id = idOf.get(n.to)
      return id ? [{ issue: issue.id, to: id, status: to }] : []
    })
}
