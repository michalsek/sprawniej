/**
 * The ONLY place that changes workspace data (CLAUDE.md, golden rules). Every action works out which rows change and
 * hands them to the writer (src/backend/writes.ts), which:
 *   1. shows them at once (the screen changes before anything is sent),
 *   2. saves them a moment later, and puts back what couldn't be saved, saying why.
 * Each change carries only the columns that changed; what the database fills in by itself (issue numbers, authors,
 * times) is guessed, so it shows at once too, and the saved row puts it right.
 *
 * While no workspace is open (or it's still opening) there is nowhere to save to, and actions do nothing.
 *
 * Light or dark (setTheme) is yours, not the workspace's: it is kept with your account, works with no workspace open
 * and never shows on the save chip.
 */
import { generateKeyBetween } from 'fractional-indexing'
import { ulid } from 'ulid'
import { localKey } from '@/backend/apply/take'
import type { AnyChange, Call, Change, Writable } from '@/backend/changes'
import type { Json } from '@/backend/database.types'
import { ImportProblem, type ImportPlan } from '@/backend/importRows'
import type { KeyOf, LiveTable, Row } from '@/backend/tables'
import { context, tell, write, type NoteRow, type WriteContext } from '@/backend/writes'
import { MESSAGES } from '@/backend/writes/problems'
import { backend } from '@/backend'
import { PictureError, pictures, type PictureProblem } from '@/backend/pictures'
import { connectRepo as addRepo, disconnectRepo as removeRepo, repoFromInput } from '@/backend/github'
import { saveTheme, useAuth } from '@/backend/auth'
import {
  connectNotion as addNotion,
  disconnectNotion as removeNotion,
  newNotionAddress as replaceNotionAddress,
  setNotionTeam as moveNotionTeam,
} from '@/backend/notion'
import {
  acceptInvite,
  createInvite as makeInvite,
  createWorkspace,
  deleteInvite as removeInvite,
  endInvite as stopInvite,
  linkPerson as linkGuest,
  removeMember,
  RULES,
  setMemberRole,
  type Invite,
  type InviteRole,
  type Role,
} from '@/backend/workspaces'
import { useSession } from '@/session'
import { canLeave, myWho, ruleFor, whoIs } from './roles'
import type { Comment, Display, FavouriteKind, Filters, Issue, Label, Project, Status, Team, View } from '@/model/schema'
import { AUTO_ARCHIVE_MONTHS, handleOf } from '@/model/schema'
import { LABEL_COLORS } from '@/model/colors'
import { categoryOf, KIND_CATEGORIES, seedColor, type StatusKind } from '@/model/status'
import type { TeamDraft } from '@/model/teamDraft'
import { equal } from '@/lib/equal'
import { clearUnsent, makeThemeSaver, markUnsent, readUnsent, showTheme, useTheme, writeDevice, type ThemeChoice } from '@/lib/theme'
import { IMAGE_TYPES, MAX_IMAGE_MB, openWorkspaceId, pictureName, picturePath } from './assets'
import { endKey, isFavourite, kindOf, placeAt, visibleFavourites } from './favourites'
import { cleanHandle, HANDLE_WORDS, handleProblem } from './handles'
import { commentNotes, followLists, followers, issueNotes, type Note } from './notify'
import { changedOnly, keyBetween, keysBetween } from './ordering'
import { isAdmin, isUnread, ownerCount } from './select'
import { canHide, pickStatus, statusesOf, statusNamed } from './statuses'
import { issueRef, useData } from './store'

const now = () => new Date().toISOString()

// ---------- small helpers ----------

type Ctx = Pick<WriteContext, 'workspaceId' | 'registry'>

/** typed by table where it's made; one change of some table where it's handed on */
const erase = <N extends LiveTable>(c: Change<N>): AnyChange => c as unknown as AnyChange
const ins = <N extends LiveTable>(table: N, key: KeyOf<N>, fields: Writable<N, 'insert'>, guess?: Partial<Row<N>>): AnyChange =>
  erase<N>({ table, key, op: 'insert', fields, ...(guess && { guess }) })
const upd = <N extends LiveTable>(table: N, key: KeyOf<N>, fields: Writable<N, 'update'>, guess?: Partial<Row<N>>, call?: Call): AnyChange =>
  erase<N>({ table, key, op: 'update', fields, ...(guess && { guess }), ...(call && { call }) })
const del = <N extends LiveTable>(table: N, key: KeyOf<N>): AnyChange => erase<N>({ table, key, op: 'delete' })

/** one update of a row, if anything in it changed */
const updated = <N extends LiveTable>(table: N, key: KeyOf<N>, fields: Writable<N, 'update'>): AnyChange[] => (Object.keys(fields).length ? [upd(table, key, fields)] : [])

/** filters and display as the database keeps them */
const toJson = (v: object): Json => v as Json

/** every issue we have, archived ones too */
const allIssues = (s: ReturnType<typeof useData.getState>): Issue[] => [...Object.values(s.issues), ...Object.values(s.archive)]

/** a person's profile id; null for no one; undefined (and a warning) for a login nobody knows */
function pid(c: Pick<WriteContext, 'registry'>, login: string | null | undefined): string | null | undefined {
  if (!login) return null
  const id = c.registry.profileId(login)
  if (id === undefined) console.warn(`Sprawniej doesn’t know @${login} here, so it was left out`)
  return id
}

const tid = (c: Pick<WriteContext, 'registry'>, key: string): string | undefined => c.registry.teamId(key)

const same = (a: unknown, b: unknown) => equal(a ?? null, b ?? null)

/** the same text, without what nobody sees: trailing spaces and blank lines */
const tidyBody = (body: string) => body.replace(/\s+$/, '')

/**
 * The inbox notes for teammates, as rows. Notes for people the registry doesn't know are left out; the database
 * itself drops notes for people outside the workspace and the same note again within ten minutes.
 */
export function noteRows(issueId: string, notes: readonly Note[], c: Ctx): NoteRow[] {
  return notes.flatMap((n) => {
    const to = c.registry.profileId(n.to)
    if (!to) return []
    return [{ id: ulid(), workspace_id: c.workspaceId, recipient_id: to, type: n.type, issue_id: issueId, comment_id: n.comment ?? null, status: n.status ?? null, status_id: n.statusId || null }]
  })
}

/**
 * You were looking at the guessed number of a new or moved issue ("ENG-12") and the database gave it another one:
 * the address follows, so you don't end up looking at a teammate's issue that got that number.
 */
export function followNumber(team: string, from: number, to: number, loc: Pick<Location, 'hash' | 'replace'> | undefined = globalThis.location) {
  if (!loc || from === to) return
  const m = new RegExp(`^#/issue/${team}-${from}(?=$|[/?])`, 'i').exec(loc.hash)
  if (m) loc.replace(`#/issue/${team}-${to}${loc.hash.slice(m[0].length)}`)
}

// ---------- issues ----------

