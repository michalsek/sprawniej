/**
 * Rows from the database to the store. Everything that comes in goes through applyRows: first loads and fetched rows,
 * realtime messages, deletions found on catch-up, and your own changes (shown at once, then confirmed or rolled back).
 *
 * It keeps a copy of what the database has (`server`, newer changed_at wins, column by column for updates), your
 * changes on top of it (`local`), and works out the store parts that changed. Pure: it never changes `state` or `data`,
 * and an unchanged thing keeps its object, so screens only redraw what changed. Its one side effect is teaching the
 * registry new ids, which only ever grows.
 */
import type { DataState } from '@/data/store'
import type { ArchivedIssue, Comment, InboxItem, ReadState } from '@/model/schema'
import { keyOf, keyString, parseKey, type AnyChange } from './changes'
import type { Registry } from './registry'
import * as rows from './rows'
import { compareStamp } from './rows'
import { isLiveTable, type DeletionRow, type LiveTable, type Message, type Row } from './tables'

export type StoreSlice = Pick<
  DataState,
  'workspace' | 'me' | 'people' | 'members' | 'labels' | 'teams' | 'issues' | 'archive' | 'projects' | 'views' | 'comments' | 'inbox' | 'readState'
>
type Rec<V> = Readonly<Record<string, V>>
type Loose = Record<string, unknown>

/** what the database has (newer only) */
export interface Mirror {
  workspaces: Rec<Row<'workspaces'>>
  profiles: Rec<Row<'profiles'>>
  /** by keyString */
  workspace_members: Rec<Row<'workspace_members'>>
  teams: Rec<Row<'teams'>>
  /** team_id → profile_id → row */
  team_members: Rec<Rec<Row<'team_members'>>>
  labels: Rec<Row<'labels'>>
  projects: Rec<Row<'projects'>>
  /** project_id → team_id → row */
  project_teams: Rec<Rec<Row<'project_teams'>>>
  issues: Rec<Row<'issues'>>
  /** issue_id → label_id → row */
  issue_labels: Rec<Rec<Row<'issue_labels'>>>
  /** issue_id → profile_id → row */
  issue_followers: Rec<Rec<Row<'issue_followers'>>>
  /** issue_id → comment id → row */
  comments: Rec<Rec<Row<'comments'>>>
  /** comment id → issue_id (an update or delete carries only the id) */
  commentIssue: Rec<string>
  views: Rec<Row<'views'>>
  inbox: Rec<Row<'inbox'>>
  /** by keyString */
  read_state: Rec<Row<'read_state'>>
}

export interface LiveState {
  server: Mirror
  /** your own changes not confirmed yet: `${table}:${keyString}` → columns (on top of the server row) */
  local: Rec<Record<string, unknown>>
  /** your own deletes not confirmed yet */
  localGone: Rec<true>
  /** deleted rows: `${table}:${keyString}` → the raw time they went ('' when unknown); a row not newer is ignored */
  gone: Rec<string>
  /** rows that came without description or body (too big to send), so a full row with the same time still applies */
  partial: Rec<true>
  /** a profile or team id we don't know yet → things to work out again once it arrives ('issue:ID', 'view:ID'…) */
  waiting: Rec<readonly string[]>
  /** the highest changed_at or deleted_at seen from the database, raw (where catching up starts) */
  mark: string | null
}

export const emptyLive = (): LiveState => ({
  server: {
    workspaces: {},
    profiles: {},
    workspace_members: {},
    teams: {},
    team_members: {},
    labels: {},
    projects: {},
    project_teams: {},
    issues: {},
    issue_labels: {},
    issue_followers: {},
    comments: {},
    commentIssue: {},
    views: {},
    inbox: {},
    read_state: {},
  },
  local: {},
  localGone: {},
  gone: {},
  partial: {},
  waiting: {},
  mark: null,
})

export type Incoming =
  /** select results: whole rows */
  | { from: 'fetch'; table: LiveTable; rows: readonly Record<string, unknown>[] }
  | { from: 'message'; message: Message }
  | { from: 'deletions'; rows: readonly DeletionRow[] }
  /** an action's change, shown at once */
  | { from: 'local'; change: AnyChange }
  /**
   * the write came back. With `row` it worked: the row as the database has it now (for a delete, the row it removed).
   * Without, it failed and the change is undone.
   */
  | { from: 'settled'; change: AnyChange; row?: Record<string, unknown> }

export interface ApplyContext {
  workspaceId: string
  meId: string | null
  registry: Registry
}

