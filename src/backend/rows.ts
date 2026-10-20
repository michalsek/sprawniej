/**
 * Database rows to the app's own shapes (src/model/schema.ts) and back. Rows point at people and teams by id; the
 * app by login and team key, so both ways go through the registry.
 *
 * Fields the database has no column for travel in `extra`, so nothing a newer app wrote is lost. Times: the database
 * sends "2026-10-19T12:28:00.816096+00:00", the app uses "2026-10-19T12:28:00.816Z" everywhere (it compares them as
 * text), so every time goes through iso(). changed_at never does: it stays exact for the newer-wins checks.
 */
import type { Json } from './database.types'
import type { Registry } from './registry'
import type { Insert, Row } from './tables'
import {
  AUTO_ARCHIVE_MONTHS,
  isGuest,
  linearIdsOf,
  type ArchivedIssue,
  type Comment,
  type Display,
  type Favourite,
  type Filters,
  type InboxItem,
  type Issue,
  type Known,
  type Label,
  type Member,
  type Person,
  type Project,
  type PullRequest,
  type ReadState,
  type Status,
  type Team,
  type View,
  type Workspace,
} from '@/model/schema'
import type { IssueCategory, Priority, StatusKind } from '@/model/status'

// ---------- times ----------

const STAMP = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(?:Z|([+-])(\d\d)(?::?(\d\d))?)?$/

/**
 * Microseconds since 1970, exact (a bigint), for comparing changed_at and deleted_at: the database keeps
 * microseconds, and two changes within one millisecond must still come in the right order. Null if unreadable.
 */
export function micros(s: string): bigint | null {
  const m = STAMP.exec(s)
  if (!m) return null
  const [, y, mo, d, h, mi, sec, frac = '', sign, oh = '0', om = '0'] = m
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec))
  if (Number.isNaN(ms)) return null
  const offset = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om))
  return (BigInt(ms) - BigInt(offset) * 60_000n) * 1000n + BigInt(frac.padEnd(6, '0').slice(0, 6))
}

/** -1, 0 or 1 for two times already read with micros(); null counts as the oldest */
export function compareMicros(x: bigint | null, y: bigint | null): number {
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1
  return x < y ? -1 : x > y ? 1 : 0
}

/** -1, 0 or 1; a missing or unreadable time counts as the oldest */
export function compareStamp(a: string | null | undefined, b: string | null | undefined): number {
  return compareMicros(a ? micros(a) : null, b ? micros(b) : null)
}

/** a time as the app keeps it: "….123Z" (milliseconds cut, not rounded); something unreadable comes back as it is */
export function iso(s: string): string {
  const m = micros(s)
  if (m === null) return s
  // floor, also before 1970
  const ms = m >= 0n ? m / 1000n : -((-m + 999n) / 1000n)
  return new Date(Number(ms)).toISOString()
}

/** deletions are kept 45 days: a browser last up to date longer ago than this could miss some */
export const MAX_AGE_DAYS = 44

/** last up to date (`at`, ms on this browser's clock) more than `days` ago: catching up could miss deletions */
export function tooLongAgo(at: number, now: number, days = MAX_AGE_DAYS): boolean {
  return now - at > days * 86_400_000
}

export function isoOrNull(s: string | null | undefined): string | null {
  return s == null ? null : iso(s)
}

// ---------- shared ----------

/** how a row finds people and teams; `miss` hears about an id the registry doesn't know yet */
export interface Resolve {
  registry: Registry
  miss?: (id: string, table: 'profiles' | 'teams') => void
}

type Linked = { linearId?: string }
const names = <T>(...keys: (keyof Known<T> & string)[]): ReadonlySet<string> => new Set(keys)