/**
 * fields a person can change (Pick, not Omit: Omit drops named keys on passthrough schemas). Pick a status with
 * `statusId`; `status` alone (a category) means that category's default status, and nothing when the issue is in that
 * category already.
 */
export type IssuePatch = Partial<
  Pick<Issue, 'title' | 'description' | 'status' | 'statusId' | 'priority' | 'assignee' | 'labels' | 'project' | 'parent' | 'sortOrder' | 'duplicateOf' | 'dueDate' | 'estimate'>
>

/** an issue's fields as columns (labels are rows of their own: labelChanges) */
export function issueColumns(patch: IssuePatch, c: Pick<WriteContext, 'registry'>): Writable<'issues', 'update'> {
  const out: Writable<'issues', 'update'> = {}
  if (patch.title !== undefined) out.title = patch.title
  if (patch.description !== undefined) out.description = patch.description
  if (patch.status !== undefined) out.status = patch.status
  if (patch.statusId) out.status_id = patch.statusId
  if (patch.priority !== undefined) out.priority = patch.priority
  if (patch.assignee !== undefined) {
    const id = pid(c, patch.assignee)
    if (id !== undefined) out.assignee_id = id
  }
  if (patch.project !== undefined) out.project_id = patch.project
  if (patch.parent !== undefined) out.parent_id = patch.parent
  if (patch.dueDate !== undefined) out.due_date = patch.dueDate ?? null
  if (patch.estimate !== undefined) out.estimate = patch.estimate ?? null
  if (patch.sortOrder !== undefined) out.sort_order = patch.sortOrder
  if (patch.duplicateOf !== undefined) out.duplicate_of = patch.duplicateOf ?? null
  return out
}

/** the label rows to add and remove so an issue has `after` instead of `before` */
export function labelChanges(issueId: string, before: readonly string[], after: readonly string[], c: Pick<WriteContext, 'workspaceId'>): AnyChange[] {
  const was = new Set(before)
  const will = new Set(after)
  return [
    ...[...will].filter((l) => !was.has(l)).map((label_id) => ins('issue_labels', { issue_id: issueId, label_id }, { workspace_id: c.workspaceId, issue_id: issueId, label_id })),
    ...[...was].filter((l) => !will.has(l)).map((label_id) => del('issue_labels', { issue_id: issueId, label_id })),
  ]
}

/** who follows (true) or asked not to (false), as the issue says */
const followingOf = (issue: Pick<Issue, 'subscribers' | 'unsubscribed'>): Map<string, boolean> =>
  new Map([...(issue.subscribers ?? []).map((l) => [l, true] as const), ...(issue.unsubscribed ?? []).map((l) => [l, false] as const)])

/** the follower rows to add, change or remove so `desired` is what the issue says */
export function followerChanges(issue: Pick<Issue, 'id' | 'subscribers' | 'unsubscribed'>, desired: ReadonlyMap<string, boolean>, c: Ctx): AnyChange[] {
  const current = followingOf(issue)
  const out: AnyChange[] = []
  for (const login of new Set([...current.keys(), ...desired.keys()])) {
    const was = current.get(login)
    const will = desired.get(login)
    if (was === will) continue
    const profile_id = pid(c, login)
    if (!profile_id) continue
    const key = { issue_id: issue.id, profile_id }
    if (was === undefined) out.push(ins('issue_followers', key, { workspace_id: c.workspaceId, ...key, following: will }))
    else if (will === undefined) out.push(del('issue_followers', key))
    else out.push(upd('issue_followers', key, { following: will }))
  }
  return out
}

/**
 * A status picked for an issue, as fields: its id and its category (sent only when the category changes, for older
 * versions; the database follows status_id either way). A category alone is its default status; picking the category
 * the issue has already changes nothing. While the workspace's statuses aren't known, only the category is sent.
 */
export function statusPatch(old: Pick<Issue, 'status' | 'statusId'>, patch: IssuePatch, statuses: Record<string, Status>): IssuePatch {
  if (patch.statusId === undefined && patch.status === undefined) return patch
  const { statusId, status, ...rest } = patch
  if (statusId === undefined && status === old.status) return rest
  const picked = pickStatus(statusId ?? status ?? '', statuses)
  if (!picked) return rest
  return { ...rest, status: picked.status, ...(picked.statusId !== undefined && { statusId: picked.statusId }) }
}

export function updateIssue(id: string, asked: IssuePatch): void {
  const c = context()
  const s = useData.getState()
  const old = s.issues[id]
  if (!c || !s.me || !old) return
  const patch = statusPatch(old, asked, s.statuses)
  // labels as a set, only ones that exist (a label just made may be picked twice)
  const labels = patch.labels && [...new Set(patch.labels)].filter((l) => s.labels[l])
  const next: Issue = { ...old, ...patch, ...(labels && { labels }) }
  // picking what it already is (Todo on a Todo issue) changes nothing, so nothing is saved
  const changed: IssuePatch = {}
  for (const k of Object.keys(patch) as (keyof IssuePatch)[]) if (k !== 'labels' && !same(patch[k], old[k])) Object.assign(changed, { [k]: patch[k] })
  const fields = issueColumns(changed, c)
  const changes: AnyChange[] = []
  if (Object.keys(fields).length) {
    // completed_at follows the category: Done to another done status keeps it
    const status = fields.status !== undefined && fields.status !== old.status
    const done = (st: string) => categoryOf(st as Issue['status']).group === 'completed'
    changes.push(upd('issues', { id }, fields, { updated_at: now(), ...(status && { completed_at: done(next.status) ? now() : null }) }))
  }
  if (labels) changes.push(...labelChanges(id, old.labels, labels, c))
  if (!changes.length) return
  write({ changes, notes: noteRows(id, issueNotes(old, { ...next, updatedAt: now() }, s.me.login, s.people, s.comments[id] ?? []), c) })
}

/** Make exactly these people follow an issue (hear about its comments and status changes). */
export function setFollowers(id: string, logins: string[]) {
  const c = context()
  const s = useData.getState()
  const old = s.issues[id]
  if (!c || !old) return
  const lists = followLists(old, s.comments[id] ?? [], s.people, logins)
  // following isn't an edit: "last changed" stays as it was
  const changes = followerChanges(old, followingOf(lists), c)
  if (changes.length) write({ changes })
}

/** Follow an issue, or stop following it. */
export function subscribe(id: string, on: boolean) {
  const s = useData.getState()
  const issue = s.issues[id]
  const me = s.me?.login
  if (!issue || !me) return
  const now = followers(issue, s.comments[id] ?? [], s.people)
  setFollowers(id, on ? [...now, me] : now.filter((l) => l !== me))
}

/**
 * A drag-n-drop drop. `patch` = what the group it landed in stands for (status, priority…); `place` = its new
 * neighbours (issue ids, null = top or bottom), or null to keep its place (the list isn't in manual order).
 * Only the moved issue changes either way.
 */
