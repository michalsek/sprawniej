/**
 * Reading rows: everything a workspace needs when it opens, what changed while we weren't listening (catching up),
 * the archive, and single rows a message pointed at. Every method returns inputs for applyRows.
 *
 * The database hands out a limited number of rows per request (1000 in supabase/config.toml, but whoever runs it may
 * set less), so lists are read in pages, ordered by the primary key and continued after the last key seen (never by
 * counting: a row deleted meanwhile would make a count skip one). Each request also asks how many rows are left, so
 * reading stops exactly when everything is in, whatever the limit.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Db } from './client'
import { micros } from './rows'
import { KEYS, LIVE_TABLES, type DeletionRow, type LiveTable } from './tables'
import type { Incoming } from './apply'

type Loose = Record<string, unknown>
/** a select on a table picked at run time (one row type per table can't be named here) */
export type Query = ReturnType<ReturnType<SupabaseClient['from']>['select']>

/** rows asked for per request */
const PAGE = 1000
/** values per `in (…)`, so the address stays short */
const CHUNK = 100

const chunks = <T>(list: readonly T[], size = CHUNK): T[][] => {
  const out: T[][] = []
  for (let n = 0; n < list.length; n += size) out.push(list.slice(n, n + size))
  return out
}

/** the filter that continues after `last` in key order: "id.gt.X", or "a.gt.X,and(a.eq.X,b.gt.Y)" (ids need no quotes) */
function after(cols: readonly string[], last: Loose): string {
  const [a, b] = cols
  const x = String(last[a])
  if (b === undefined) return `${a}.gt.${x}`
  return `${a}.gt.${x},and(${a}.eq.${x},${b}.gt.${String(last[b])})`
}

export const afterKey = (table: LiveTable, last: Loose): string => after(KEYS[table], last)

const fetched = (table: LiveTable, rows: readonly Loose[], keys?: Record<string, string>[]): Incoming => ({ from: 'fetch', table, rows, ...(keys && { keys }) })

/** an issue's labels, followers, comments and pull requests, read through their issue (to tell open issues from archived ones) */
const ISSUE_PARTS = ['issue_labels', 'issue_followers', 'comments', 'issue_pull_requests'] as const
type IssuePart = (typeof ISSUE_PARTS)[number]
const WITH_ISSUE = '*, issues!inner(archived_at)'
const dropIssue = (rows: Loose[]): Loose[] => rows.map(({ issues: _issues, ...row }) => row)

const memberIdsOf = (rows: readonly Loose[]) => [...new Set(rows.map((r) => String(r.profile_id)))]

/** every row of a select, page by page in key order, until none are left (the import's small queries use it too) */
export async function paged(
  db: Db,
  table: string,
  cols: readonly string[],
  select: string,
  filter: (q: Query) => Query,
  { page = PAGE, onPage }: { page?: number; onPage?: (n: number) => void } = {},
): Promise<Loose[]> {
  const out: Loose[] = []
  let last: Loose | undefined
  for (;;) {
    let q = filter((db as unknown as SupabaseClient).from(table).select(select, { count: 'exact' }))
    if (last) q = q.or(after(cols, last))
    for (const c of cols) q = q.order(c)
    const { data, error, count } = await q.limit(page)
    if (error) throw error
    const rows = data as unknown as Loose[]
    out.push(...rows)
    onPage?.(out.length)
    // `count` is what was left before this page; without it, an empty page says it's over
    if (!rows.length || (count !== null && rows.length >= count)) return out
    last = rows[rows.length - 1]
  }
}

/** reads one workspace's rows, as one person (your inbox and read marks are yours only) */
export class Loader {
  private db: Db
  private ws: string
  private meId: string
  private page: number

  /** `page`: rows asked for per request (tests make it small) */
  constructor(db: Db, ws: string, meId: string, { page = PAGE }: { page?: number } = {}) {
    this.db = db
    this.ws = ws
    this.meId = meId
    this.page = page
  }

  private paged(table: string, cols: readonly string[], select: string, filter: (q: Query) => Query, onPage?: (n: number) => void): Promise<Loose[]> {
    return paged(this.db, table, cols, select, filter, { page: this.page, onPage })
  }