/** the fields each kind has (or makes up from other tables), so none of them is kept in `extra` as well */
const KNOWN = {
  workspace: names<Workspace>('id', 'name', 'createdAt'),
  person: names<Person & Linked & { id: string; linearIds: string[] }>('id', 'login', 'handle', 'githubId', 'name', 'avatarUrl', 'nameSetHere', 'linearId', 'linearIds'),
  team: names<Team & Linked & { id: string }>('id', 'key', 'name', 'emoji', 'members', 'createdAt', 'lastNumber', 'autoArchive', 'linearId'),
  label: names<Label & Linked>('id', 'name', 'color', 'linearId'),
  status: names<Status>('id', 'kind', 'category', 'name', 'color', 'position', 'hidden'),
  project: names<Project & Linked>('id', 'name', 'emoji', 'description', 'status', 'lead', 'teams', 'targetDate', 'createdAt', 'linearId'),
  issue: names<ArchivedIssue & Linked>(
    'id', 'team', 'number', 'title', 'description', 'status', 'statusId', 'priority', 'assignee', 'labels', 'project', 'parent',
    'dueDate', 'estimate', 'sortOrder', 'createdBy', 'createdAt', 'updatedAt', 'completedAt', 'duplicateOf',
    'subscribers', 'unsubscribed', 'formerRefs', 'linearId', 'archivedAt', 'archivedBy', 'comments',
  ),
  comment: names<Comment & Linked>('id', 'issue', 'author', 'createdAt', 'editedAt', 'body', 'linearId'),
  view: names<View & Linked>('id', 'name', 'emoji', 'description', 'owner', 'team', 'filters', 'display', 'createdAt', 'linearId'),
  inbox: names<InboxItem>('id', 'type', 'issue', 'actor', 'at', 'comment', 'status', 'statusId', 'readAt'),
  readState: names<ReadState>('readUntil'),
  favourite: names<Favourite>('id', 'kind', 'sortOrder'),
}

/** a JSON column that holds an object (extra, filters, display); anything else reads as {} */
function jsonObject<T extends object>(v: Json | undefined): T {
  return (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as T
}

/** what `extra` holds, minus names the row has a column for (a column always wins) */
function fromExtra(extra: Json | undefined, known: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(jsonObject<Record<string, Json>>(extra))) if (!known.has(k)) out[k] = v
  return out
}

/** the model's own fields the database has no column for */
function toExtra(model: object, known: ReadonlySet<string>): Json {
  const out: { [key: string]: Json } = {}
  for (const [k, v] of Object.entries(model)) if (!known.has(k) && v !== undefined) out[k] = v as Json
  return out
}

const linear = (row: { linear_id: string | null }) => (row.linear_id != null ? { linearId: row.linear_id } : {})

/** a person's login; an id nobody knows yet stands in for it until their profile arrives */
function login(id: string | null | undefined, r: Resolve): string | null {
  if (!id) return null
  const known = r.registry.login(id)
  if (known !== undefined) return known
  r.miss?.(id, 'profiles')
  return id
}

/** undefined while the team isn't known (and for a row that has none) */
function teamKey(id: string | null | undefined, r: Resolve): string | undefined {
  if (!id) return undefined
  const key = r.registry.teamKey(id)
  if (key === undefined) r.miss?.(id, 'teams')
  return key
}

type Stamped = { changed_at?: string | null }

/** names in the order their join rows were made (oldest first, ones not saved yet last), then by name */
function inOrder<R extends Stamped>(rows: readonly R[], name: (row: R) => string | undefined): string[] {
  const byName = (a: { n: string }, b: { n: string }) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0)
  const named = rows.flatMap((row) => {
    const n = name(row)
    return n === undefined ? [] : [{ n, at: row.changed_at ? micros(row.changed_at) : null }]
  })
  named.sort((a, b) => {
    if (a.at === null || b.at === null) return a.at === b.at ? byName(a, b) : a.at === null ? 1 : -1
    return compareMicros(a.at, b.at) || byName(a, b)
  })
  return [...new Set(named.map((x) => x.n))]
}

// ---------- rows to the app ----------

export function rowToWorkspace(row: Row<'workspaces'>): Workspace {
  return { ...fromExtra(row.extra, KNOWN.workspace), id: row.id, name: row.name, createdAt: iso(row.created_at) }
}

/** a guest keeps one Linear id (`linearId`); an account can stand for several (`linearIds`). `handle` only when it isn't the login */
export function rowToPerson(row: Row<'profiles'>): Person {
  const ids = row.linear_ids ?? []
  return {
    ...fromExtra(row.extra, KNOWN.person),
    login: row.login,
    ...(row.handle != null && row.handle !== row.login && { handle: row.handle }),
    githubId: row.github_id ?? 0,
    name: row.name,
    avatarUrl: row.avatar_url,
    ...(row.name_set_here && { nameSetHere: true }),
    ...(row.guest_of && ids.length > 0 && { linearId: ids[0] }),
    ...((row.guest_of ? ids.length > 1 : ids.length > 0) && { linearIds: [...ids] }),
  }
}

export function rowToMember(row: Pick<Row<'workspace_members'>, 'role' | 'removed_at'>): Member {
  return { role: row.role as Member['role'], removedAt: isoOrNull(row.removed_at) }
}