export function moveIssue(id: string, to: { patch: IssuePatch; place: { prev: string | null; next: string | null } | null }) {
  const issues = useData.getState().issues
  if (!issues[id]) return
  const patch: IssuePatch = { ...to.patch }
  if (to.place) {
    const key = (x: string | null) => (x && issues[x] ? issues[x].sortOrder : null)
    patch.sortOrder = keyBetween(key(to.place.prev), key(to.place.next))
  }
  if (Object.keys(patch).length) updateIssue(id, patch)
}

/** Several picked issues dropped together: each gets the group's change, and they land side by side in this order. */
export function moveIssues(ids: string[], to: { patch: IssuePatch; place: { prev: string | null; next: string | null } | null }) {
  const issues = useData.getState().issues
  const key = (x: string | null) => (x && issues[x] ? issues[x].sortOrder : null)
  const keys = to.place ? keysBetween(key(to.place.prev), key(to.place.next), ids.length) : null
  ids.forEach((id, n) => {
    const issue = issues[id]
    if (!issue) return
    const patch = changedOnly(issue, to.patch)
    if (keys) patch.sortOrder = keys[n]
    if (Object.keys(patch).length) updateIssue(id, patch)
  })
}

export interface NewIssue {
  team: string
  title: string
  description?: string
  /** the status to start in; or `status`, a category, for its default status (Todo's when neither is given) */
  statusId?: string
  status?: Issue['status']
  priority?: Issue['priority']
  assignee?: string | null
  labels?: string[]
  project?: string | null
  parent?: string | null
  dueDate?: string | null
  estimate?: number | null
}

/**
 * A guess at a team's next issue number: one more than any it has or had that we know of. The database gives out
 * the real one; when a teammate was quicker, the saved issue shows the real number (and followNumber follows it).
 */
export function nextNumber(team: string): number {
  const s = useData.getState()
  let highest = s.teams[team]?.lastNumber ?? 0
  for (const i of Object.values(s.issues)) if (i.team === team) highest = Math.max(highest, i.number)
  for (const i of Object.values(s.archive)) if (i.team === team) highest = Math.max(highest, i.number)
  return highest + 1
}

/** where a new sub-issue goes: after its last sibling, or right after its parent */
function subIssueOrder(issues: Issue[], parent: Issue): string {
  const anchor = issues.filter((i) => i.parent === parent.id).reduce((max, i) => (i.sortOrder > max ? i.sortOrder : max), parent.sortOrder)
  const next = issues.reduce<string | null>((min, i) => (i.sortOrder > anchor && (min === null || i.sortOrder < min) ? i.sortOrder : min), null)
  return keyBetween(anchor, next)
}

/** Creates an issue at the top of its team's order (a sub-issue: under its siblings) and returns it. */
export function createIssue(input: NewIssue): Issue {
  const c = context()
  const s = useData.getState()
  const inTeam = Object.values(s.issues).filter((i) => i.team === input.team)
  const number = nextNumber(input.team)
  const first = inTeam.reduce<string | null>((min, i) => (min === null || i.sortOrder < min ? i.sortOrder : min), null)
  const parent = input.parent ? s.issues[input.parent] : undefined
  const at = now()
  const picked = (input.statusId && pickStatus(input.statusId, s.statuses)) || pickStatus(input.status ?? 'todo', s.statuses) || { status: 'todo' as const }
  const completed = categoryOf(picked.status).group === 'completed'
  const issue: Issue = {
    id: ulid(),
    team: input.team,
    number,
    title: input.title.trim(),
    description: input.description ?? '',
    status: picked.status,
    // while the workspace's statuses aren't known, the database gives it the category's default
    statusId: picked.statusId ?? '',
    priority: input.priority ?? 0,
    assignee: input.assignee ?? null,
    labels: [...new Set(input.labels ?? [])].filter((l) => s.labels[l]),
    project: input.project ?? null,
    parent: input.parent ?? null,
    ...(input.dueDate && { dueDate: input.dueDate }),
    ...(input.estimate != null && { estimate: input.estimate }),
    sortOrder: parent && parent.team === input.team ? subIssueOrder(inTeam, parent) : generateKeyBetween(null, first),
    createdBy: s.me?.login ?? 'unknown',
    createdAt: at,
    updatedAt: at,
    // the database sets it for an issue made as Done (E23)
    completedAt: completed ? at : null,
  }
  const team = c && tid(c, input.team)
  if (!c || !s.me || !team) {
    console.warn(c ? `Sprawniej doesn’t know the team ${input.team} here, so the issue wasn’t saved` : 'No workspace is open, so the issue wasn’t saved')
    return issue
  }
  const id = issue.id
  const fields: Writable<'issues', 'insert'> = {
    id,
    workspace_id: c.workspaceId,
    team_id: team,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    ...(issue.statusId && { status_id: issue.statusId }),
    priority: issue.priority,
    assignee_id: pid(c, issue.assignee) ?? null,
    project_id: issue.project,
    parent_id: issue.parent,
    due_date: input.dueDate ?? null,
    estimate: input.estimate ?? null,
    sort_order: issue.sortOrder,
  }
  // what the database fills in; never changed_at (newer-wins compares it)
  const guess: Partial<Row<'issues'>> = {
    number,
    created_by: c.meId,
    created_at: at,
    updated_at: at,
    completed_at: issue.completedAt ?? null,
    former_refs: [],
    duplicate_of: null,
    archived_at: null,
    archived_by: null,
    linear_id: null,
    extra: {},
  }
  write({
    changes: [ins('issues', { id }, fields, guess), ...labelChanges(id, [], issue.labels, c)],
    notes: noteRows(id, issueNotes(null, issue, s.me.login, s.people), c),
    done: (r) => {
      const real = r.ok ? r.rows.get(localKey('issues', { id }))?.number : undefined
      if (typeof real === 'number') followNumber(input.team, number, real)
    },
  })
  return useData.getState().issues[id] ?? issue
}

/** Remove an issue (and its comments). Its sub-issues stay, without a parent. */
export function deleteIssue(id: string) {
  const c = context()
  const s = useData.getState()
  if (!c || !s.issues[id]) return
  const all = allIssues(s)
  write({
    changes: [del('issues', { id })],
    // the database deletes its comments, labels, followers and notes along with it
    cascade: s.inbox.filter((n) => n.issue === id).map((n) => del('inbox', { id: n.id })),
    untilEcho: [
      ...all.filter((i) => i.parent === id).map((i) => upd('issues', { id: i.id }, { parent_id: null })),
      ...all.filter((i) => i.duplicateOf === id).map((i) => upd('issues', { id: i.id }, { duplicate_of: null })),
    ],
  })
}

/** Move an issue to another team: it gets that team's next number, like a new issue there. Returns it as shown. */
export function moveIssueToTeam(id: string, team: string): Issue | undefined {
  const c = context()
  const s = useData.getState()
  const old = s.issues[id]
  if (!old || old.team === team || !s.teams[team]) return old
  const to = c && tid(c, team)
  if (!c || !to) return old
  const number = nextNumber(team)
  const guess: Partial<Row<'issues'>> = { team_id: to, number, former_refs: [...(old.formerRefs ?? []), issueRef(old)], updated_at: now() }
  write({
    changes: [upd('issues', { id }, {}, guess, { fn: 'move_issue_to_team', args: { p_issue: id, p_team: to } })],
    done: (r) => {
      const real = r.ok ? r.rows.get(localKey('issues', { id }))?.number : undefined
      if (typeof real === 'number') followNumber(team, number, real)
    },
  })
  return useData.getState().issues[id]
}

