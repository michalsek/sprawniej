/**
 * Working out the store parts again from the rows, for the things take.ts marked dirty. Something that comes out
 * equal to what the store has keeps the old object, and a record is copied only when one of its entries changes, so
 * screens redraw only what changed.
 */
import * as rows from '../rows'
import type { LiveTable, Row } from '../tables'
import type { Grouped } from './mirror'
import type { Dirty } from './take'
import type { ApplyContext, Ref, StoreSlice } from './state'
import type { Comment, Favourite, InboxItem } from '@/model/schema'
import { equal } from '@/lib/equal'

/** where the rows come from: the database's copy with your changes on top (take.ts, Intake) */
export interface Source {
  shown<N extends LiveTable>(t: N, key: Readonly<Record<string, unknown>>): Row<N> | undefined
  fold<N extends Grouped>(t: N, parent: string): Row<N>[]
  miss(id: string, table: 'profiles' | 'teams', ref: Ref): void
}

type RecField = 'people' | 'members' | 'labels' | 'statuses' | 'teams' | 'issues' | 'archive' | 'projects' | 'views' | 'comments' | 'pullRequests'

const byTime = (a: Comment, b: Comment) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
/** your order, then id, compared as plain strings (fractional keys rely on byte order) */
const byOrder = (a: Favourite, b: Favourite) =>
  a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const newestFirst = (a: InboxItem, b: InboxItem) => (a.at > b.at ? -1 : a.at < b.at ? 1 : a.id > b.id ? -1 : a.id < b.id ? 1 : 0)

/** the store parts that change, copied once */
class Patch {
  readonly out: Partial<StoreSlice> = {}
  private data: StoreSlice

  constructor(data: StoreSlice) {
    this.data = data
  }

  cur<F extends RecField>(f: F): StoreSlice[F] {
    return this.out[f] ?? this.data[f]
  }

  /** puts a value in a record part; one equal to what's there keeps the old object */
  set<F extends RecField>(f: F, key: string, value: StoreSlice[F][string] | undefined) {
    const old = this.cur(f)[key]
    if (value === undefined ? old === undefined : old !== undefined && equal(old, value)) return
    const rec = (this.out[f] ??= { ...this.data[f] }) as Record<string, StoreSlice[F][string]>
    if (value === undefined) delete rec[key]
    else rec[key] = value
  }
}