export type TeamMemberIn = Pick<Row<'team_members'>, 'profile_id'> & Stamped
export function rowToTeam(row: Row<'teams'>, members: readonly TeamMemberIn[], r: Resolve): Team {
  return {
    ...fromExtra(row.extra, KNOWN.team),
    key: row.key,
    name: row.name,
    emoji: row.emoji,
    members: inOrder(members, (m) => login(m.profile_id, r) ?? undefined),
    createdAt: iso(row.created_at),
    lastNumber: row.last_number,
    autoArchive: row.auto_archive,
    ...linear(row),
  }
}

export function rowToLabel(row: Row<'labels'>): Label {
  return { ...fromExtra(row.extra, KNOWN.label), id: row.id, name: row.name, color: row.color, ...linear(row) }
}

export function rowToStatus(row: Row<'statuses'>): Status {
  return {
    ...fromExtra(row.extra, KNOWN.status),
    id: row.id,
    kind: row.kind as StatusKind,
    category: row.category,
    name: row.name,
    color: row.color,
    position: row.position,
    hidden: row.hidden,
  }
}

export type ProjectTeamIn = Pick<Row<'project_teams'>, 'team_id'> & Stamped
/** a team not known yet is left out until it arrives */
export function rowToProject(row: Row<'projects'>, teams: readonly ProjectTeamIn[], r: Resolve): Project {
  return {
    ...fromExtra(row.extra, KNOWN.project),
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    status: row.status as Project['status'],
    lead: login(row.lead_id, r),
    teams: inOrder(teams, (t) => teamKey(t.team_id, r)),
    targetDate: row.target_date,
    createdAt: iso(row.created_at),
    ...linear(row),
  }
}

export type IssueLabelIn = Pick<Row<'issue_labels'>, 'label_id'> & Stamped
export type IssueFollowerIn = Pick<Row<'issue_followers'>, 'profile_id' | 'following'> & Stamped
export type IssueResult = { archived: false; issue: Issue } | { archived: true; issue: ArchivedIssue }

/**
 * An issue with its labels and followers. Archived (archived_at set): an ArchivedIssue that holds its comments.
 * Undefined while its team isn't known: an issue can't show without one.
 */
export function rowToIssue(
  row: Row<'issues'>,
  labels: readonly IssueLabelIn[],
  followers: readonly IssueFollowerIn[],
  r: Resolve,
  comments: Comment[] = [],
): IssueResult | undefined {
  const team = teamKey(row.team_id, r)
  if (team === undefined) return undefined
  const who = (following: boolean) =>
    [...new Set(followers.flatMap((f) => (f.following === following ? [login(f.profile_id, r)] : [])).filter((l) => l !== null))].sort()
  const subscribers = who(true)
  const unsubscribed = who(false)
  const issue: Issue = {
    ...fromExtra(row.extra, KNOWN.issue),
    id: row.id,
    team,
    number: row.number,
    title: row.title,
    // a row too big to send comes without it (`partial`) until it's fetched
    description: row.description ?? '',
    status: row.status as IssueCategory,
    // a row from before statuses (there should be none once the database has them) waits for one
    statusId: row.status_id ?? '',
    priority: row.priority as Priority,
    assignee: login(row.assignee_id, r),
    labels: inOrder(labels, (l) => l.label_id),
    project: row.project_id,
    parent: row.parent_id,
    dueDate: row.due_date,
    estimate: row.estimate == null ? null : Number(row.estimate),
    sortOrder: row.sort_order,
    createdBy: login(row.created_by, r) ?? '',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: isoOrNull(row.completed_at),
    duplicateOf: row.duplicate_of,
    ...(subscribers.length > 0 && { subscribers }),
    ...(unsubscribed.length > 0 && { unsubscribed }),
    ...(row.former_refs?.length > 0 && { formerRefs: [...row.former_refs] }),
    ...linear(row),
  }
  if (!row.archived_at) return { archived: false, issue }
  return { archived: true, issue: { ...issue, archivedAt: iso(row.archived_at), archivedBy: login(row.archived_by, r) ?? '', comments } }
}

export function rowToComment(row: Row<'comments'>, r: Resolve): Comment {
  return {
    ...fromExtra(row.extra, KNOWN.comment),
    id: row.id,
    issue: row.issue_id,
    author: login(row.author_id, r) ?? '',
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    body: row.body ?? '',
    ...linear(row),
  }
}

/** filters and display already hold logins and team keys, so they pass through. Undefined while its team isn't known */
export function rowToView(row: Row<'views'>, r: Resolve): View | undefined {
  const team = row.team_id === null ? null : teamKey(row.team_id, r)
  if (team === undefined) return undefined
  return {
    ...fromExtra(row.extra, KNOWN.view),
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    owner: login(row.owner_id, r) ?? '',
    team,
    filters: jsonObject<Filters>(row.filters),
    display: jsonObject<Display>(row.display),
    createdAt: iso(row.created_at),
    ...linear(row),
  }
}

