/**
 * A pretend database for the actions and the writer (bun test, no network): in-memory tables behind the writer's
 * Transport, doing what the triggers and rules do that the app relies on (numbers, authors, times, "only the author
 * edits a comment", "only admins delete a team", cascades), plus the realtime messages a teammate would see.
 *
 * seed() opens a workspace on it: the store, a registry, a target (like LiveWorkspace) and the writer, attached.
 */
import { applyRows, emptyLive, type Incoming, type LiveState, type StoreSlice } from '@/backend/apply'
import { keyString } from '@/backend/changes'
import { Registry } from '@/backend/registry'
import { labelToRow, personToProfile, teamToRows } from '@/backend/rows'
import { KEYS, type LiveTable, type Message } from '@/backend/tables'
import { attach, startWrites, stopWrites, type Clock, type Page, type WriteTarget } from '@/backend/writes'
import { classify, goneMessage, refusedMessage, type What } from '@/backend/writes/problems'
import { ADD_UNLESS_THERE, whatOf, type Answer, type Outcome, type Request, type Transport } from '@/backend/writes/send'
import { EMPTY, useData, type DataState } from '@/data/store'
import type { Label, Person, Team } from '@/model/schema'

type Loose = Record<string, unknown>

export const WS = 'ws-1'
export const person = (login: string): Person => ({ login, githubId: login.length, name: login.toUpperCase(), avatarUrl: '' })
export const profileIdOf = (login: string) => `p-${login}`
export const teamIdOf = (key: string) => `t-${key.toLowerCase()}`

// ---------- time ----------

/** timers that run only when the test says time has passed */
export class FakeClock implements Clock {
  t = 1_000_000
  private timers: { id: number; at: number; fn: () => void }[] = []
  private next = 1
  now() {
    return this.t
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++
    this.timers.push({ id, at: this.t + ms, fn })
    return id
  }
  clearTimeout(id: unknown) {
    this.timers = this.timers.filter((x) => x.id !== id)
  }
  /** lets `ms` pass, running each timer that comes due (and what it starts) in order */
  async advance(ms: number) {
    const until = this.t + ms
    for (;;) {
      await drain()
      const due = this.timers.filter((x) => x.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.timers = this.timers.filter((x) => x !== due)
      this.t = Math.max(this.t, due.at)
      due.fn()
    }
    this.t = until
    await drain()
  }
}

/** lets everything already started finish (promises and microtasks) */
export async function drain(rounds = 8) {
  for (let n = 0; n < rounds; n++) await new Promise((r) => setTimeout(r, 0))
}

// ---------- the database ----------

type Failure = 'network' | '42501' | '23505:labels_name' | 'lostResponse'

const T0 = Date.parse('2026-10-19T12:00:00.000Z')

export class FakeDb implements Transport {
  /** table → keyString → row */
  readonly tables = new Map<LiveTable, Map<string, Loose>>()
  /** every request, in order */
  readonly log: Request[] = []
  /** what teammates would hear, not delivered until echo() */
  private pendingMessages: Message[] = []
  private holding = false
  private held: (() => void)[] = []
  private failures: Failure[] = []
  private offset = 0
  private stamp = 0
  /** who is signed in (the writer's target says) */
  actor: () => string

  constructor(actor: () => string) {
    this.actor = actor
  }

  t(table: LiveTable): Map<string, Loose> {
    let m = this.tables.get(table)
    if (!m) this.tables.set(table, (m = new Map()))
    return m
  }

  rows(table: LiveTable): Loose[] {
    return [...this.t(table).values()]
  }

  get(table: LiveTable, key: Loose): Loose | undefined {
    return this.t(table).get(keyString(table, key))
  }

  /** a row as it was there before the test (seeded) */
  put(table: LiveTable, row: Loose) {
    this.t(table).set(keyString(table, row), { changed_at: this.changedAt(), ...row })
  }

  // ---------- modes ----------