// ---------- the archive ----------

/**
 * Put issues away: they leave every list and board but can still be opened, found and brought back. An issue's
 * sub-issues go with it. Returns how many were archived. (Finished issues are archived every night by the database.)
 */
export function archiveIssues(ids: string[]): number {
  const c = context()
  const s = useData.getState()
  if (!c) return 0
  const all: Issue[] = []
  const add = (id: string) => {
    const issue = s.issues[id]
    if (!issue || all.includes(issue)) return
    all.push(issue)
    for (const child of Object.values(s.issues)) if (child.parent === id) add(child.id)
  }
  ids.forEach(add)
  if (!all.length) return 0
  // one moment for all of them, so they go in one request
  const at = now()
  write({ changes: all.map((i) => upd('issues', { id: i.id }, { archived_at: at }, { archived_by: c.meId })) })
  return all.length
}

/**
 * Bring an archived issue back where it was, with its comments. Sub-issues that were archived together with it come
 * back too. Needs the archive loaded (loadArchive).
 */
export function restoreIssue(id: string): Issue | undefined {
  const c = context()
  const s = useData.getState()
  const a = s.archive[id]
  if (!c || !a || s.issues[id]) return s.issues[id]
  const all = [a]
  for (let k = 0; k < all.length; k++) {
    for (const x of Object.values(s.archive)) if (x.parent === all[k].id && x.archivedAt === a.archivedAt && !s.issues[x.id] && !all.includes(x)) all.push(x)
  }
  const at = now()
  write({ changes: all.map((i) => upd('issues', { id: i.id }, { archived_at: null }, { archived_by: null, updated_at: at })) })
  return useData.getState().issues[id]
}

// ---------- comments ----------

export function createComment(issueId: string, body: string): Comment | undefined {
  const c = context()
  const s = useData.getState()
  const issue = s.issues[issueId]
  if (!c || !issue || !s.me || !body.trim()) return undefined
  const comment: Comment = { id: ulid(), issue: issueId, author: s.me.login, createdAt: now(), body: tidyBody(body) }
  write({
    changes: [
      ins(
        'comments',
        { id: comment.id },
        { id: comment.id, workspace_id: c.workspaceId, issue_id: issueId, body: comment.body },
        { author_id: c.meId, created_at: comment.createdAt, edited_at: null, linear_id: null, extra: {} },
      ),
    ],
    notes: noteRows(issueId, commentNotes(issue, comment, null, s.comments[issueId] ?? [], s.me.login, s.people), c),
  })
  return comment
}

/** An empty text is ignored (delete the comment instead). Only the author may change it; the database says so. */
export function updateComment(issueId: string, id: string, body: string) {
  const c = context()
  const s = useData.getState()
  const issue = s.issues[issueId]
  const old = s.comments[issueId]?.find((x) => x.id === id)
  if (!c || !issue || !old || !s.me || !body.trim() || tidyBody(body) === old.body) return
  const next: Comment = { ...old, body: tidyBody(body) }
  write({
    changes: [upd('comments', { id }, { body: next.body }, { edited_at: now() })],
    // sent only if the edit is saved
    notes: noteRows(issueId, commentNotes(issue, next, old.body, [], s.me.login, s.people), c),
  })
}

export function deleteComment(issueId: string, id: string) {
  const c = context()
  const s = useData.getState()
  if (!c || !s.comments[issueId]?.some((x) => x.id === id)) return
  write({
    changes: [del('comments', { id })],
    // the database deletes the notes about it along with it
    cascade: s.inbox.filter((n) => n.comment === id).map((n) => del('inbox', { id: n.id })),
  })
}

// ---------- your inbox ----------

export function markRead(ids: string[]) {
  const c = context()
  const s = useData.getState()
  if (!c) return
  const at = now()
  const fresh = s.inbox.filter((n) => ids.includes(n.id) && isUnread(n, s.readState))
  if (fresh.length) write({ changes: fresh.map((n) => upd('inbox', { id: n.id }, { read_at: at })) })
}

export function markAllRead() {
  const c = context()
  const s = useData.getState()
  if (!c || !s.inbox.some((n) => isUnread(n, s.readState))) return
  const latest = s.inbox.reduce((max, n) => (n.at > max ? n.at : max), s.readState.readUntil ?? '')
  const key = { profile_id: c.meId, workspace_id: c.workspaceId }
  write({ changes: [ins('read_state', key, { ...key, read_until: latest }, { extra: {} })] })
}

/** delete notes from your inbox (all of them if `ids` is left out, only read ones with `readOnly`) */
export function deleteInboxItems(ids?: string[], { readOnly = false } = {}) {
  const c = context()
  const s = useData.getState()
  if (!c) return
  const gone = s.inbox.filter((n) => (!ids || ids.includes(n.id)) && (!readOnly || !isUnread(n, s.readState)))
  if (gone.length) write({ changes: gone.map((n) => del('inbox', { id: n.id })) })
}

const DAY = 86_400_000
/** how long inbox notes are kept: read ones and unread ones (the database's nightly job removes older ones) */
export const INBOX_KEEP = { read: 30 * DAY, unread: 90 * DAY }

// ---------- your favourites ----------

/** your favourites of these projects or views, deleted (the database does it when they go) */
function favouritesOf(s: Pick<ReturnType<typeof useData.getState>, 'favourites'>, c: Pick<WriteContext, 'meId'>, ids: readonly string[]): AnyChange[] {
  return ids.filter((id) => isFavourite(s, id)).map((id) => del('favourites', { profile_id: c.meId, item_id: id }))
}

/** Star a project or view: it goes to the bottom of your favourites. */
export function addFavourite(kind: FavouriteKind, id: string) {
  const c = context()
  const s = useData.getState()
  if (!c || isFavourite(s, id) || kindOf(s, id) !== kind) return
  const key = { profile_id: c.meId, item_id: id }
  write({ changes: [ins('favourites', key, { ...key, workspace_id: c.workspaceId, kind, sort_order: endKey(s.favourites) }, { extra: {} })] })
}

export function removeFavourite(id: string) {
  const c = context()
  const s = useData.getState()
  if (c && isFavourite(s, id)) write({ changes: favouritesOf(s, c, [id]) })
}

export function toggleFavourite(kind: FavouriteKind, id: string) {
  if (isFavourite(useData.getState(), id)) removeFavourite(id)
  else addFavourite(kind, id)
}

