/**
 * Reading rows: everything a workspace needs when it opens, what changed while we weren't listening (catching up),
 * the archive, and single rows a message pointed at. Every function returns inputs for applyRows.
 *
 * The database hands out at most 1000 rows per request, so lists are read in pages, ordered by the primary key and
 * continued after the last key seen (never by counting: a row deleted meanwhile would make a count skip one).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { micros } from './rows'
import { KEYS, LIVE_TABLES, type DeletionRow, type LiveTable } from './tables'
import type { Incoming } from './apply'

type Db = SupabaseClient<Database>
type Loose = Record<string, unknown>
/** a select on a table picked at run time (one row type per table can't be named here) */
type Query = ReturnType<ReturnType<SupabaseClient['from']>['select']>

const PAGE = 1000
/** values per `in (…)`, so the address stays short */
const CHUNK = 100

const from = (db: Db, table: string) => (db as unknown as SupabaseClient).from(table)

const chunks = <T>(list: readonly T[], size = CHUNK): T[][] => {
  const out: T[][] = []
  for (let n = 0; n < list.length; n += size) out.push(list.slice(n, n + size))
  return out
}

/** the filter that continues after `last` in key order: "id.gt.X", or "a.gt.X,and(a.eq.X,b.gt.Y)" (ids need no quotes) */
function after(cols: readonly string[], last: Loose): string {
  const [a, b] = cols
  if (b === undefined) return `${a}.gt.${String(last[a])}`
  return `${a}.gt.${String(last[a])},and(${a}.eq.${String(last[a])},${b}.gt.${String(last[b])})`
}

export const afterKey = (table: LiveTable, last: Loose): string => after(KEYS[table], last)

/** every row of a select, page by page in key order */
async function paged(db: Db, table: string, cols: readonly string[], select: string, filter: (q: Query) => Query, onPage?: (n: number) => void): Promise<Loose[]> {
  const out: Loose[] = []
  let last: Loose | undefined
  for (;;) {
    let q = filter(from(db, table).select(select))
    if (last) q = q.or(after(cols, last))
    for (const c of cols) q = q.order(c)
    const { data, error } = await q.limit(PAGE)
    if (error) throw error
    const rows = data as unknown as Loose[]
    out.push(...rows)
    onPage?.(out.length)
    if (rows.length < PAGE) return out
    last = rows[rows.length - 1]
  }
}

/** a table's rows that belong to this workspace (and, for your inbox and read marks, to you) */
function scope(table: LiveTable, ws: string, meId: string): (q: Query) => Query {
  if (table === 'workspaces') return (q) => q.eq('id', ws)
  if (table === 'inbox') return (q) => q.eq('workspace_id', ws).eq('recipient_id', meId)
  if (table === 'read_state') return (q) => q.eq('workspace_id', ws).eq('profile_id', meId)
  return (q) => q.eq('workspace_id', ws)
}

const fetched = (table: LiveTable, rows: readonly Loose[], keys?: Record<string, string>[]): Incoming => ({ from: 'fetch', table, rows, ...(keys && { keys }) })

/** an issue's labels, followers and comments, read through their issue (to tell open issues from archived ones) */
const ISSUE_PARTS = ['issue_labels', 'issue_followers', 'comments'] as const
const withIssue = '*, issues!inner(archived_at)'
const dropIssue = (rows: Loose[]): Loose[] => rows.map(({ issues: _issues, ...row }) => row)

function issueParts(db: Db, ws: string, archived: boolean): Promise<Incoming>[] {
  return ISSUE_PARTS.map(async (t) => {
    const rows = await paged(db, t, KEYS[t], withIssue, (q) =>
      archived ? q.eq('workspace_id', ws).not('issues.archived_at', 'is', null) : q.eq('workspace_id', ws).is('issues.archived_at', null),
    )
    return fetched(t, dropIssue(rows))
  })
}

/** the people a workspace shows: its members (also those who left) and its people from Linear */
async function profiles(db: Db, ws: string, memberIds: readonly string[]): Promise<Incoming> {
  const parts = await Promise.all([
    ...chunks(memberIds).map((ids) => paged(db, 'profiles', ['id'], '*', (q) => q.in('id', ids))),
    paged(db, 'profiles', ['id'], '*', (q) => q.eq('guest_of', ws)),
  ])
  return fetched('profiles', parts.flat())
}