  /** requests wait until release() */
  hold() {
    this.holding = true
  }
  /** lets `n` waiting requests (all by default) through, and stops holding when all are */
  release(n = Infinity) {
    const go = this.held.splice(0, n)
    for (const g of go) g()
    if (n === Infinity) this.holding = false
  }
  failNext(kind: Failure, times = 1) {
    for (let n = 0; n < times; n++) this.failures.push(kind)
  }
  /** numbers come out `k` higher than the app guesses (a teammate was quicker) */
  numberOffset(k: number) {
    this.offset = k
  }

  /** the requests sent, for one table (notes count as inbox) */
  sent(table?: string): Request[] {
    return this.log.filter((r) => !table || whatOf(r).table === table)
  }

  /** the inbox notes a person got, oldest first */
  notesFor(login: string): Loose[] {
    return this.rows('inbox').filter((n) => n.recipient_id === profileIdOf(login))
  }

  /** the messages teammates would have heard since the last time */
  messages(): Message[] {
    const out = this.pendingMessages
    this.pendingMessages = []
    return out
  }

  // ---------- the transport ----------

  async run(req: Request, { retry }: { retry: boolean }): Promise<Answer> {
    this.log.push(req)
    if (this.holding) await new Promise<void>((r) => this.held.push(r))
    const fail = this.failures.shift()
    const what = whatOf(req)
    if (fail === 'network') return { problem: { kind: 'network', message: '' } }
    if (fail === '42501') return { problem: classify({ code: '42501', message: `new row violates row-level security policy for table "${what.table}"` }, 403, what) }
    if (fail === '23505:labels_name') return { problem: classify({ code: '23505', message: 'duplicate key value violates unique constraint "labels_name"' }, 409, what) }
    const answer = this.exec(req, retry)
    if (fail === 'lostResponse') return { problem: { kind: 'network', message: '' } }
    return answer
  }

  /** the next changed_at, later than any before */
  changedAt(): string {
    const us = ++this.stamp
    const d = new Date(T0 + Math.floor(us / 1000)).toISOString().slice(0, 23)
    return `${d}${String(us % 1000).padStart(3, '0')}+00:00`
  }

  private say(table: LiveTable, op: 'INSERT' | 'UPDATE' | 'DELETE', row: Loose) {
    this.pendingMessages.push({ table, op, row })
  }

  private role(): string | undefined {
    return this.get('workspace_members', { workspace_id: WS, profile_id: this.actor() })?.role as string | undefined
  }

  private refused(what: What, code: string, message: string): Answer {
    return { problem: classify({ code, message }, 409, what) }
  }

  private exec(req: Request, retry: boolean): Answer {
    const what = whatOf(req)
    switch (req.kind) {
      case 'insert':
        return this.insert(req.table, req.rows, retry, what)
      case 'update':
        return { outcomes: new Map(req.keys.map((k) => [keyString(req.table, k), this.update(req.table, k, req.fields, what)])) }
      case 'delete':
        return { outcomes: new Map(req.keys.map((k) => [keyString(req.table, k), this.remove(req.table, k, what)])) }
      case 'call': {
        const issue = this.get('issues', { id: req.args.p_issue })
        if (!issue) return { problem: classify({ code: 'P0002', message: 'There is no such issue.' }, 500, what) }
        if (issue.team_id === req.args.p_team) return { outcomes: new Map([[req.key.id, { ok: true, row: issue }]]) }
        const oldTeam = this.get('teams', { id: issue.team_id })
        const number = this.takeNumber(req.args.p_team)
        const changes = { team_id: req.args.p_team, number, former_refs: [...(issue.former_refs as string[]), `${String(oldTeam?.key)}-${String(issue.number)}`], updated_at: new Date().toISOString() }
        return { outcomes: new Map([[req.key.id, { ok: true, row: this.change('issues', issue, changes) }]]) }
      }
      case 'notes':
        if (retry && req.rows.some((r) => this.get('inbox', { id: r.id }))) return { outcomes: new Map([['notes', { ok: true }]]) }
        for (const r of req.rows) {
          // check_note: never to yourself
          if (r.recipient_id === this.actor()) continue
          this.t('inbox').set(r.id, { ...r, actor_id: this.actor(), at: new Date().toISOString(), read_at: null, extra: {}, changed_at: this.changedAt() })
        }
        return { outcomes: new Map([['notes', { ok: true }]]) }
    }
  }