export function rowToInbox(row: Row<'inbox'>, r: Resolve): InboxItem {
  return {
    ...fromExtra(row.extra, KNOWN.inbox),
    id: row.id,
    type: row.type as InboxItem['type'],
    issue: row.issue_id,
    actor: login(row.actor_id, r) ?? '',
    at: iso(row.at),
    ...(row.comment_id != null && { comment: row.comment_id }),
    ...(row.status != null && { status: row.status as IssueCategory }),
    ...(row.status_id != null && { statusId: row.status_id }),
    ...(row.read_at != null && { readAt: iso(row.read_at) }),
  }
}

/** written only by the GitHub webhook, so it has no `extra` */
export function rowToPullRequest(row: Row<'issue_pull_requests'>, r: Resolve): PullRequest {
  return {
    id: row.pull_request_id,
    repo: row.repo,
    number: row.number,
    title: row.title,
    url: row.url,
    state: row.state as PullRequest['state'],
    author: login(row.author_id, r),
    updatedAt: iso(row.github_updated_at),
  }
}

/** an issue's pull requests by repository, then number */
export function pullRequestsOf(rows: readonly Row<'issue_pull_requests'>[], r: Resolve): PullRequest[] {
  return rows
    .map((row) => rowToPullRequest(row, r))
    .sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.number - b.number))
}

export function rowToReadState(row: Row<'read_state'>): ReadState {
  return { ...fromExtra(row.extra, KNOWN.readState), readUntil: isoOrNull(row.read_until) }
}

/** project_id and view_id only repeat item_id for the foreign keys, so they are left out */
export function rowToFavourite(row: Row<'favourites'>): Favourite {
  return { ...fromExtra(row.extra, KNOWN.favourite), id: row.item_id, kind: row.kind, sortOrder: row.sort_order }
}

// ---------- the app to rows ----------
// Whole rows for the import (import_rows), which may write every column, times and Linear ids included. Actions
// send only the columns people may write (changes.ts, Writable). A login or team key the registry doesn't know is
// a mistake in the code, so it throws.

function requiredProfileId(who: string, reg: Registry): string {
  const id = reg.profileId(who)
  if (!id) throw new Error(`Unknown person: ${who}`)
  return id
}

/** no one ('' or null) is null */
const profileId = (who: string | null | undefined, reg: Registry): string | null => (who ? requiredProfileId(who, reg) : null)

function teamId(key: string, reg: Registry): string {
  const id = reg.teamId(key)
  if (!id) throw new Error(`Unknown team: ${key}`)
  return id
}

/** an id the model brings itself (a guest made by the import), else the registry's */
const ownId = (model: object): string | undefined => {
  const id = (model as { id?: unknown }).id
  return typeof id === 'string' && id ? id : undefined
}

const linearId = (model: object): string | null => {
  const id = (model as { linearId?: unknown }).linearId
  return typeof id === 'string' ? id : null
}

export function personToProfile(p: Person, workspaceId: string, reg: Registry): Insert<'profiles'> {
  return {
    id: ownId(p) ?? requiredProfileId(p.login, reg),
    login: p.login,
    github_id: p.githubId > 0 ? p.githubId : null,
    name: p.name,
    avatar_url: p.avatarUrl,
    name_set_here: !!p.nameSetHere,
    guest_of: isGuest(p.login) ? workspaceId : null,
    linear_ids: linearIdsOf(p),
    extra: toExtra(p, KNOWN.person),
  }
}

export function teamToRows(t: Team, workspaceId: string, reg: Registry): { teams: Insert<'teams'>; team_members: Insert<'team_members'>[] } {
  const id = ownId(t) ?? teamId(t.key, reg)
  return {
    teams: {
      id,
      workspace_id: workspaceId,
      key: t.key,
      name: t.name,
      emoji: t.emoji,
      ...(t.lastNumber !== undefined && { last_number: t.lastNumber }),
      auto_archive: t.autoArchive ?? AUTO_ARCHIVE_MONTHS,
      linear_id: linearId(t),
      created_at: t.createdAt,
      extra: toExtra(t, KNOWN.team),
    },
    team_members: t.members.map((m) => ({ workspace_id: workspaceId, team_id: id, profile_id: requiredProfileId(m, reg) })),
  }
}

export function labelToRow(l: Label, workspaceId: string): Insert<'labels'> {
  return { id: l.id, workspace_id: workspaceId, name: l.name, color: l.color, linear_id: linearId(l), extra: toExtra(l, KNOWN.label) }
}