/** Move a favourite to `toIndex` of the list as shown: only its order changes (and, rarely, that of one it ties with). */
export function moveFavourite(id: string, toIndex: number) {
  const c = context()
  const placed = placeAt(visibleFavourites(useData.getState()), id, toIndex)
  if (c && placed) write({ changes: placed.map((p) => upd('favourites', { profile_id: c.meId, item_id: p.id }, { sort_order: p.sortOrder })) })
}

/** "Move up" (-1) and "Move down" (1) */
export function moveFavouriteBy(id: string, step: -1 | 1) {
  const list = visibleFavourites(useData.getState())
  const at = list.findIndex((f) => f.id === id)
  if (at >= 0 && at + step >= 0 && at + step < list.length) moveFavourite(id, at + step)
}

// ---------- labels ----------

/** two labels with one name can't be told apart in pickers and filters */
const labelNamed = (labels: Record<string, Label>, name: string, but?: string) =>
  Object.values(labels).find((l) => l.id !== but && l.name.toLowerCase() === name.trim().toLowerCase())

/** a new label, or the one that already has this name (E5) */
export function createLabel(name: string): Label {
  const c = context()
  const s = useData.getState()
  const existing = labelNamed(s.labels, name)
  if (existing) return existing
  const label: Label = { id: ulid(), name: name.trim(), color: LABEL_COLORS[Object.keys(s.labels).length % LABEL_COLORS.length] }
  if (c) write({ changes: [ins('labels', { id: label.id }, { id: label.id, workspace_id: c.workspaceId, name: label.name, color: label.color }, { linear_id: null, extra: {} })] })
  return label
}

export function updateLabel(id: string, patch: Partial<Pick<Label, 'name' | 'color'>>) {
  const c = context()
  const labels = useData.getState().labels
  const label = labels[id]
  if (!c || !label) return
  if (patch.name !== undefined && (!patch.name.trim() || labelNamed(labels, patch.name, id))) return
  const fields: Writable<'labels', 'update'> = {}
  if (patch.name !== undefined && patch.name.trim() !== label.name) fields.name = patch.name.trim()
  if (patch.color !== undefined && patch.color !== label.color) fields.color = patch.color
  const changes = updated('labels', { id }, fields)
  if (changes.length) write({ changes })
}

/**
 * A label, project or team that's gone comes out of saved views' filters where others are left ("Bug or Design"
 * becomes "Design"). Where it was the only one, it stays: the view keeps showing nothing rather than suddenly showing
 * every issue, and its filter says the one it was about was deleted. `skip`: views being deleted anyway.
 */
export function viewsWithout(views: Record<string, View>, field: 'labels' | 'projects' | 'teams', id: string, skip: ReadonlySet<string> = new Set()): AnyChange[] {
  const out: AnyChange[] = []
  for (const v of Object.values(views)) {
    if (skip.has(v.id)) continue
    const list = v.filters[field] as (string | null)[] | undefined
    if (!list?.includes(id)) continue
    const rest = list.filter((x) => x !== id)
    if (rest.length) out.push(upd('views', { id: v.id }, { filters: toJson({ ...v.filters, [field]: rest }) }))
  }
  return out
}

/** remove a label everywhere */
export function deleteLabel(id: string) {
  const c = context()
  const s = useData.getState()
  if (!c || !s.labels[id]) return
  const all = allIssues(s)
  write({
    changes: [del('labels', { id })],
    // only once the label is gone: a refused delete leaves the views as they were
    after: viewsWithout(s.views, 'labels', id),
    cascade: all.filter((i) => i.labels.includes(id)).map((i) => del('issue_labels', { issue_id: i.id, label_id: id })),
  })
}

// ---------- statuses ----------
// Every member may add, rename, recolour, reorder and hide the workspace's statuses (like labels). They are never
// deleted: hiding keeps them on the things that have them, and each category keeps at least one shown status (the
// database refuses otherwise, also when two people hide the last two at once).

/**
 * A new status at the end of its category, in the category's colour. A name another status of this kind has (case
 * aside) gives that one back instead (two can't be told apart in pickers and filters). Returns undefined for a
 * category the kind doesn't have, or an empty name.
 */
export function createStatus(kind: StatusKind, category: string, name: string): Status | undefined {
  const c = context()
  const s = useData.getState()
  const typed = name.trim()
  if (!typed || typed.length > 40 || !KIND_CATEGORIES[kind].includes(category)) return undefined
  const existing = statusNamed(s.statuses, kind, typed)
  if (existing) return existing
  const last = statusesOf(s.statuses, kind).filter((x) => x.category === category).at(-1)
  const status: Status = { id: ulid(), kind, category, name: typed, color: seedColor(kind, category), position: keyBetween(last?.position ?? null, null), hidden: false }
  if (c) {
    const { id, color, position, hidden } = status
    write({ changes: [ins('statuses', { id }, { id, workspace_id: c.workspaceId, kind, category, name: typed, color, position, hidden }, { extra: {} })] })
  }
  return useData.getState().statuses[status.id] ?? status
}

/**
 * Rename, recolour, hide or show a status; only what changed is sent. An empty or taken name changes nothing, and
 * neither does hiding the last shown status of a category.
 */