  private takeNumber(teamId: unknown): number {
    const team = this.get('teams', { id: teamId })!
    const n = Number(team.last_number) + 1 + this.offset
    team.last_number = n
    return n
  }

  private insert(table: LiveTable, rows: Loose[], retry: boolean, what: What): Answer {
    const out = new Map<string, Outcome>()
    // the whole request fails or lands together, as one statement
    for (const row of rows) {
      const there = this.get(table, row)
      if (there && !ADD_UNLESS_THERE.has(table) && table !== 'read_state') {
        if (!retry) return this.refused(what, '23505', `duplicate key value violates unique constraint "${table}_pkey"`)
      }
      if (table === 'labels' && this.rows('labels').some((l) => l.id !== row.id && String(l.name).toLowerCase() === String(row.name).toLowerCase())) {
        return this.refused(what, '23505', 'duplicate key value violates unique constraint "labels_name"')
      }
      if (table === 'teams' && this.rows('teams').some((t) => t.id !== row.id && t.key === row.key)) {
        return this.refused(what, '23505', 'duplicate key value violates unique constraint "teams_workspace_id_key_key"')
      }
      const parent = table === 'issues' ? ['teams', row.team_id] : ['issue_labels', 'issue_followers', 'comments'].includes(table) ? ['issues', row.issue_id] : null
      if (parent && !this.get(parent[0] as LiveTable, { id: parent[1] })) return { problem: classify({ code: '23503', message: 'insert or update violates foreign key constraint' }, 409, what) }
    }
    for (const row of rows) {
      const ks = keyString(table, row)
      const there = this.get(table, row)
      if (there && table === 'issue_followers' && there.following !== row.following) {
        out.set(ks, { ok: true, row: this.change(table, there, { following: row.following }) })
        continue
      }
      if (there && table !== 'read_state') {
        out.set(ks, { ok: true, row: there })
        continue
      }
      const full = { ...this.filled(table, row), changed_at: this.changedAt() }
      this.t(table).set(ks, full)
      this.say(table, there ? 'UPDATE' : 'INSERT', full)
      out.set(ks, { ok: true, row: full })
    }
    return { outcomes: out }
  }

  /** what the database fills in on a new row */
  private filled(table: LiveTable, row: Loose): Loose {
    const at = new Date().toISOString()
    const me = this.actor()
    switch (table) {
      case 'issues':
        return {
          description: '', status: 'todo', priority: 0, assignee_id: null, project_id: null, parent_id: null, due_date: null, estimate: null,
          duplicate_of: null, former_refs: [], linear_id: null, extra: {}, ...row,
          number: this.takeNumber(row.team_id), created_by: me, created_at: at, updated_at: at,
          completed_at: row.status === 'done' ? at : null, archived_at: null, archived_by: null,
        }
      case 'comments':
        return { linear_id: null, extra: {}, ...row, author_id: me, created_at: at, edited_at: null }
      case 'views':
        return { description: '', emoji: '', filters: {}, linear_id: null, extra: {}, ...row, owner_id: me, created_at: at }
      case 'teams':
        return { emoji: '', last_number: 0, auto_archive: 6, linear_id: null, extra: {}, ...row, created_at: at }
      case 'labels':
        return { linear_id: null, extra: {}, ...row }
      case 'projects':
        return { emoji: '', description: '', status: 'planned', lead_id: null, target_date: null, linear_id: null, extra: {}, ...row, created_at: at }
      case 'read_state':
        return { extra: {}, ...row }
      default:
        return row
    }
  }