const memberIdsOf = (rows: readonly Loose[]) => [...new Set(rows.map((r) => String(r.profile_id)))]

/** everything an opening workspace needs (the archive comes later, when something needs it) */
export async function loadAll(db: Db, ws: string, meId: string, progress?: (text: string) => void): Promise<Incoming[]> {
  const plain = ['workspaces', 'teams', 'team_members', 'labels', 'projects', 'project_teams', 'views', 'inbox', 'read_state'] as const
  const members = paged(db, 'workspace_members', KEYS.workspace_members, '*', scope('workspace_members', ws, meId))
  const issues = paged(db, 'issues', KEYS.issues, '*', (q) => q.eq('workspace_id', ws).is('archived_at', null), (n) =>
    n >= PAGE ? progress?.(`Getting your team's issues: ${n.toLocaleString('en')} so far…`) : undefined,
  )
  return Promise.all([
    ...plain.map(async (t) => fetched(t, await paged(db, t, KEYS[t], '*', scope(t, ws, meId)))),
    members.then((rows) => fetched('workspace_members', rows)),
    members.then((rows) => profiles(db, ws, memberIdsOf(rows))),
    issues.then((rows) => fetched('issues', rows)),
    ...issueParts(db, ws, false),
  ])
}

/** one table again, whole (catching up found too many changes in it to read them one by one) */
export async function loadTable(db: Db, ws: string, meId: string, table: LiveTable): Promise<Incoming[]> {
  if (table === 'profiles') {
    const members = await paged(db, 'workspace_members', KEYS.workspace_members, 'workspace_id,profile_id', scope('workspace_members', ws, meId))
    return [await profiles(db, ws, memberIdsOf(members))]
  }
  if (table === 'issues') return [fetched('issues', await paged(db, 'issues', KEYS.issues, '*', (q) => q.eq('workspace_id', ws).is('archived_at', null)))]
  if (table === 'issue_labels' || table === 'issue_followers' || table === 'comments') {
    return [fetched(table, dropIssue(await paged(db, table, KEYS[table], withIssue, (q) => q.eq('workspace_id', ws).is('issues.archived_at', null))))]
  }
  return [fetched(table, await paged(db, table, KEYS[table], '*', scope(table, ws, meId)))]
}

/** archived issues with their labels, followers and comments */
export async function loadArchived(db: Db, ws: string): Promise<Incoming[]> {
  return Promise.all([
    paged(db, 'issues', KEYS.issues, '*', (q) => q.eq('workspace_id', ws).not('archived_at', 'is', null)).then((rows) => fetched('issues', rows)),
    ...issueParts(db, ws, true),
  ])
}

/**
 * What changed since `since`: changed rows of every table (archived issues too), deletions, and the workspace row
 * itself. `full`: tables with too many changes to read this way (read them whole with loadTable); `gone`: the
 * workspace isn't there for you any more (deleted, or you're no longer in it).
 */
export async function loadChanged(
  db: Db,
  ws: string,
  meId: string,
  since: string,
  members: ReadonlySet<string>,
): Promise<{ inputs: Incoming[]; full: LiveTable[]; gone: boolean }> {
  const full: LiveTable[] = []
  const changed = async (t: LiveTable, filter: (q: Query) => Query) => {
    const { data, error } = await filter(from(db, t).select('*')).gt('changed_at', since).order('changed_at').limit(PAGE)
    if (error) throw error
    const rows = data as unknown as Loose[]
    if (rows.length >= PAGE) full.push(t)
    return rows
  }
  const tables = LIVE_TABLES.filter((t) => t !== 'workspaces' && t !== 'profiles')
  const [workspace, people, deletions, ...rest] = await Promise.all([
    paged(db, 'workspaces', ['id'], '*', (q) => q.eq('id', ws)),
    // the rules also let through people from your other workspaces: only this one's are kept
    changed('profiles', (q) => q),
    paged(db, 'deletions', ['id'], '*', (q) => q.eq('workspace_id', ws).gt('deleted_at', since)),
    ...tables.map((t) => changed(t, scope(t, ws, meId))),
  ])
  const joined = new Set(members)
  tables.forEach((t, n) => t === 'workspace_members' && rest[n].forEach((r) => joined.add(String(r.profile_id))))
  const inputs: Incoming[] = [
    fetched('workspaces', workspace),
    fetched('profiles', people.filter((p) => p.guest_of === ws || joined.has(String(p.id)))),
    { from: 'deletions', rows: deletions as unknown as DeletionRow[] },
    ...tables.map((t, n) => fetched(t, rest[n])),
  ]
  return { inputs, full, gone: workspace.length === 0 }
}