export function updateStatus(id: string, patch: Partial<Pick<Status, 'name' | 'color' | 'hidden'>>) {
  const c = context()
  const statuses = useData.getState().statuses
  const status = statuses[id]
  if (!c || !status) return
  const fields: Writable<'statuses', 'update'> = {}
  const name = patch.name?.trim()
  if (name !== undefined && name !== status.name) {
    if (!name || name.length > 40 || statusNamed(statuses, status.kind, name, id)) return
    fields.name = name
  }
  // the database keeps "#rrggbb" in lower case; anything else changes nothing
  const color = patch.color?.toLowerCase()
  if (color !== undefined && /^#[0-9a-f]{6}$/.test(color) && color !== status.color) fields.color = color
  if (patch.hidden !== undefined && patch.hidden !== status.hidden) {
    if (patch.hidden && !canHide(status, statuses)) return
    fields.hidden = patch.hidden
  }
  const changes = updated('statuses', { id }, fields)
  if (changes.length) write({ changes })
}

/** Put a status between two others of its category (ids; null = first or last). Only the moved status changes. */
export function moveStatus(id: string, place: { prev: string | null; next: string | null }) {
  const c = context()
  const statuses = useData.getState().statuses
  const status = statuses[id]
  if (!c || !status) return
  const at = (x: string | null) => (x && statuses[x]?.category === status.category && statuses[x].kind === status.kind ? statuses[x].position : null)
  const position = keyBetween(at(place.prev), at(place.next))
  if (position !== status.position) write({ changes: [upd('statuses', { id }, { position })] })
}

// ---------- views ----------

export interface NewView {
  name: string
  emoji: string
  description?: string
  /** null = the whole workspace */
  team: string | null
  filters?: Filters
  display: Display
}

/** empty filter lists are left out, so a view says only what it filters by */
const cleanFilters = (f: Filters): Filters => Object.fromEntries(Object.entries(f).filter(([, v]) => !Array.isArray(v) || v.length > 0))

export function createView(input: NewView): View {
  const c = context()
  const me = useData.getState().me
  const view: View = {
    id: ulid(),
    name: input.name.trim(),
    emoji: input.emoji,
    description: input.description?.trim() ?? '',
    owner: me?.login ?? 'unknown',
    team: input.team,
    filters: cleanFilters(input.filters ?? {}),
    display: input.display,
    createdAt: now(),
  }
  const team = c && input.team !== null ? tid(c, input.team) : null
  if (!c || team === undefined) return view
  write({
    changes: [
      ins(
        'views',
        { id: view.id },
        {
          id: view.id,
          workspace_id: c.workspaceId,
          team_id: team,
          name: view.name,
          emoji: view.emoji,
          description: view.description,
          filters: toJson(view.filters),
          display: toJson(view.display),
        },
        { owner_id: c.meId, created_at: view.createdAt, linear_id: null, extra: {} },
      ),
    ],
  })
  return useData.getState().views[view.id] ?? view
}

export type ViewPatch = Partial<Pick<View, 'name' | 'emoji' | 'description' | 'filters' | 'display'>>

export function updateView(id: string, patch: ViewPatch) {
  const c = context()
  const view = useData.getState().views[id]
  if (!c || !view) return
  const next: View = { ...view, ...patch }
  next.filters = cleanFilters(next.filters)
  const fields: Writable<'views', 'update'> = {}
  if (next.name !== view.name) fields.name = next.name
  if (next.emoji !== view.emoji) fields.emoji = next.emoji
  if (next.description !== view.description) fields.description = next.description
  if (!equal(next.filters, view.filters)) fields.filters = toJson(next.filters)
  if (!equal(next.display, view.display)) fields.display = toJson(next.display)
  const changes = updated('views', { id }, fields)
  if (changes.length) write({ changes })
}

export function deleteView(id: string) {
  const c = context()
  const s = useData.getState()
  // the database deletes your favourite of it along with it
  if (c && s.views[id]) write({ changes: [del('views', { id })], cascade: favouritesOf(s, c, [id]) })
}

// ---------- projects ----------

export interface NewProject {
  name: string
  emoji: string
  description?: string
  status?: Project['status']
  lead?: string | null
  teams?: string[]
  targetDate?: string | null
}

/** the project_teams rows to add and remove so a project lists `after` instead of `before` */
function projectTeamChanges(projectId: string, before: readonly string[], after: readonly string[], c: Ctx): AnyChange[] {
  const out: AnyChange[] = []
  for (const key of new Set([...before, ...after])) {
    const team_id = tid(c, key)
    if (!team_id || before.includes(key) === after.includes(key)) continue
    const k = { project_id: projectId, team_id }
    out.push(after.includes(key) ? ins('project_teams', k, { workspace_id: c.workspaceId, ...k }) : del('project_teams', k))
  }
  return out
}

export function createProject(input: NewProject): Project {
  const c = context()
  const project: Project = {
    id: ulid(),
    name: input.name.trim(),
    emoji: input.emoji,
    description: input.description?.trim() ?? '',
    status: input.status ?? 'planned',
    lead: input.lead ?? null,
    teams: [...new Set(input.teams ?? [])],
    targetDate: input.targetDate ?? null,
    createdAt: now(),
  }
  if (!c) return project
  const p = project
  write({
    changes: [
      ins(
        'projects',
        { id: p.id },
        { id: p.id, workspace_id: c.workspaceId, name: p.name, emoji: p.emoji, description: p.description, status: p.status, lead_id: pid(c, p.lead) ?? null, target_date: p.targetDate },
        { created_at: p.createdAt, linear_id: null, extra: {} },
      ),
      ...projectTeamChanges(p.id, [], p.teams, c),
    ],
  })
  return useData.getState().projects[p.id] ?? project
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'emoji' | 'description' | 'status' | 'lead' | 'teams' | 'targetDate'>>

export function updateProject(id: string, patch: ProjectPatch) {
  const c = context()
  const project = useData.getState().projects[id]
  if (!c || !project) return
  const fields: Writable<'projects', 'update'> = {}
  if (patch.name !== undefined && patch.name !== project.name) fields.name = patch.name
  if (patch.emoji !== undefined && patch.emoji !== project.emoji) fields.emoji = patch.emoji
  if (patch.description !== undefined && patch.description !== project.description) fields.description = patch.description
  if (patch.status !== undefined && patch.status !== project.status) fields.status = patch.status
  if (patch.lead !== undefined && patch.lead !== project.lead) {
    const lead = pid(c, patch.lead)
    if (lead !== undefined) fields.lead_id = lead
  }
  if (patch.targetDate !== undefined && patch.targetDate !== project.targetDate) fields.target_date = patch.targetDate
  const changes = [...updated('projects', { id }, fields), ...(patch.teams ? projectTeamChanges(id, project.teams, patch.teams, c) : [])]
  if (changes.length) write({ changes })
}

/** remove a project; its issues stay, without a project */
export function deleteProject(id: string) {
  const c = context()
  const s = useData.getState()
  const project = s.projects[id]
  if (!c || !project) return
  write({
    changes: [del('projects', { id })],
    after: viewsWithout(s.views, 'projects', id),
    cascade: [
      ...project.teams.flatMap((key) => {
        const team_id = tid(c, key)
        return team_id ? [del('project_teams', { project_id: id, team_id })] : []
      }),
      ...favouritesOf(s, c, [id]),
    ],
    untilEcho: allIssues(s).filter((i) => i.project === id).map((i) => upd('issues', { id: i.id }, { project_id: null })),
  })
}

// ---------- teams ----------

export function createTeam(input: { key: string; name: string; emoji: string }): Team {
  const c = context()
  const s = useData.getState()
  if (s.teams[input.key]) {
    tell(MESSAGES.teamKey)
    return s.teams[input.key]
  }
  const team: Team = { key: input.key, name: input.name.trim(), emoji: input.emoji, members: s.me ? [s.me.login] : [], createdAt: now(), lastNumber: 0, autoArchive: AUTO_ARCHIVE_MONTHS }
  if (!c) return team
  const id = crypto.randomUUID()
  write({
    changes: [
      ins('teams', { id }, { id, workspace_id: c.workspaceId, key: team.key, name: team.name, emoji: team.emoji }, { created_at: team.createdAt, last_number: 0, auto_archive: AUTO_ARCHIVE_MONTHS, linear_id: null, extra: {} }),
      ins('team_members', { team_id: id, profile_id: c.meId }, { workspace_id: c.workspaceId, team_id: id, profile_id: c.meId }),
    ],
  })
  return useData.getState().teams[team.key] ?? team
}

/** how many months after an issue is finished it gets archived; 0 = never */
export function setAutoArchive(key: string, months: number) {
  const c = context()
  const team = useData.getState().teams[key]
  const id = c && tid(c, key)
  if (!c || !id || !team || (team.autoArchive ?? AUTO_ARCHIVE_MONTHS) === months) return
  write({ changes: [upd('teams', { id }, { auto_archive: months })] })
}

/** a team's name or emoji; its key stays (issue numbers like ENG-12 are made from it) */
export function updateTeam(key: string, patch: { name?: string; emoji?: string }) {
  const c = context()
  const team = useData.getState().teams[key]
  const id = c && tid(c, key)
  if (!id || !team) return
  const fields: Writable<'teams', 'update'> = {}
  const name = patch.name?.trim()
  if (name && name !== team.name) fields.name = name
  if (patch.emoji !== undefined && patch.emoji !== team.emoji) fields.emoji = patch.emoji
  const changes = updated('teams', { id }, fields)
  if (changes.length) write({ changes })
}

/** what deleting a team takes with it, for the warning; `archived` counts what's loaded (backend.countArchived counts all) */
export function teamContents(key: string): { issues: number; archived: number; comments: number; views: number } {
  const s = useData.getState()
  const issues = Object.values(s.issues).filter((i) => i.team === key)
  return {
    issues: issues.length,
    archived: Object.values(s.archive).filter((i) => i.team === key).length,
    comments: issues.reduce((n, i) => n + (s.comments[i.id]?.length ?? 0), 0),
    views: Object.values(s.views).filter((v) => v.team === key).length,
  }
}

/**
 * Delete a team for everyone: its issues, comments, archive and its own views go. Sub-issues in other teams lose their
 * parent, projects stop listing the team, and inbox notes about its issues go away. Only admins and owners may: for
 * anyone else it says so and returns false.
 */
export function deleteTeam(key: string): boolean {
  const c = context()
  const s = useData.getState()
  const id = c && tid(c, key)
  if (!c || !id || !s.teams[key]) return false
  if (!isAdmin(s)) {
    tell(MESSAGES.deleteTeam)
    return false
  }
  const all = allIssues(s)
  const gone = new Set(all.filter((i) => i.team === key).map((i) => i.id))
  const views = new Set(Object.values(s.views).filter((v) => v.team === key).map((v) => v.id))
  write({
    changes: [del('teams', { id })],
    // only once the team is gone: a refused delete leaves the other views as they were
    after: viewsWithout(s.views, 'teams', key, views),
    // all of this the database deletes along with the team
    cascade: [
      ...[...gone].map((i) => del('issues', { id: i })),
      ...[...views].map((v) => del('views', { id: v })),
      ...favouritesOf(s, c, [...views]),
      ...Object.values(s.projects)
        .filter((p) => p.teams.includes(key))
        .map((p) => del('project_teams', { project_id: p.id, team_id: id })),
      ...s.inbox.filter((n) => gone.has(n.issue)).map((n) => del('inbox', { id: n.id })),
    ],
    untilEcho: [
      ...all.filter((i) => !gone.has(i.id) && i.parent && gone.has(i.parent)).map((i) => upd('issues', { id: i.id }, { parent_id: null })),
      ...all.filter((i) => !gone.has(i.id) && i.duplicateOf && gone.has(i.duplicateOf)).map((i) => upd('issues', { id: i.id }, { duplicate_of: null })),
    ],
  })
  return true
}

export function joinTeam(key: string) {
  const c = context()
  const s = useData.getState()
  const team = s.teams[key]
  const id = c && tid(c, key)
  if (!c || !id || !team || !s.me || team.members.includes(s.me.login)) return
  const k = { team_id: id, profile_id: c.meId }
  write({ changes: [ins('team_members', k, { workspace_id: c.workspaceId, ...k })] })
}

export function leaveTeam(key: string) {
  const c = context()
  const s = useData.getState()
  const team = s.teams[key]
  const id = c && tid(c, key)
  if (!c || !id || !team || !s.me || !team.members.includes(s.me.login)) return
  write({ changes: [del('team_members', { team_id: id, profile_id: c.meId })] })
}

/** "Engineering" → "ENG", "Mobile app" → "MA" */
export function suggestKey(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const raw = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3)
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z]/.test(key) ? key.slice(0, 7) : `T${key}`.slice(0, 7)
}