export function derive(src: Source, data: StoreSlice, dirty: Dirty, ctx: ApplyContext, workspaceGone: boolean): Partial<StoreSlice> {
  const p = new Patch(data)
  const { registry, workspaceId, meId } = ctx
  const ids = dirty.ids
  /** for a thing that refers to people and teams: an unknown id makes it wait */
  const resolve = (kind: Ref['kind'], id: string): rows.Resolve => ({ registry, miss: (missing, table) => src.miss(missing, table, { kind, id }) })

  for (const id of ids.person) {
    const row = src.shown('profiles', { id })
    if (row) {
      const person = rows.rowToPerson(row)
      p.set('people', person.login, person)
    } else {
      // a deleted guest: the registry still knows the login it had
      const login = registry.login(id)
      if (login !== undefined) p.set('people', login, undefined)
    }
  }

  for (const id of ids.member) {
    const row = src.shown('workspace_members', { workspace_id: workspaceId, profile_id: id })
    const login = registry.login(id)
    if (login === undefined && row) src.miss(id, 'profiles', { kind: 'member', id })
    // the id stood in for their login until their profile came
    else if (login !== undefined) p.set('members', id, undefined)
    p.set('members', login ?? id, row && rows.rowToMember(row))
  }

  for (const id of ids.team) {
    const row = src.shown('teams', { id })
    if (row) p.set('teams', row.key, rows.rowToTeam(row, src.fold('team_members', id), resolve('team', id)))
    else {
      const key = registry.teamKey(id)
      if (key !== undefined) p.set('teams', key, undefined)
    }
  }

  for (const id of ids.label) {
    const row = src.shown('labels', { id })
    p.set('labels', id, row && rows.rowToLabel(row))
  }

  for (const id of ids.status) {
    const row = src.shown('statuses', { id })
    p.set('statuses', id, row && rows.rowToStatus(row))
  }

  for (const id of ids.project) {
    const row = src.shown('projects', { id })
    p.set('projects', id, row && rows.rowToProject(row, src.fold('project_teams', id), resolve('project', id)))
  }

  for (const id of ids.issue) issue(id)
  function issue(id: string) {
    const row = src.shown('issues', { id })
    if (!row) {
      p.set('issues', id, undefined)
      p.set('archive', id, undefined)
      p.set('comments', id, undefined)
      p.set('pullRequests', id, undefined)
      return
    }
    const r = resolve('issue', id)
    const old = p.cur('comments')[id] ?? p.cur('archive')[id]?.comments
    const was = new Map((old ?? []).map((c) => [c.id, c]))
    const kept = src
      .fold('comments', id)
      .map((c) => rows.rowToComment(c, r))
      .sort(byTime)
      .map((c) => {
        const o = was.get(c.id)
        return o && equal(o, c) ? o : c
      })
    const list = old && old.length === kept.length && kept.every((c, n) => c === old[n]) ? old : kept
    const result = rows.rowToIssue(row, src.fold('issue_labels', id), src.fold('issue_followers', id), r, list)
    // its team isn't known yet: it shows once the team arrives
    if (!result) return
    const wasPull = new Map((p.cur('pullRequests')[id] ?? []).map((x) => [x.id, x]))
    const pulls = rows.pullRequestsOf(src.fold('issue_pull_requests', id), r).map((x) => {
      const o = wasPull.get(x.id)
      return o && equal(o, x) ? o : x
    })
    p.set('pullRequests', id, pulls.length ? pulls : undefined)
    if (result.archived) {
      p.set('archive', id, result.issue)
      p.set('issues', id, undefined)
      p.set('comments', id, undefined)
    } else {
      p.set('issues', id, result.issue)
      p.set('comments', id, list.length ? list : undefined)
      p.set('archive', id, undefined)
    }
  }

  for (const id of ids.view) {
    const row = src.shown('views', { id })
    if (!row) p.set('views', id, undefined)
    else {
      const view = rows.rowToView(row, resolve('view', id))
      if (view) p.set('views', id, view)
    }
  }

  if (ids.inbox.size) {
    const byId = new Map(data.inbox.map((n) => [n.id, n]))
    let changed = false
    for (const id of ids.inbox) {
      const row = src.shown('inbox', { id })
      const old = byId.get(id)
      // only this workspace's notes, and only yours (an action may write notes for others)
      if (!row || row.workspace_id !== workspaceId || (meId !== null && row.recipient_id !== meId)) {
        if (old) changed = byId.delete(id)
        continue
      }
      const n = rows.rowToInbox(row, resolve('inbox', id))
      if (old && equal(old, n)) continue
      byId.set(id, n)
      changed = true
    }
    if (changed) p.out.inbox = [...byId.values()].sort(newestFirst)
  }

  if (dirty.readState && meId) {
    const row = src.shown('read_state', { profile_id: meId, workspace_id: workspaceId })
    const next = row ? rows.rowToReadState(row) : { readUntil: null }
    if (!equal(data.readState, next)) p.out.readState = next
  }

  if (dirty.favourites && meId) {
    const was = new Map(data.favourites.map((f) => [f.id, f]))
    const next = src
      .fold('favourites', meId)
      .filter((row) => row.workspace_id === workspaceId)
      .map(rows.rowToFavourite)
      .sort(byOrder)
      .map((f) => {
        const o = was.get(f.id)
        return o && equal(o, f) ? o : f
      })
    if (next.length !== data.favourites.length || next.some((f, n) => f !== data.favourites[n])) p.out.favourites = next
  }

  if (dirty.workspace || workspaceGone) {
    const row = workspaceGone ? undefined : src.shown('workspaces', { id: workspaceId })
    const next = row ? rows.rowToWorkspace(row) : null
    if (next ? !equal(data.workspace, next) : data.workspace !== null) p.out.workspace = next
  }

  if (meId && ids.person.has(meId)) {
    const login = registry.login(meId)
    const me = (login !== undefined && p.cur('people')[login]) || null
    if (me !== data.me && !(me && data.me && equal(me, data.me))) p.out.me = me
  }

  return p.out
}