/** project_teams in the project's order: the database stamps them as they arrive, and reading keeps that order */
export function projectToRows(
  p: Project,
  workspaceId: string,
  reg: Registry,
): { projects: Insert<'projects'>; project_teams: Insert<'project_teams'>[] } {
  return {
    projects: {
      id: p.id,
      workspace_id: workspaceId,
      name: p.name,
      emoji: p.emoji,
      description: p.description,
      status: p.status,
      lead_id: profileId(p.lead, reg),
      target_date: p.targetDate,
      linear_id: linearId(p),
      created_at: p.createdAt,
      extra: toExtra(p, KNOWN.project),
    },
    project_teams: p.teams.map((key) => ({ workspace_id: workspaceId, project_id: p.id, team_id: teamId(key, reg) })),
  }
}

/** an issue as the import writes it: its category only, so it lands on the category's default status (or keeps its own) */
export type ImportedIssue = Omit<Insert<'issues'>, 'status_id'>

/**
 * issue_labels in the issue's order (as projectToRows); an archived issue's comments are written on their own. No
 * status_id: import_rows doesn't take it, and the database gives the issue its category's default status.
 */
export function issueToRows(
  i: Issue & { archivedAt?: string; archivedBy?: string },
  workspaceId: string,
  reg: Registry,
): { issues: ImportedIssue; issue_labels: Insert<'issue_labels'>[]; issue_followers: Insert<'issue_followers'>[] } {
  const followers = new Map<string, boolean>()
  for (const l of i.subscribers ?? []) followers.set(requiredProfileId(l, reg), true)
  for (const l of i.unsubscribed ?? []) followers.set(requiredProfileId(l, reg), false)
  return {
    issues: {
      id: i.id,
      workspace_id: workspaceId,
      team_id: teamId(i.team, reg),
      number: i.number,
      title: i.title,
      description: i.description,
      status: i.status,
      priority: i.priority,
      assignee_id: profileId(i.assignee, reg),
      project_id: i.project,
      parent_id: i.parent,
      due_date: i.dueDate ?? null,
      estimate: i.estimate ?? null,
      sort_order: i.sortOrder,
      duplicate_of: i.duplicateOf ?? null,
      former_refs: i.formerRefs ?? [],
      created_by: profileId(i.createdBy, reg),
      created_at: i.createdAt,
      updated_at: i.updatedAt,
      completed_at: i.completedAt ?? null,
      archived_at: i.archivedAt ?? null,
      archived_by: i.archivedAt ? profileId(i.archivedBy, reg) : null,
      linear_id: linearId(i),
      extra: toExtra(i, KNOWN.issue),
    },
    issue_labels: [...new Set(i.labels)].map((label_id) => ({ workspace_id: workspaceId, issue_id: i.id, label_id })),
    issue_followers: [...followers].map(([profile_id, following]) => ({ workspace_id: workspaceId, issue_id: i.id, profile_id, following })),
  }
}

export function commentToRow(c: Comment, workspaceId: string, reg: Registry): Insert<'comments'> {
  return {
    id: c.id,
    workspace_id: workspaceId,
    issue_id: c.issue,
    author_id: profileId(c.author, reg),
    body: c.body,
    created_at: c.createdAt,
    edited_at: c.editedAt ?? null,
    linear_id: linearId(c),
    extra: toExtra(c, KNOWN.comment),
  }
}

export function viewToRow(v: View, workspaceId: string, reg: Registry): Insert<'views'> {
  return {
    id: v.id,
    workspace_id: workspaceId,
    team_id: v.team === null ? null : teamId(v.team, reg),
    owner_id: profileId(v.owner, reg),
    name: v.name,
    emoji: v.emoji,
    description: v.description,
    filters: v.filters as Json,
    display: v.display as Json,
    created_at: v.createdAt,
    linear_id: linearId(v),
    extra: toExtra(v, KNOWN.view),
  }
}

export function inboxToRow(n: InboxItem, workspaceId: string, reg: Registry, recipient: string): Insert<'inbox'> {
  return {
    id: n.id,
    workspace_id: workspaceId,
    recipient_id: requiredProfileId(recipient, reg),
    actor_id: profileId(n.actor, reg),
    type: n.type,
    issue_id: n.issue,
    comment_id: n.comment ?? null,
    status: n.status ?? null,
    status_id: n.statusId ?? null,
    at: n.at,
    read_at: n.readAt ?? null,
    extra: toExtra(n, KNOWN.inbox),
  }
}