  /** changes a row as the triggers do, and tells teammates the columns that changed */
  private change(table: LiveTable, row: Loose, fields: Loose): Loose {
    const at = new Date().toISOString()
    const next: Loose = { ...row, ...fields }
    if (table === 'issues') {
      const seen = ['title', 'description', 'status', 'priority', 'assignee_id', 'project_id', 'parent_id', 'due_date', 'estimate', 'sort_order', 'duplicate_of', 'team_id']
      if (seen.some((k) => k in fields && fields[k] !== row[k]) || (row.archived_at && 'archived_at' in fields && fields.archived_at === null)) next.updated_at = at
      if ('status' in fields && fields.status !== row.status) next.completed_at = fields.status === 'done' ? at : null
      if ('archived_at' in fields) {
        if (!row.archived_at && fields.archived_at) Object.assign(next, { archived_at: at, archived_by: this.actor() })
        else if (fields.archived_at === null) next.archived_by = null
        else next.archived_at = row.archived_at
      }
    }
    if (table === 'comments' && 'body' in fields && fields.body !== row.body) next.edited_at = at
    next.changed_at = this.changedAt()
    this.t(table).set(keyString(table, next), next)
    const msg: Loose = Object.fromEntries(Object.entries(next).filter(([k, v]) => k !== 'changed_at' && JSON.stringify(row[k]) !== JSON.stringify(v)))
    for (const k of [...KEYS[table], 'changed_at']) msg[k] = next[k]
    this.say(table, 'UPDATE', msg)
    return next
  }

  private update(table: LiveTable, key: Loose, fields: Loose, what: What): Outcome {
    const row = this.get(table, key)
    if (!row) return { ok: false, why: 'gone', message: goneMessage(what) }
    // the rules: only the author edits a comment, only admins rename the workspace
    const refused = (table === 'comments' && row.author_id !== this.actor()) || (table === 'workspaces' && !['owner', 'admin'].includes(this.role() ?? ''))
    if (refused) return { ok: false, why: 'refused', message: refusedMessage(what) }
    return { ok: true, row: this.change(table, row, fields) }
  }

  private remove(table: LiveTable, key: Loose, what: What): Outcome {
    const row = this.get(table, key)
    if (!row) return { ok: true }
    const refused = (table === 'comments' && row.author_id !== this.actor()) || (table === 'teams' && !['owner', 'admin'].includes(this.role() ?? ''))
    if (refused) return { ok: false, why: 'refused', message: refusedMessage(what) }
    this.drop(table, row)
    return { ok: true, row: { ...Object.fromEntries(KEYS[table].map((k) => [k, row[k]])), changed_at: row.changed_at } }
  }