// ---------- people and the workspace ----------

/** Your name as teammates see it here. Empty, or the same as it is: nothing changes. */
export function renameMe(name: string) {
  const c = context()
  const s = useData.getState()
  if (!c || !s.me) return
  const mine = s.people[s.me.login] ?? s.me
  const typed = name.trim().replace(/\s+/g, ' ')
  if (!typed || typed === mine.name) return
  write({ changes: [upd('profiles', { id: c.meId }, { name: typed, name_set_here: true })] })
}

/**
 * Your @handle, everywhere you are (Settings › Profile). Awaited like the member actions below: the database
 * says whether someone else has it. Throws an Error whose message can be shown as it is. Mentions of your old handle
 * become plain text, and anyone may take it.
 */
export async function changeHandle(typed: string): Promise<void> {
  const s = useData.getState()
  const session = useSession.getState()
  const me = (s.me && s.people[s.me.login]) ?? session.user
  if (!me) throw new Error('Pick your name first.')
  const handle = cleanHandle(typed)
  const problem = handleProblem(handle, me, s.people)
  if (problem === 'same') return
  if (problem === 'invalid') throw new Error(HANDLE_WORDS.invalid)
  if (problem === 'taken') throw new Error(HANDLE_WORDS.taken(handle))
  // shown here at once; teammates get it from the live change
  const mine = await backend.setHandle(handle)
  session.setProfile(mine.id, mine.person)
}

// ---------- members, roles and invites ----------
// Awaited, not handed to the writer: the database rules word their refusals precisely, and nothing should flicker
// back. Each throws an Error whose message can be shown as it is; the store follows from the database's echo.

function openHere(): WriteContext {
  const c = context()
  if (!c) throw new Error('Open the workspace first.')
  return c
}

/**
 * Save a Linear import (Settings › Import from Linear), worked out by backend.planImport. Admins and owners only.
 * `progress` hears how much is saved; it throws an ImportProblem, worded to show, when it stops partway (everything
 * saved until then stays, and running it again goes on from there). Returns how many things changed.
 */
export async function importFromLinear(plan: ImportPlan, progress: (saved: number, total: number) => void): Promise<number> {
  if (!isAdmin(useData.getState())) throw new ImportProblem('Only admins and owners can import from Linear.')
  return backend.importRows(plan, progress)
}

function idOf(c: WriteContext, login: string): string {
  const id = c.registry.profileId(login)
  if (!id) throw new Error(`Sprawniej doesn't know @${handleOf(useData.getState().people[login] ?? { login })} here.`)
  return id
}

async function changeMember(login: string, to: Role | 'removed') {
  const c = openHere()
  const s = useData.getState()
  const target = whoIs(s, login)
  if (!target) throw new Error("They're not in this workspace any more.")
  if (to === target.role) return
  const why = ruleFor(myWho(s), target, to, ownerCount(s))
  if (why) throw new Error(why)
  if (to === 'removed') await removeMember(c.workspaceId, idOf(c, login))
  else await setMemberRole(c.workspaceId, idOf(c, login), to)
  void backend.catchUp()
}

