/**
 * A pretend database for the writer's tests (bun test, no network). The writer talks to it through the real
 * transport (src/backend/writes/send.ts): a fake database client answers each request the way Postgres and the rules
 * in supabase/migrations do where the app relies on it:
 * - a statement lands or fails as a whole (a duplicate key fails all its rows);
 * - only the columns people may write are taken (rls.sql grants), else "permission denied";
 * - foreign keys (the hand-written list below, as in tables.sql), unique label names and team keys;
 * - what the triggers fill in: numbers, authors, times, archived_at, edited_at, and check_note (no notes to yourself,
 *   to people outside the workspace, or the same note again within ten minutes) and check_people;
 * - the rules: only the author edits a comment, only admins delete a team or rename the workspace, your inbox is
 *   yours (an insert that asks other people's notes back fails, E54), and refusals of updates and deletes come back
 *   empty;
 * - cascades and set-nulls when a row goes, and the realtime messages a teammate would hear.
 * On top, the transport can be held, made to fail, or lose an answer.
 */
import { keyString } from '@/backend/changes'
import type { Db } from '@/backend/client'
import { KEYS, type LiveTable, type Message } from '@/backend/tables'
import type { Clock } from '@/backend/writes'
import { classify, MESSAGES } from '@/backend/writes/problems'
import { postgrest, whatOf, type Answer, type Request, type Transport } from '@/backend/writes/send'

type Loose = Record<string, unknown>

export const WS = 'ws-1'
export const profileIdOf = (login: string) => `p-${login}`
export const teamIdOf = (key: string) => `t-${key.toLowerCase()}`

// ---------- time ----------