/** rows asked for by key, grouped so each group is one request */
export interface FetchGroup {
  table: LiveTable
  /** key columns every row in the group shares */
  eq: Record<string, string>
  /** the last key column, and its values */
  inCol: string
  values: string[]
}

/** groups by table and every key column but the last, at most CHUNK values each, each key once */
export function planFetch(reqs: readonly { table: LiveTable; key: Record<string, string> }[]): FetchGroup[] {
  const groups = new Map<string, { table: LiveTable; eq: Record<string, string>; inCol: string; values: Set<string> }>()
  for (const { table, key } of reqs) {
    const cols = KEYS[table]
    const inCol = cols[cols.length - 1]
    const eq = Object.fromEntries(cols.slice(0, -1).map((c) => [c, key[c]]))
    const id = [table, ...cols.slice(0, -1).map((c) => key[c])].join('|')
    const g = groups.get(id) ?? { table, eq, inCol, values: new Set<string>() }
    g.values.add(key[inCol])
    groups.set(id, g)
  }
  return [...groups.values()].flatMap((g) => chunks([...g.values]).map((values) => ({ table: g.table, eq: g.eq, inCol: g.inCol, values })))
}

/** what a group asks for, in rows; new issues (ones we didn't have) come with their labels, followers and comments */
export async function fetchByKeys(db: Db, ws: string, groups: readonly FetchGroup[], issuesNew: readonly string[]): Promise<Incoming[]> {
  const asked = groups.map(async (g) => {
    const rows = await paged(db, g.table, KEYS[g.table], '*', (q) => {
      let r = q.in(g.inCol, g.values)
      for (const [c, v] of Object.entries(g.eq)) r = r.eq(c, v)
      // profiles and workspaces are shared between workspaces; the rest is kept to this one
      return g.table === 'profiles' || g.table === 'workspaces' || 'workspace_id' in g.eq ? r : r.eq('workspace_id', ws)
    })
    return fetched(g.table, rows, g.values.map((v) => ({ ...g.eq, [g.inCol]: v })))
  })
  return (await Promise.all([...asked, ...partsOf(db, ws, issuesNew)])).flat()
}

/** the labels, followers and comments of these issues */
export function partsOf(db: Db, ws: string, issueIds: readonly string[]): Promise<Incoming>[] {
  return chunks(issueIds).flatMap((ids) =>
    ISSUE_PARTS.map(async (t) => fetched(t, await paged(db, t, KEYS[t], '*', (q) => q.eq('workspace_id', ws).in('issue_id', ids)))),
  )
}

/** a raw database time, `seconds` earlier, as an exact ISO time ("…T12:27:50.816096Z"): where catching up starts */
export function sinceMark(stamp: string, seconds = 10): string {
  const m = micros(stamp)
  if (m === null) return stamp
  const at = m - BigInt(seconds) * 1_000_000n
  const ms = at >= 0n ? at / 1000n : -((-at + 999n) / 1000n)
  const us = String(((at % 1000n) + 1000n) % 1000n).padStart(3, '0')
  return `${new Date(Number(ms)).toISOString().slice(0, 23)}${us}Z`
}

/** deletions are kept 45 days: from further back, catching up could miss some, so the workspace is read again */
export function tooOld(stamp: string, now: number, days = 44): boolean {
  const m = micros(stamp)
  return m === null || Number(m / 1000n) < now - days * 86_400_000
}