export interface ApplyResult {
  state: LiveState
  /** only the store parts whose object changed; {} when nothing visible changed */
  patch: Partial<StoreSlice>
  /** rows to fetch by key, each once: an update for a row we don't have, a partial row, a missing team or person */
  fetch: { table: LiveTable; key: Record<string, string> }[]
  /** someone imported or linked people: read everything changed since `mark` */
  catchUp: boolean
  /** the open workspace was deleted */
  workspaceGone: boolean
}

/** tables kept in groups by their parent: [the parent column, the column within the group] */
const GROUPED = {
  team_members: ['team_id', 'profile_id'],
  project_teams: ['project_id', 'team_id'],
  issue_labels: ['issue_id', 'label_id'],
  issue_followers: ['issue_id', 'profile_id'],
  comments: ['issue_id', 'id'],
} as const
type Grouped = keyof typeof GROUPED
const isGrouped = (t: LiveTable): t is Grouped => t in GROUPED

/** a store part made from rows, with what it holds */
type Kind = 'person' | 'member' | 'team' | 'label' | 'project' | 'issue' | 'view' | 'inbox'
type RecField = 'people' | 'members' | 'labels' | 'teams' | 'issues' | 'archive' | 'projects' | 'views' | 'comments'

/** the same data, whatever the key order */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, n) => equal(x, b[n]))
  }
  const x = a as Loose
  const y = b as Loose
  const kx = Object.keys(x).filter((k) => x[k] !== undefined)
  const ky = Object.keys(y).filter((k) => y[k] !== undefined)
  return kx.length === ky.length && kx.every((k) => equal(x[k], y[k]))
}

const localKey = (table: LiveTable, key: Readonly<Record<string, unknown>>) => `${table}:${keyString(table, key)}`

/** the columns of a row your own changes are still saving (for the save chip) */
export function pendingFields(state: LiveState, table: LiveTable, key: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(state.local[localKey(table, key)] ?? {})
}

/** your own delete of this row is still saving */
export const pendingDelete = (state: LiveState, table: LiveTable, key: Readonly<Record<string, unknown>>): boolean =>
  !!state.localGone[localKey(table, key)]

const byTime = (a: Comment, b: Comment) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const newestFirst = (a: InboxItem, b: InboxItem) => (a.at > b.at ? -1 : a.at < b.at ? 1 : a.id > b.id ? -1 : a.id < b.id ? 1 : 0)
const NO_READ_STATE: ReadState = { readUntil: null, read: [] }