  /** a table's rows that belong to this workspace (and, for your inbox, read marks and favourites, to you) */
  private scope(table: LiveTable): (q: Query) => Query {
    if (table === 'workspaces') return (q) => q.eq('id', this.ws)
    if (table === 'inbox') return (q) => q.eq('workspace_id', this.ws).eq('recipient_id', this.meId)
    if (table === 'read_state' || table === 'favourites') return (q) => q.eq('workspace_id', this.ws).eq('profile_id', this.meId)
    return (q) => q.eq('workspace_id', this.ws)
  }

  /** an issue part's rows, of open issues or of archived ones */
  private async parts(t: IssuePart, archived: boolean): Promise<Incoming> {
    const rows = await this.paged(t, KEYS[t], WITH_ISSUE, (q) =>
      archived ? q.eq('workspace_id', this.ws).not('issues.archived_at', 'is', null) : q.eq('workspace_id', this.ws).is('issues.archived_at', null),
    )
    return fetched(t, dropIssue(rows))
  }

  private issues(archived: boolean, onPage?: (n: number) => void): Promise<Incoming> {
    const filter = (q: Query) => (archived ? q.eq('workspace_id', this.ws).not('archived_at', 'is', null) : q.eq('workspace_id', this.ws).is('archived_at', null))
    return this.paged('issues', KEYS.issues, '*', filter, onPage).then((rows) => fetched('issues', rows))
  }

  /** the people a workspace shows: its members (also those who left) and its people from Linear */
  private async profiles(memberIds: readonly string[]): Promise<Incoming> {
    const parts = await Promise.all([
      ...chunks(memberIds).map((ids) => this.paged('profiles', ['id'], '*', (q) => q.in('id', ids))),
      this.paged('profiles', ['id'], '*', (q) => q.eq('guest_of', this.ws)),
    ])
    return fetched('profiles', parts.flat())
  }

  private whole(t: LiveTable): Promise<Incoming> {
    return this.paged(t, KEYS[t], '*', this.scope(t)).then((rows) => fetched(t, rows))
  }

  /** everything an opening workspace needs (the archive comes later, when something needs it) */
  all(progress?: (text: string) => void): Promise<Incoming[]> {
    const plain = ['workspaces', 'teams', 'team_members', 'labels', 'statuses', 'projects', 'project_teams', 'views', 'inbox', 'read_state', 'favourites'] as const
    const members = this.paged('workspace_members', KEYS.workspace_members, '*', this.scope('workspace_members'))
    const told = (n: number) => (n >= PAGE ? progress?.(`Getting your team's issues: ${n.toLocaleString('en')} so far…`) : undefined)
    return Promise.all([
      ...plain.map((t) => this.whole(t)),
      members.then((rows) => fetched('workspace_members', rows)),
      members.then((rows) => this.profiles(memberIdsOf(rows))),
      this.issues(false, told),
      ...ISSUE_PARTS.map((t) => this.parts(t, false)),
    ])
  }

  /** archived issues with their labels, followers and comments */
  archived(): Promise<Incoming[]> {
    return Promise.all([this.issues(true), ...ISSUE_PARTS.map((t) => this.parts(t, true))])
  }

  /**
   * What changed since `since`: every changed row of every table (archived issues too, page after page), deletions,
   * and the workspace row itself. `members`: the people we know are in the workspace (their profiles are read if they
   * changed; people who joined meanwhile are read whole). `gone`: the workspace isn't there for you any more (deleted,
   * or you're no longer in it).
   */
  async changed(since: string, members: ReadonlySet<string>): Promise<{ inputs: Incoming[]; gone: boolean }> {
    const changed = (t: LiveTable, filter: (q: Query) => Query) => this.paged(t, KEYS[t], '*', (q) => filter(q).gt('changed_at', since))
    const tables = LIVE_TABLES.filter((t) => t !== 'workspaces' && t !== 'profiles')
    // only this workspace's people: its members and its people from Linear (the rules also let through your other
    // workspaces' people)
    const people = Promise.all([
      ...chunks([...members]).map((ids) => changed('profiles', (q) => q.in('id', ids))),
      changed('profiles', (q) => q.eq('guest_of', this.ws)),
    ])
    const [workspace, known, deletions, ...rest] = await Promise.all([
      this.paged('workspaces', ['id'], '*', (q) => q.eq('id', this.ws)),
      people,
      this.paged('deletions', ['id'], '*', (q) => q.eq('workspace_id', this.ws).gt('deleted_at', since)),
      ...tables.map((t) => changed(t, this.scope(t))),
    ])
    const byTable = Object.fromEntries(tables.map((t, n) => [t, rest[n]])) as Record<(typeof tables)[number], Loose[]>
    const joined = [...new Set(byTable.workspace_members.map((r) => String(r.profile_id)))].filter((id) => !members.has(id))
    const newcomers = await Promise.all(chunks(joined).map((ids) => this.paged('profiles', ['id'], '*', (q) => q.in('id', ids))))
    const inputs: Incoming[] = [
      fetched('workspaces', workspace),
      fetched('profiles', [...known.flat(), ...newcomers.flat()]),
      { from: 'deletions', rows: deletions as unknown as DeletionRow[] },
      ...tables.map((t) => fetched(t, byTable[t])),
    ]
    return { inputs, gone: workspace.length === 0 }
  }