  /** deletes a row and what goes with it (the foreign keys' cascades and set-nulls) */
  private drop(table: LiveTable, row: Loose) {
    this.t(table).delete(keyString(table, row))
    this.say(table, 'DELETE', Object.fromEntries(KEYS[table].map((k) => [k, row[k]])))
    const id = row.id
    const each = (t: LiveTable, match: (r: Loose) => boolean) => {
      for (const r of this.rows(t)) if (match(r)) this.drop(t, r)
    }
    const nulls = (t: LiveTable, col: string) => {
      for (const r of this.rows(t)) if (r[col] === id) this.change(t, r, { [col]: null })
    }
    if (table === 'issues') {
      for (const t of ['issue_labels', 'issue_followers', 'comments', 'inbox'] as const) each(t, (r) => r.issue_id === id)
      nulls('issues', 'parent_id')
      nulls('issues', 'duplicate_of')
    } else if (table === 'teams') {
      for (const t of ['issues', 'views', 'team_members', 'project_teams'] as const) each(t, (r) => r.team_id === id)
    } else if (table === 'projects') {
      each('project_teams', (r) => r.project_id === id)
      nulls('issues', 'project_id')
    } else if (table === 'labels') {
      each('issue_labels', (r) => r.label_id === id)
    } else if (table === 'comments') {
      each('inbox', (r) => r.comment_id === id)
    }
  }
}

// ---------- the open workspace ----------

const slice = (s: DataState): StoreSlice => ({
  workspace: s.workspace,
  me: s.me,
  people: s.people,
  members: s.members,
  labels: s.labels,
  teams: s.teams,
  issues: s.issues,
  archive: s.archive,
  projects: s.projects,
  views: s.views,
  comments: s.comments,
  inbox: s.inbox,
  readState: s.readState,
})

/** like LiveWorkspace: applyRows into the store */
export class FakeTarget implements WriteTarget {
  readonly workspaceId = WS
  readonly registry: Registry
  live: LiveState = emptyLive()
  constructor(registry: Registry) {
    this.registry = registry
  }
  get meId(): string {
    return this.registry.profileId(useData.getState().me?.login ?? '') ?? ''
  }
  apply(inputs: Incoming[]) {
    if (!inputs.length) return
    const r = applyRows(this.live, slice(useData.getState()), inputs, { workspaceId: WS, meId: this.meId, registry: this.registry })
    this.live = r.state
    if (Object.keys(r.patch).length) useData.setState(r.patch)
  }
  server() {
    return this.live.server
  }
}

export interface Seed {
  me: string
  people?: string[]
  /** login → role (everyone else is a member; `me` is the owner unless said otherwise) */
  roles?: Record<string, 'owner' | 'admin' | 'member'>
  teams?: (Pick<Team, 'key' | 'name'> & Partial<Team>)[]
  labels?: Label[]
}

/** a page that only counts how often closing the tab would ask */
export class FakePage implements Page {
  guards: boolean[] = []
  retry: (() => void) | undefined
  guard(on: boolean) {
    this.guards.push(on)
  }
  watch(retry: () => void) {
    this.retry = retry
    return () => (this.retry = undefined)
  }
}

export interface World {
  db: FakeDb
  target: FakeTarget
  clock: FakeClock
  page: FakePage
  told: string[]
  registry: Registry
  /** releases everything held and lets it all finish */
  settle(): Promise<void>
  /** delivers what teammates would hear (the echo of your own changes too) */
  echo(): void
  state(): DataState
}

/** a workspace with these people, teams and labels, open, with the writer attached to it */
export function seed(o: Seed): World {
  stopWrites()
  const registry = new Registry()
  const logins = [...new Set([o.me, ...(o.people ?? [])])]
  const db = new FakeDb(() => registry.profileId(useData.getState().me?.login ?? '') ?? '')
  for (const l of logins) registry.learnProfile(profileIdOf(l), l)
  const teams = (o.teams ?? []).map((t): Team => ({ emoji: '', members: [], createdAt: '2026-01-01T00:00:00.000Z', lastNumber: 0, autoArchive: 6, ...t }))
  for (const t of teams) registry.learnTeam(teamIdOf(t.key), t.key)

  const at = '2026-01-01T00:00:00.000Z'
  db.put('workspaces', { id: WS, name: 'Acme', created_by: profileIdOf(o.me), created_at: at, extra: {} })
  for (const l of logins) {
    db.put('profiles', { ...personToProfile({ ...person(l), id: profileIdOf(l) } as Person, WS, registry), user_id: `u-${l}`, created_at: at })
    db.put('workspace_members', { workspace_id: WS, profile_id: profileIdOf(l), role: o.roles?.[l] ?? (l === o.me ? 'owner' : 'member'), joined_at: at, removed_at: null })
  }
  for (const t of teams) {
    const rows = teamToRows({ ...t, id: teamIdOf(t.key) } as Team, WS, registry)
    db.put('teams', { ...rows.teams, last_number: t.lastNumber ?? 0 })
    for (const m of rows.team_members) db.put('team_members', m)
  }
  for (const l of o.labels ?? []) db.put('labels', labelToRow(l, WS))

  useData.setState({ ...EMPTY, me: person(o.me) })
  const target = new FakeTarget(registry)
  const fetched: Incoming[] = [...db.tables.keys()].map((table) => ({ from: 'fetch', table, rows: db.rows(table) }))
  target.apply(fetched)
  const clock = new FakeClock()
  const page = new FakePage()
  const told: string[] = []
  startWrites({ transport: db, tell: (m) => told.push(m), onStatus: () => {}, clock, page, random: () => 0.5 })
  attach(target)
  return {
    db,
    target,
    clock,
    page,
    told,
    registry,
    async settle() {
      db.release()
      await drain()
    },
    echo() {
      target.apply(db.messages().map((message): Incoming => ({ from: 'message', message })))
    },
    state: () => useData.getState(),
  }
}