/** admins and owners; only owners make or change owners */
export const setRole = (login: string, role: Role): Promise<void> => changeMember(login, role)

/** they can't open the workspace any more; their work keeps their name */
export const removeFromWorkspace = (login: string): Promise<void> => changeMember(login, 'removed')

/** you leave the open workspace (the last owner can't), and land on the list of workspaces */
export async function leaveWorkspace(): Promise<void> {
  const c = openHere()
  const s = useData.getState()
  const can = canLeave(myWho(s), ownerCount(s))
  if (!can.ok) throw new Error(can.why ?? "You're not in this workspace any more.")
  // what you changed last is saved before you go
  await backend.flush(3_000)
  await backend.leave()
  useSession.getState().forget(c.workspaceId)
  location.hash = '#/'
}

/**
 * A link for one person (the default), for up to `maxUses` people, or for anyone with it (`maxUses: null`), working for
 * `days` (14 unless given). For someone from Linear it is always for one person: they become that person when they join.
 */
export async function createInvite(o: { role: InviteRole; forGuest?: string; forEmail?: string; days?: number; maxUses?: number | null }): Promise<Invite> {
  const c = openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notInviter)
  const who = o.forGuest ? { forProfile: idOf(c, o.forGuest), maxUses: 1 } : { maxUses: o.maxUses }
  return makeInvite(c.workspaceId, { role: o.role, forEmail: o.forEmail, days: o.days, ...who })
}

/** nobody new can join with the link from now on; who joined stays. It can't be undone. */
export async function endInvite(id: string): Promise<void> {
  openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notEnder)
  await stopInvite(id)
}

export async function deleteInvite(id: string): Promise<void> {
  openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notInviter)
  await removeInvite(id)
}

// ---------- GitHub ----------

/**
 * Pull requests in this repository move the workspace's issues (docs/github-app.md). Takes "owner/name" or a link
 * to the repository; throws an Error whose message can be shown as it is.
 */
export async function connectRepo(input: string): Promise<string> {
  const c = openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notGitHub)
  const repo = repoFromInput(input)
  if (!repo) throw new Error('That isn’t a repository. Write it as owner/name, for example acme/website.')
  await addRepo(c.workspaceId, repo)
  return repo
}

export async function disconnectRepo(id: string): Promise<void> {
  openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notGitHub)
  await removeRepo(id)
}

// ---------- Notion ----------

/** the team a Notion page goes to, by its key */
function notionTeam(c: WriteContext, key: string): string {
  const id = tid(c, key)
  if (!id) throw new Error('That team is gone. Pick another.')
  return id
}

/**
 * Pages sent from Notion become issues in this team (docs/notion.md). Gives the address to paste into Notion's
 * "Send webhook"; it's shown only now. Throws an Error whose message can be shown as it is.
 */
export async function connectNotion(teamKey: string): Promise<{ id: string; address: string }> {
  const c = openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notNotion)
  return addNotion(c.workspaceId, notionTeam(c, teamKey))
}

/** "Replace address": a new one for the connection `id`, and the old one stops working at once */
export async function newNotionAddress(id: string): Promise<string> {
  openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notNotion)
  return replaceNotionAddress(id)
}

export async function setNotionTeam(id: string, teamKey: string): Promise<void> {
  const c = openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notNotion)
  await moveNotionTeam(id, notionTeam(c, teamKey))
}

/** Pages sent from Notion stop becoming issues; the issues already made stay. */
export async function disconnectNotion(id: string): Promise<void> {
  openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notNotion)
  await removeNotion(id)
}

/** Someone from the Linear import who hadn't joined is this member: their issues, comments and views move over. */
export async function linkPerson(guest: string, to: string): Promise<void> {
  const c = openHere()
  if (!isAdmin(useData.getState())) throw new Error(RULES.notLinker)
  await linkGuest(c.workspaceId, idOf(c, guest), idOf(c, to))
  void backend.catchUp()
}

/** joins with an invite link (no workspace needs to be open); returns the workspace's id. Throws an InviteError. */
export const joinWorkspace = (token: string): Promise<string> => acceptInvite(token)

/** A brand-new workspace with you as its owner and its first team. Returns its id. */
export function startWorkspace(name: string, firstTeam: TeamDraft): Promise<string> {
  return createWorkspace(name, firstTeam)
}

export function renameWorkspace(name: string) {
  const c = context()
  const s = useData.getState()
  const ws = s.workspace
  if (!c || !ws || !name.trim() || name.trim() === ws.name) return
  if (!isAdmin(s)) {
    tell(MESSAGES.renameWorkspace)
    return
  }
  write({ changes: [upd('workspaces', { id: c.workspaceId }, { name: name.trim() })] })
}

// ---------- pictures ----------

/** what to tell someone whose picture couldn't be added */
export const PICTURE_MESSAGES: Record<PictureProblem, string> = {
  'too-big': `This picture is too big. Pictures can be up to ${MAX_IMAGE_MB} MB.`,
  'wrong-type': 'Only PNG, JPEG, GIF and WebP pictures can be added.',
  refused: "You can't add pictures to this workspace.",
  'signed-out': 'Please sign in again, then add the picture.',
  network: "This picture couldn't be added. Check your connection and try again.",
}

/**
 * Keep a pasted or dropped picture with the workspace. Returns the address to put in the Markdown; `named` hears it
 * as soon as it's known, while the picture already shows from this browser's own copy.
 */
export async function addImage(file: Blob, named?: (src: string) => void): Promise<string> {
  const ext = IMAGE_TYPES[file.type]
  if (!ext) throw new Error(PICTURE_MESSAGES['wrong-type'])
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) throw new Error(PICTURE_MESSAGES['too-big'])
  const ws = openWorkspaceId()
  if (!ws) throw new Error('Pictures can be added once your workspace is open.')
  const name = await pictureName(file, ext)
  const path = picturePath(ws, name)
  const src = `/assets/${name}`
  pictures.preview(path, file)
  named?.(src)
  try {
    await pictures.add(path, file)
  } catch (e) {
    throw new Error(PICTURE_MESSAGES[e instanceof PictureError ? e.kind : 'network'], { cause: e })
  }
  return src
}

// ---------- light or dark ----------

// Sends the choice on screen, not this browser's copy (which may not have been kept: storage switched off). What
// couldn't be sent stays marked, and goes again when you're back online, signed in again, or next time.
const themeSaver = makeThemeSaver(saveTheme, () => useTheme.getState().choice, () => clearUnsent())

/** System, Light or Dark: shows at once, and saves by itself with your account (quietly, also when offline) */
export function setTheme(choice: ThemeChoice) {
  showTheme(choice)
  writeDevice(choice)
  const id = useAuth.getState().user?.id
  if (!id) return
  markUnsent(id)
  themeSaver.save()
}

/** a choice made here that isn't with your account yet goes again */
export function sendUnsentTheme() {
  const id = useAuth.getState().user?.id
  if (id && readUnsent() === id) themeSaver.save()
}