export function applyRows(state: LiveState, data: StoreSlice, inputs: readonly Incoming[], ctx: ApplyContext): ApplyResult {
  // copy on first write: each record touched in this call is copied once
  const own = new WeakSet<object>()
  const mine = <T extends object>(o: T): T => {
    if (own.has(o)) return o
    const c = { ...o }
    own.add(c)
    return c
  }
  const live: LiveState = mine(state)
  const draft = <K extends 'local' | 'localGone' | 'gone' | 'partial' | 'waiting'>(f: K) =>
    (live[f] = mine(live[f])) as Record<string, LiveState[K][string]>
  const server = () => (live.server = mine(live.server)) as unknown as Record<string, Record<string, unknown>>
  const serverTable = (t: string) => {
    const s = server()
    const c = mine(s[t] as Loose)
    s[t] = c
    return c
  }
  const read = () => live.server as unknown as Record<string, Rec<unknown>>

  const dirty: Record<Kind, Set<string>> = {
    person: new Set(),
    member: new Set(),
    team: new Set(),
    label: new Set(),
    project: new Set(),
    issue: new Set(),
    view: new Set(),
    inbox: new Set(),
  }
  let readStateDirty = false
  let workspaceDirty = false
  let catchUp = false
  let workspaceGone = false
  const wanted = new Map<string, { table: LiveTable; key: Record<string, string> }>()
  const want = (table: LiveTable, key: Record<string, string>) => wanted.set(localKey(table, key), { table, key })

  // ---------- the copy of the database ----------

  const parentOf = (t: Grouped, key: Loose): string | undefined => {
    const p = key[GROUPED[t][0]]
    if (typeof p === 'string') return p
    return t === 'comments' ? live.server.commentIssue[key.id as string] : undefined
  }

  function stored(t: LiveTable, key: Loose): Loose | undefined {
    if (!isGrouped(t)) return read()[t][keyString(t, key)] as Loose | undefined
    const p = parentOf(t, key)
    return p === undefined ? undefined : (read()[t][p] as Rec<Loose> | undefined)?.[key[GROUPED[t][1]] as string]
  }

  function dropFromGroup(t: Grouped, parent: string, sub: string) {
    const outer = serverTable(t)
    const group = outer[parent] as Rec<unknown> | undefined
    if (!group || !(sub in group)) return
    const g = mine(group as Loose)
    outer[parent] = g
    delete g[sub]
    if (!Object.keys(g).length) delete outer[parent]
  }

  function put(t: LiveTable, row: Loose) {
    if (!isGrouped(t)) {
      serverTable(t)[keyString(t, row)] = row
      return
    }
    const [pc, sc] = GROUPED[t]
    const parent = row[pc] as string
    const sub = row[sc] as string
    if (t === 'comments') {
      const was = live.server.commentIssue[sub]
      if (was !== parent) {
        if (was !== undefined) dropFromGroup(t, was, sub)
        serverTable('commentIssue')[sub] = parent
      }
    }
    const outer = serverTable(t)
    const g = outer[parent] ? mine(outer[parent] as Loose) : mine({} as Loose)
    outer[parent] = g
    g[sub] = row
  }

  function remove(t: LiveTable, key: Loose) {
    if (!isGrouped(t)) {
      delete serverTable(t)[keyString(t, key)]
      return
    }
    const parent = parentOf(t, key)
    if (parent === undefined) return
    const sub = key[GROUPED[t][1]] as string
    dropFromGroup(t, parent, sub)
    if (t === 'comments') delete serverTable('commentIssue')[sub]
  }

  /** a parent went: its join rows and comments go with it (the database removes them too) */
  function dropGroup(t: Grouped, parent: string) {
    const group = read()[t][parent] as Rec<unknown> | undefined
    if (!group) return
    if (t === 'comments') for (const id of Object.keys(group)) delete serverTable('commentIssue')[id]
    delete serverTable(t)[parent]
  }

  // ---------- what changed ----------

  const mark = (kind: Kind, id: unknown) => typeof id === 'string' && dirty[kind].add(id)

  function touch(t: LiveTable, row: Loose) {
    switch (t) {
      case 'workspaces':
        workspaceDirty = true
        break
      case 'profiles':
        mark('person', row.id)
        break
      case 'workspace_members':
        mark('member', row.profile_id)
        break
      case 'teams':
        mark('team', row.id)
        break
      case 'team_members':
        mark('team', row.team_id)
        break
      case 'labels':
        mark('label', row.id)
        break
      case 'projects':
        mark('project', row.id)
        break
      case 'project_teams':
        mark('project', row.project_id)
        break
      case 'issues':
        mark('issue', row.id)
        break
      case 'issue_labels':
      case 'issue_followers':
        mark('issue', row.issue_id)
        break
      case 'comments':
        mark('issue', row.issue_id ?? live.server.commentIssue[row.id as string])
        break
      case 'views':
        mark('view', row.id)
        break
      case 'inbox':
        mark('inbox', row.id)
        break
      case 'read_state':
        readStateDirty = true
        break
    }
  }

  /** an id arrived: what waited for it is worked out again */
  function wake(id: string) {
    const refs = live.waiting[id]
    if (!refs) return
    for (const ref of refs) {
      const at = ref.indexOf(':')
      mark(ref.slice(0, at) as Kind, ref.slice(at + 1))
    }
    delete draft('waiting')[id]
  }

  function learn(t: LiveTable, row: Loose) {
    if (t === 'profiles' && typeof row.id === 'string' && typeof row.login === 'string') {
      ctx.registry.learnProfile(row.id, row.login)
      wake(row.id)
    } else if (t === 'teams' && typeof row.id === 'string' && typeof row.key === 'string') {
      ctx.registry.learnTeam(row.id, row.key)
      wake(row.id)
    }
  }

  function advance(at: unknown) {
    if (typeof at === 'string' && compareStamp(at, live.mark) > 0) live.mark = at
  }

  function setGone(k: string, at: string) {
    const was = live.gone[k]
    if (was === undefined || compareStamp(at, was) > 0) draft('gone')[k] = at
  }

  function setPartial(k: string, on: boolean) {
    if (on) draft('partial')[k] = true
    else if (live.partial[k]) delete draft('partial')[k]
  }

  /** a row a partial message left out keeps the description or body we have */
  function withText(row: Loose, old: Loose | undefined): Loose {
    const { partial, ...clean } = row
    if (partial !== true || !old) return clean
    return { ...('description' in old && { description: old.description }), ...('body' in old && { body: old.body }), ...clean }
  }

  /** a whole row (fetched, inserted, or returned by a write): kept if newer */
  function whole(t: LiveTable, row: Loose) {
    const key = keyOf(t, row)
    if (!key) return
    learn(t, row)
    advance(row.changed_at)
    const k = localKey(t, key)
    const gone = live.gone[k]
    if (gone !== undefined && compareStamp(row.changed_at as string, gone) <= 0) return
    const old = stored(t, key)
    if (old) {
      const c = compareStamp(row.changed_at as string, old.changed_at as string)
      if (c < 0 || (c === 0 && !live.partial[k])) return
    }
    const next = withText(row, old)
    put(t, next)
    setPartial(k, row.partial === true)
    if (row.partial === true) want(t, key)
    touch(t, next)
  }

  /** an UPDATE message: only the changed columns */
  function update(t: LiveTable, row: Loose) {
    const key = keyOf(t, row)
    if (!key) return
    advance(row.changed_at)
    const k = localKey(t, key)
    const old = stored(t, key)
    if (!old) {
      // the whole inbox is loaded, and notes from your other workspaces come on the same channel
      if (t === 'inbox') return
      const gone = live.gone[k]
      if (gone !== undefined && compareStamp(row.changed_at as string, gone) <= 0) return
      // fetched whole: it will be at least as new as this
      want(t, key)
      return
    }
    if (compareStamp(row.changed_at as string, old.changed_at as string) <= 0) return
    const next = { ...old, ...withText(row, undefined) }
    put(t, next)
    setPartial(k, row.partial === true)
    if (row.partial === true) want(t, key)
    touch(t, next)
  }

  function forget(t: LiveTable, key: Loose, old: Loose) {
    touch(t, old)
    remove(t, key)
    setPartial(localKey(t, key), false)
    const id = key.id as string
    if (t === 'issues') {
      dropGroup('issue_labels', id)
      dropGroup('issue_followers', id)
      dropGroup('comments', id)
    } else if (t === 'teams') dropGroup('team_members', id)
    else if (t === 'projects') dropGroup('project_teams', id)
    if (t === 'workspaces' && id === ctx.workspaceId) workspaceGone = true
  }

  /** is this message about the open workspace (and, for read marks, about you)? */
  function ours(t: LiveTable, row: Loose): boolean {
    if (t === 'workspaces') return row.id === ctx.workspaceId
    if ('workspace_id' in row && row.workspace_id !== ctx.workspaceId) return false
    if (t === 'read_state' && row.profile_id !== ctx.meId) return false
    return true
  }

  function message(m: Message) {
    if (m.op === 'catch_up') {
      catchUp = true
      return
    }
    const t = m.table
    if (!isLiveTable(t) || !m.row || typeof m.row !== 'object' || !ours(t, m.row)) return
    if (m.op === 'INSERT') whole(t, m.row)
    else if (m.op === 'UPDATE') update(t, m.row)
    else if (m.op === 'DELETE') {
      const key = keyOf(t, m.row)
      if (!key) return
      if (t === 'workspaces') workspaceGone = true
      const old = stored(t, key)
      if (old) forget(t, key, old)
      setGone(localKey(t, key), (old?.changed_at as string | undefined) ?? '')
    }
  }

  function deletion(d: DeletionRow) {
    if (d.workspace_id !== ctx.workspaceId || !isLiveTable(d.table_name)) return
    const t = d.table_name
    const key = keyOf(t, (d.row_key && typeof d.row_key === 'object' ? d.row_key : {}) as Loose)
    if (!key) return
    advance(d.deleted_at)
    const old = stored(t, key)
    // a row made again after it was deleted (the same label put back on an issue) stays
    if (old && compareStamp(old.changed_at as string, d.deleted_at) <= 0) forget(t, key, old)
    setGone(localKey(t, key), d.deleted_at)
  }

  function local(c: AnyChange) {
    const k = localKey(c.table, c.key)
    const before: Loose = { ...stored(c.table, c.key), ...live.local[k] }
    if (c.op === 'delete') {
      if (live.local[k]) delete draft('local')[k]
      draft('localGone')[k] = true
    } else {
      if (live.localGone[k]) delete draft('localGone')[k]
      draft('local')[k] = { ...live.local[k], ...c.fields, ...c.guess }
      learn(c.table, { ...c.key, ...live.local[k] })
    }
    touch(c.table, { ...c.key, ...before, ...live.local[k] })
  }

  function settled(c: AnyChange, row: Loose | undefined) {
    const k = localKey(c.table, c.key)
    const before: Loose = { ...stored(c.table, c.key), ...live.local[k] }
    if (c.op === 'delete') {
      if (live.localGone[k]) delete draft('localGone')[k]
      const old = stored(c.table, c.key)
      if (row && old) {
        forget(c.table, c.key, old)
        setGone(k, (row.changed_at as string | undefined) ?? (old.changed_at as string))
      }
    } else if (live.local[k]) {
      // what was sent goes; a newer edit of the same column is still on its way and stays
      const rest = { ...live.local[k] }
      for (const [col, v] of Object.entries({ ...c.fields, ...c.guess })) if (col in rest && equal(rest[col], v)) delete rest[col]
      if (Object.keys(rest).length) draft('local')[k] = rest
      else delete draft('local')[k]
    }
    touch(c.table, { ...c.key, ...before })
    if (row && c.op !== 'delete') whole(c.table, row)
  }

  for (const input of inputs) {
    if (input.from === 'fetch') for (const row of input.rows) whole(input.table, row)
    else if (input.from === 'message') message(input.message)
    else if (input.from === 'deletions') for (const d of input.rows) deletion(d)
    else if (input.from === 'local') local(input.change)
    else settled(input.change, input.row)
  }

  // ---------- the store parts, worked out again ----------

  const out: Partial<StoreSlice> = {}
  const cur = <F extends RecField>(f: F): StoreSlice[F] => (out[f] ?? data[f]) as StoreSlice[F]
  /** puts a value in a record part; one equal to what's there keeps the old object. Returns what is there now */
  function set<F extends RecField>(f: F, key: string, value: StoreSlice[F][string] | undefined): StoreSlice[F][string] | undefined {
    const old = (cur(f) as Record<string, StoreSlice[F][string]>)[key]
    const edit = () => (out[f] ??= { ...data[f] }) as Record<string, unknown>
    if (value === undefined) {
      if (old !== undefined) delete edit()[key]
      return undefined
    }
    if (old !== undefined && equal(old, value)) return old
    edit()[key] = value
    return value
  }

  // a row as it shows: the database's, with your changes on top
  const locals = new Map<string, [string, Loose][]>()
  for (const [k, v] of Object.entries(live.local)) {
    const at = k.indexOf(':')
    const t = k.slice(0, at)
    locals.set(t, [...(locals.get(t) ?? []), [k.slice(at + 1), v]])
  }
  function shown(t: LiveTable, key: Loose): Loose | undefined {
    const k = localKey(t, key)
    if (live.localGone[k]) return undefined
    const s = stored(t, key)
    const l = live.local[k]
    if (!s && !l) return undefined
    return l ? { ...key, ...s, ...l } : s
  }
  /** a parent's join rows (or comments), yours included */
  function fold(t: Grouped, parent: string): Loose[] {
    const found = new Map<string, Loose>()
    for (const row of Object.values((read()[t][parent] ?? {}) as Rec<Loose>)) {
      const v = shown(t, row)
      if (v) found.set(keyString(t, row), v)
    }
    for (const [ks, l] of locals.get(t) ?? []) {
      if (found.has(ks) || live.localGone[`${t}:${ks}`]) continue
      const row = { ...parseKey(t, ks), ...l }
      if (row[GROUPED[t][0]] === parent) found.set(ks, row)
    }
    return [...found.values()]
  }
  /** for a thing that refers to people and teams: an unknown id puts it on the waiting list and asks for the row */
  const resolve = (ref: string): rows.Resolve => ({
    registry: ctx.registry,
    miss: (id, table) => {
      const refs = live.waiting[id]
      if (!refs) want(table, { id })
      if (!refs?.includes(ref)) draft('waiting')[id] = [...(refs ?? []), ref]
    },
  })

  for (const id of dirty.person) {
    const row = shown('profiles', { id }) as Row<'profiles'> | undefined
    if (row) {
      const p = rows.rowToPerson(row)
      set('people', p.login, p)
    } else {
      const login = ctx.registry.login(id)
      if (login !== undefined) set('people', login, undefined)
    }
  }

  for (const id of dirty.member) {
    const row = shown('workspace_members', { workspace_id: ctx.workspaceId, profile_id: id }) as Row<'workspace_members'> | undefined
    const login = ctx.registry.login(id) ?? id
    // the id stood in for their login until their profile came
    if (login !== id) set('members', id, undefined)
    if (row && login === id) resolve(`member:${id}`).miss?.(id, 'profiles')
    set('members', login, row ? rows.rowToMember(row) : undefined)
  }

  for (const id of dirty.team) {
    const row = shown('teams', { id }) as Row<'teams'> | undefined
    if (row) set('teams', row.key, rows.rowToTeam(row, fold('team_members', id) as Row<'team_members'>[], resolve(`team:${id}`)))
    else {
      const key = ctx.registry.teamKey(id)
      if (key !== undefined) set('teams', key, undefined)
    }
  }

  for (const id of dirty.label) {
    const row = shown('labels', { id }) as Row<'labels'> | undefined
    set('labels', id, row && rows.rowToLabel(row))
  }

  for (const id of dirty.project) {
    const row = shown('projects', { id }) as Row<'projects'> | undefined
    set('projects', id, row && rows.rowToProject(row, fold('project_teams', id) as Row<'project_teams'>[], resolve(`project:${id}`)))
  }

  for (const id of dirty.issue) {
    const row = shown('issues', { id }) as Row<'issues'> | undefined
    if (!row) {
      set('issues', id, undefined)
      set('archive', id, undefined)
      set('comments', id, undefined)
      continue
    }
    const r = resolve(`issue:${id}`)
    const old = cur('comments')[id] ?? cur('archive')[id]?.comments
    const fresh = fold('comments', id)
      .map((c) => rows.rowToComment(c as Row<'comments'>, r))
      .sort(byTime)
    const was = new Map((old ?? []).map((c) => [c.id, c]))
    const kept = fresh.map((c) => {
      const o = was.get(c.id)
      return o && equal(o, c) ? o : c
    })
    const list = old && old.length === kept.length && kept.every((c, n) => c === old[n]) ? old : kept
    const issue = rows.rowToIssue(row, fold('issue_labels', id) as Row<'issue_labels'>[], fold('issue_followers', id) as Row<'issue_followers'>[], r, list)
    // its team isn't known yet: it shows once the team arrives
    if (!issue) continue
    if (row.archived_at) {
      set('archive', id, issue as ArchivedIssue)
      set('issues', id, undefined)
      set('comments', id, undefined)
    } else {
      set('issues', id, issue)
      set('comments', id, list.length ? list : undefined)
      set('archive', id, undefined)
    }
  }

  for (const id of dirty.view) {
    const row = shown('views', { id }) as Row<'views'> | undefined
    if (!row) set('views', id, undefined)
    else {
      const view = rows.rowToView(row, resolve(`view:${id}`))
      if (view) set('views', id, view)
    }
  }

  if (dirty.inbox.size) {
    const byId = new Map(data.inbox.map((n) => [n.id, n]))
    let changed = false
    for (const id of dirty.inbox) {
      const row = shown('inbox', { id }) as Row<'inbox'> | undefined
      const old = byId.get(id)
      // only this workspace's notes, and only yours (an action may write notes for others)
      if (!row || row.workspace_id !== ctx.workspaceId || (ctx.meId !== null && row.recipient_id !== ctx.meId)) {
        if (old) changed = byId.delete(id)
        continue
      }
      const n = rows.rowToInbox(row, resolve(`inbox:${id}`))
      if (old && equal(old, n)) continue
      byId.set(id, n)
      changed = true
    }
    if (changed) out.inbox = [...byId.values()].sort(newestFirst)
  }

  if (readStateDirty && ctx.meId) {
    const row = shown('read_state', { profile_id: ctx.meId, workspace_id: ctx.workspaceId }) as Row<'read_state'> | undefined
    const next = row ? rows.rowToReadState(row) : NO_READ_STATE
    if (!equal(data.readState, next)) out.readState = next
  }

  if (workspaceDirty || workspaceGone) {
    const row = workspaceGone ? undefined : (shown('workspaces', { id: ctx.workspaceId }) as Row<'workspaces'> | undefined)
    const next = row ? rows.rowToWorkspace(row) : null
    if (next ? !equal(data.workspace, next) : data.workspace !== null) out.workspace = next
  }

  if (ctx.meId && dirty.person.has(ctx.meId)) {
    const login = ctx.registry.login(ctx.meId)
    const me = (login !== undefined && cur('people')[login]) || null
    if (me !== data.me && !(me && data.me && equal(me, data.me))) out.me = me
  }

  return { state: live, patch: out, fetch: [...wanted.values()], catchUp, workspaceGone }
}