/** timers that run only when the test says time has passed */
export class FakeClock implements Clock {
  t = Date.parse('2026-10-19T12:00:00.000Z')
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
export async function drain(rounds = 4) {
  for (let n = 0; n < rounds; n++) await new Promise((r) => setTimeout(r, 0))
}

// ---------- what the migrations say ----------

/** the columns a signed-in person may write (20261019000005_rls.sql) */
const GRANTS: Partial<Record<LiveTable, { insert: string[]; update: string[] }>> = {
  workspaces: { insert: [], update: ['name', 'extra'] },
  profiles: { insert: [], update: ['name', 'avatar_url', 'name_set_here', 'extra'] },
  workspace_members: { insert: [], update: ['role', 'removed_at'] },
  teams: { insert: ['id', 'workspace_id', 'key', 'name', 'emoji', 'auto_archive', 'extra'], update: ['name', 'emoji', 'auto_archive', 'extra'] },
  team_members: { insert: ['workspace_id', 'team_id', 'profile_id'], update: [] },
  labels: { insert: ['id', 'workspace_id', 'name', 'color', 'extra'], update: ['name', 'color', 'extra'] },
  projects: {
    insert: ['id', 'workspace_id', 'name', 'emoji', 'description', 'status', 'lead_id', 'target_date', 'extra'],
    update: ['name', 'emoji', 'description', 'status', 'lead_id', 'target_date', 'extra'],
  },
  project_teams: { insert: ['workspace_id', 'project_id', 'team_id'], update: [] },
  issues: {
    insert: ['id', 'workspace_id', 'team_id', 'title', 'description', 'status', 'priority', 'assignee_id', 'project_id', 'parent_id', 'due_date', 'estimate', 'sort_order', 'duplicate_of', 'extra'],
    update: ['title', 'description', 'status', 'priority', 'assignee_id', 'project_id', 'parent_id', 'due_date', 'estimate', 'sort_order', 'duplicate_of', 'archived_at', 'extra'],
  },
  issue_labels: { insert: ['workspace_id', 'issue_id', 'label_id'], update: [] },
  issue_followers: { insert: ['workspace_id', 'issue_id', 'profile_id', 'following'], update: ['following'] },
  comments: { insert: ['id', 'workspace_id', 'issue_id', 'body', 'extra'], update: ['body', 'extra'] },
  views: { insert: ['id', 'workspace_id', 'team_id', 'name', 'emoji', 'description', 'filters', 'display', 'extra'], update: ['name', 'emoji', 'description', 'filters', 'display', 'extra'] },
  inbox: { insert: ['id', 'workspace_id', 'recipient_id', 'type', 'issue_id', 'comment_id', 'status', 'extra'], update: ['read_at'] },
  read_state: { insert: ['profile_id', 'workspace_id', 'read_until', 'extra'], update: ['profile_id', 'workspace_id', 'read_until', 'extra'] },
}

/** foreign keys (20261019000001_tables.sql): [column, the table it points at] */
const FKS: Partial<Record<LiveTable, [string, LiveTable][]>> = {
  team_members: [['team_id', 'teams'], ['profile_id', 'profiles']],
  projects: [['lead_id', 'profiles']],
  project_teams: [['project_id', 'projects'], ['team_id', 'teams']],
  issues: [['team_id', 'teams'], ['project_id', 'projects'], ['parent_id', 'issues'], ['duplicate_of', 'issues'], ['assignee_id', 'profiles']],
  issue_labels: [['issue_id', 'issues'], ['label_id', 'labels']],
  issue_followers: [['issue_id', 'issues'], ['profile_id', 'profiles']],
  comments: [['issue_id', 'issues']],
  views: [['team_id', 'teams']],
  inbox: [['issue_id', 'issues'], ['comment_id', 'comments'], ['recipient_id', 'profiles']],
}

/** check_people: the person a row names must be in the workspace */
const PEOPLE: Partial<Record<LiveTable, string>> = { issues: 'assignee_id', team_members: 'profile_id', issue_followers: 'profile_id', projects: 'lead_id' }

interface Result {
  data: unknown
  error: { code: string; message: string } | null
  status: number
}
const failed = (code: string, message: string, status = 409): Result => ({ data: null, error: { code, message }, status })

/** a request being built, as the database client builds it; answered when awaited */
class Query implements PromiseLike<Result> {
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' | 'rpc' | undefined
  rows: Loose[] = []
  opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  fields: Loose = {}
  filters: { col: string; values: unknown[] }[] = []
  /** the rows asked for back */
  returning = false
  fn = ''
  args: Loose = {}
  private db: FakeDb
  readonly table: LiveTable
  constructor(db: FakeDb, table: LiveTable) {
    this.db = db
    this.table = table
  }
  select() {
    if (this.op) this.returning = true
    else this.op = 'select'
    return this
  }
  insert(rows: Loose[]) {
    Object.assign(this, { op: 'insert', rows })
    return this
  }
  upsert(rows: Loose[], opts: Query['opts']) {
    Object.assign(this, { op: 'upsert', rows, opts })
    return this
  }
  update(fields: Loose) {
    Object.assign(this, { op: 'update', fields })
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(col: string, value: unknown) {
    this.filters.push({ col, values: [value] })
    return this
  }
  in(col: string, values: unknown[]) {
    this.filters.push({ col, values })
    return this
  }
  abortSignal() {
    return this
  }
  then<A = Result, B = never>(ok?: ((r: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.db.execute(this))
      .then(ok, bad)
  }
}

type Failure = 'network' | 'auth' | 'bug' | '42501' | '23505:labels_name' | 'lostResponse'

const T0 = Date.parse('2026-10-19T12:00:00.000Z')

export class FakeDb {
  /** table → keyString → row */
  readonly tables = new Map<LiveTable, Map<string, Loose>>()
  /** every request the writer sent, in order */
  readonly log: Request[] = []
  readonly transport: Transport
  private real: Transport
  private pendingMessages: Message[] = []
  private holding: 'requests' | 'answers' | null = null
  private held: (() => void)[] = []
  private failures: Failure[] = []
  private offset = 0
  private stamp = 0
  private inFlight = 0

  /** who is signed in */
  readonly actor: () => string
  readonly clock: FakeClock

  constructor(actor: () => string, clock: FakeClock) {
    this.actor = actor
    this.clock = clock
    this.real = postgrest(this.client())
    this.transport = { run: (req, o) => this.run(req, o) }
  }

  /** a database client for postgrest() */
  client(): Db {
    return { from: (t: LiveTable) => new Query(this, t), rpc: (fn: string, args: Loose) => Object.assign(new Query(this, 'issues'), { op: 'rpc', fn, args }) } as unknown as Db
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
  /** a row that was there before the test */
  put(table: LiveTable, row: Loose) {
    this.t(table).set(keyString(table, row), { changed_at: this.changedAt(), ...row })
  }

  // ---------- modes ----------

  /** requests wait until release(); with 'answers', they land but their answers wait */
  hold(what: 'requests' | 'answers' = 'requests') {
    this.holding = what
  }
  /** lets `n` waiting requests (all by default) through, and stops holding when all are */
  release(n = Infinity) {
    const go = this.held.splice(0, n)
    for (const g of go) g()
    if (n === Infinity) this.holding = null
  }
  /** requests still waiting or on their way */
  busy(): number {
    return this.inFlight
  }
  failNext(kind: Failure, times = 1) {
    for (let n = 0; n < times; n++) this.failures.push(kind)
  }
  /** numbers come out `k` higher than the app guesses (a teammate was quicker) */
  numberOffset(k: number) {
    this.offset = k
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
  /** the next changed_at, later than any before */
  changedAt(): string {
    const us = ++this.stamp
    return `${new Date(T0 + Math.floor(us / 1000)).toISOString().slice(0, 23)}${String(us % 1000).padStart(3, '0')}+00:00`
  }

  private async run(req: Request, o: { retry: boolean }): Promise<Answer> {
    this.log.push(req)
    this.inFlight++
    try {
      if (this.holding === 'requests') await new Promise<void>((r) => this.held.push(r))
      const fail = this.failures.shift()
      const what = whatOf(req)
      if (fail === 'network') return { problem: { kind: 'network', message: '' } }
      if (fail === 'auth') return { problem: { kind: 'auth', message: '' } }
      if (fail === 'bug') return { problem: { kind: 'bug', message: MESSAGES.bug } }
      if (fail === '42501') return { problem: classify({ code: '42501', message: `new row violates row-level security policy for table "${what.table}"` }, 403, what) }
      if (fail === '23505:labels_name') return { problem: classify({ code: '23505', message: 'duplicate key value violates unique constraint "labels_name"' }, 409, what) }
      const answer = await this.real.run(req, o)
      if (this.holding === 'answers') await new Promise<void>((r) => this.held.push(r))
      if (fail === 'lostResponse') return { problem: { kind: 'network', message: '' } }
      return answer
    } finally {
      this.inFlight--
    }
  }

  // ---------- the database ----------

  private now = () => new Date(this.clock.now()).toISOString()
  private role = () => String(this.get('workspace_members', { workspace_id: WS, profile_id: this.actor() })?.role ?? '')
  private admin = () => ['owner', 'admin'].includes(this.role())
  private member = (id: unknown) => !!this.get('workspace_members', { workspace_id: WS, profile_id: id })

  private matches(q: Query, row: Loose): boolean {
    return q.filters.every((f) => f.values.includes(row[f.col]))
  }

  /** what the select rule shows you */
  private visible(table: LiveTable, row: Loose): boolean {
    if (table === 'inbox') return row.recipient_id === this.actor()
    if (table === 'read_state') return row.profile_id === this.actor()
    return true
  }

  /** what the update and delete rules let you change */
  private mine(table: LiveTable, op: 'update' | 'delete', row: Loose): boolean {
    if (table === 'comments') return row.author_id === this.actor()
    if (table === 'inbox') return row.recipient_id === this.actor()
    if (table === 'read_state') return row.profile_id === this.actor()
    if (table === 'profiles') return row.id === this.actor()
    if (table === 'teams' && op === 'delete') return this.admin()
    if (table === 'workspaces') return op === 'update' ? this.admin() : this.role() === 'owner'
    return true
  }

  /** the foreign keys and check_people, for these columns of a row; a problem, or nothing */
  private refs(table: LiveTable, row: Loose, cols: string[], adding: Map<LiveTable, Set<string>>): Result | null {
    for (const [col, to] of FKS[table] ?? []) {
      const v = row[col]
      if (!cols.includes(col) || v == null) continue
      if (!this.get(to, { id: v }) && !adding.get(to)?.has(String(v))) {
        if (table === 'issues' && col === 'team_id') return failed('23503', 'There is no such team.')
        return failed('23503', `insert or update on table "${table}" violates foreign key constraint "${table}_workspace_id_${col}_fkey"`)
      }
    }
    const person = PEOPLE[table]
    if (person && cols.includes(person) && row[person] != null && !this.member(row[person])) return failed('42501', "That person isn't in this workspace.", 403)
    return null
  }

  execute(q: Query): Result {
    const t = q.table
    switch (q.op) {
      case 'select':
        return { data: this.rows(t).filter((r) => this.matches(q, r) && this.visible(t, r)), error: null, status: 200 }
      case 'insert':
      case 'upsert':
        return this.insert(q)
      case 'update':
        return this.update(q)
      case 'delete':
        return this.remove(q)
      case 'rpc':
        return this.call(q)
      default:
        return failed('PGRST000', 'nothing to do', 400)
    }
  }

  private insert(q: Query): Result {
    const t = q.table
    const merge = q.op === 'upsert' && !q.opts.ignoreDuplicates
    const allowed = new Set([...(GRANTS[t]?.insert ?? []), ...(merge ? (GRANTS[t]?.update ?? []) : [])])
    const adding = new Map<LiveTable, Set<string>>()
    const plan: { row: Loose; there?: Loose }[] = []
    for (const row of q.rows) {
      if (Object.keys(row).some((c) => !allowed.has(c))) return failed('42501', `permission denied for table ${t}`, 403)
      if (t === 'read_state' && row.profile_id !== this.actor()) return failed('42501', 'new row violates row-level security policy for table "read_state"', 403)
      const ks = keyString(t, row)
      const there = this.get(t, row)
      const twice = plan.some((p) => keyString(t, p.row) === ks)
      if ((there || twice) && q.op === 'insert') return failed('23505', `duplicate key value violates unique constraint "${t}_pkey"`)
      if (there && q.opts.ignoreDuplicates) continue
      if (t === 'labels' && [...this.rows(t), ...plan.map((p) => p.row)].some((l) => l.id !== row.id && String(l.name).toLowerCase() === String(row.name).toLowerCase())) {
        return failed('23505', 'duplicate key value violates unique constraint "labels_name"')
      }
      if (t === 'teams' && [...this.rows(t), ...plan.map((p) => p.row)].some((x) => x.id !== row.id && x.key === row.key)) {
        return failed('23505', 'duplicate key value violates unique constraint "teams_workspace_id_key_key"')
      }
      const bad = this.refs(t, row, Object.keys(row), adding)
      if (bad) return bad
      if (row.id !== undefined) adding.set(t, new Set([...(adding.get(t) ?? []), String(row.id)]))
      plan.push({ row, there })
    }
    // every row passed: the statement lands
    const back: Loose[] = []
    for (const { row, there } of plan) {
      if (t === 'inbox' && !this.noteGoes(row)) continue
      const full = { ...(there ?? {}), ...this.filled(t, row), changed_at: this.changedAt() }
      this.t(t).set(keyString(t, full), full)
      this.say(t, there ? 'UPDATE' : 'INSERT', full)
      back.push(full)
    }
    if (q.returning && back.some((r) => !this.visible(t, r))) {
      // the rows asked back must be ones you may read (E54); in Postgres the whole insert fails
      for (const r of back) this.t(t).delete(keyString(t, r))
      return failed('42501', `new row violates row-level security policy for table "${t}"`, 403)
    }
    return { data: q.returning ? back : null, error: null, status: 201 }
  }

  /** check_note: not to yourself, only to members, and the same note not again within ten minutes */
  private noteGoes(n: Loose): boolean {
    const me = this.actor()
    if (n.recipient_id === me || !this.member(n.recipient_id)) return false
    if (n.type === 'commented' || n.comment_id != null) return true
    const since = new Date(this.clock.now() - 10 * 60_000).toISOString()
    return !this.rows('inbox').some(
      (x) => x.recipient_id === n.recipient_id && x.actor_id === me && x.issue_id === n.issue_id && x.type === n.type && (x.status ?? null) === (n.status ?? null) && x.comment_id == null && String(x.at) > since,
    )
  }

  private takeNumber(teamId: unknown): number {
    const team = this.get('teams', { id: teamId })!
    const n = Number(team.last_number) + 1 + this.offset
    team.last_number = n
    return n
  }

  /** what the database fills in on a new row */
  private filled(table: LiveTable, row: Loose): Loose {
    const at = this.now()
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
      case 'inbox':
        return { comment_id: null, status: null, extra: {}, ...row, actor_id: me, at, read_at: null }
      case 'read_state':
        return { extra: {}, ...row }
      default:
        return row
    }
  }

  /** changes a row as the triggers do, and tells teammates the columns that changed */
  private change(table: LiveTable, row: Loose, fields: Loose): Loose {
    const at = this.now()
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

  private update(q: Query): Result {
    const t = q.table
    const cols = Object.keys(q.fields)
    if (cols.some((c) => !(GRANTS[t]?.update ?? []).includes(c))) return failed('42501', `permission denied for table ${t}`, 403)
    const rows = this.rows(t).filter((r) => this.matches(q, r) && this.visible(t, r) && this.mine(t, 'update', r))
    for (const r of rows) {
      const bad = this.refs(t, { ...r, ...q.fields }, cols.filter((c) => q.fields[c] !== r[c]), new Map())
      if (bad) return bad
    }
    const back = rows.map((r) => this.change(t, r, q.fields))
    return { data: q.returning ? back : null, error: null, status: 200 }
  }

  private remove(q: Query): Result {
    const t = q.table
    const rows = this.rows(t).filter((r) => this.matches(q, r) && this.visible(t, r) && this.mine(t, 'delete', r))
    for (const r of rows) this.drop(t, r)
    return { data: q.returning ? rows : null, error: null, status: 200 }
  }

  private call(q: Query): Result {
    if (q.fn !== 'move_issue_to_team') return failed('PGRST202', `Could not find the function ${q.fn}`, 404)
    const { p_issue, p_team } = q.args
    const issue = this.get('issues', { id: p_issue })
    if (!issue) return failed('P0002', 'There is no such issue.', 500)
    if (issue.team_id === p_team) return { data: issue, error: null, status: 200 }
    const old = this.get('teams', { id: issue.team_id })
    const number = this.takeNumber(p_team)
    const fields = { team_id: p_team, number, former_refs: [...(issue.former_refs as string[]), `${String(old?.key)}-${String(issue.number)}`] }
    return { data: this.change('issues', issue, fields), error: null, status: 200 }
  }

  private say(table: LiveTable, op: 'INSERT' | 'UPDATE' | 'DELETE', row: Loose) {
    this.pendingMessages.push({ table, op, row })
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