  /** the ids of every note in your inbox (notes that went leave nothing behind, so a kept copy is compared with them) */
  async inboxIds(): Promise<Set<string>> {
    const rows = await this.paged('inbox', KEYS.inbox, 'id', this.scope('inbox'))
    return new Set(rows.map((r) => String(r.id)))
  }

  /** the item ids of your favourites (they leave nothing behind either, so the ones we have are compared with them) */
  async favouriteIds(): Promise<Set<string>> {
    const rows = await this.paged('favourites', KEYS.favourites, 'profile_id,item_id', this.scope('favourites'))
    return new Set(rows.map((r) => String(r.item_id)))
  }

  /** what the groups ask for; new issues (ones we didn't have) come with their labels, followers and comments */
  async byKeys(groups: readonly FetchGroup[], issuesNew: readonly string[]): Promise<Incoming[]> {
    const asked = groups.map(async (g) => {
      const rows = await this.paged(g.table, KEYS[g.table], '*', (q) => {
        let r = q.in(g.inCol, g.values)
        for (const [c, v] of Object.entries(g.eq)) r = r.eq(c, v)
        // profiles and workspaces are shared between workspaces; the rest is kept to this one
        return g.table === 'profiles' || g.table === 'workspaces' || 'workspace_id' in g.eq ? r : r.eq('workspace_id', this.ws)
      })
      return fetched(g.table, rows, g.values.map((v) => ({ ...g.eq, [g.inCol]: v })))
    })
    const [rows, parts] = await Promise.all([Promise.all(asked), this.partsOf(issuesNew)])
    return [...rows, ...parts]
  }

  /** the labels, followers and comments of these issues */
  async partsOf(issueIds: readonly string[]): Promise<Incoming[]> {
    return Promise.all(
      chunks(issueIds).flatMap((ids) => ISSUE_PARTS.map(async (t) => fetched(t, await this.paged(t, KEYS[t], '*', (q) => q.eq('workspace_id', this.ws).in('issue_id', ids))))),
    )
  }

  /** how many archived issues a team has (the archive may not be read yet) */
  async countArchived(teamId: string): Promise<number> {
    const { count, error } = await this.db
      .from('issues')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', this.ws)
      .eq('team_id', teamId)
      .not('archived_at', 'is', null)
    if (error) throw error
    return count ?? 0
  }

  /** the workspace is there for you */
  async exists(): Promise<boolean> {
    const { data, error } = await this.db.from('workspaces').select('id').eq('id', this.ws)
    if (error) throw error
    return data.length > 0
  }
}

/** what a Loader reads with (LiveWorkspace's tests give it a pretend one) */
export type Reader = Pick<Loader, 'all' | 'archived' | 'changed' | 'inboxIds' | 'favouriteIds' | 'byKeys' | 'partsOf' | 'exists' | 'countArchived'>

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

/** a raw database time, `seconds` earlier, as an exact ISO time ("…T12:27:50.816096Z"): where catching up starts */
export function sinceMark(stamp: string, seconds = 10): string {
  const m = micros(stamp)
  if (m === null) return stamp
  const at = m - BigInt(seconds) * 1_000_000n
  const ms = at >= 0n ? at / 1000n : -((-at + 999n) / 1000n)
  const us = String(((at % 1000n) + 1000n) % 1000n).padStart(3, '0')
  return `${new Date(Number(ms)).toISOString().slice(0, 23)}${us}Z`
}

export { tooLongAgo } from './rows'
