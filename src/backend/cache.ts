/**
 * The copy of a workspace this browser keeps between visits, as plain data: what goes in it, when it can be used
 * again, and making it smaller. Opening shows the copy at once and then reads only what changed since it
 * (workspace.ts); keep.ts decides when to keep it, cacheStore.ts keeps it in IndexedDB.
 *
 * What it holds is the database's rows only (`live.server`), never your own changes still on their way: those belong
 * to the writer, and a copy another tab reads must not show them. With the rows goes the mark they are complete up
 * to, so catching up from it (changed rows, deletions, the inbox compared) arrives at the same rows as reading
 * everything.
 */
import { APP_VERSION } from '@/version'
import type { Incoming, LiveState } from './apply'
import { isGrouped, type Mirror } from './apply/mirror'
import { localKey } from './apply/take'
import { compareStamp, MAX_AGE_DAYS, micros, tooLongAgo } from './rows'
import { LIVE_TABLES, type LiveTable } from './tables'

export { MAX_AGE_DAYS } from './rows'

/** bump when CacheBody or CacheMeta change shape */
export const CACHE_FORMAT = 1
/** the newest migration: a copy made for another database layout is never read (a test checks it) */
export const SCHEMA_ID = '20261020130000'
/** a copy longer than this (JSON characters) leaves the archive out, and if it's still too long it isn't kept */
export const MAX_CHARS = 20_000_000
/** workspaces kept per browser */
export const MAX_WORKSPACES = 3

/** whose copy of which workspace, from which database */
export interface CacheId {
  /** the database's host (a copy from another project never matches) */
  project: string
  profileId: string
  workspaceId: string
}

export interface CacheMeta extends CacheId {
  v: number
  app: string
  schema: string
  /** the raw database time the rows are complete up to (where catching up starts) */
  mark: string
  /** when this browser last had everything, by its own clock (ms): the 44-day rule counts from it */
  caughtUpAt: number
  /** Date.now() when it was kept */
  savedAt: number
  /** the body's length, to tell a body that doesn't belong to it */
  chars: number
  /** every archived issue is in it */
  archive: boolean
}

type Loose = Record<string, unknown>

export interface CacheBody {
  v: number
  /** the database's rows, one list per table; a row whose text is still to come carries `partial: true` */
  rows: Partial<Record<LiveTable, Loose[]>>
}

/** what a copy must match to be used */
export type Wanted = Pick<CacheMeta, 'v' | 'app' | 'schema' | keyof CacheId>
export const wanted = (id: CacheId): Wanted => ({ v: CACHE_FORMAT, app: APP_VERSION, schema: SCHEMA_ID, ...id })

/** a gap (messages may have been missed from `floor` on) keeps the copy's mark from moving past it */
export const cacheMark = (mark: string | null, floor: string | null): string | null => floor ?? mark

/** the database's rows, flat (grouped tables out of their groups); `commentIssue` is worked out again on reading */
export function rowsOf(live: Pick<LiveState, 'server' | 'partial'>): CacheBody['rows'] {
  const out: CacheBody['rows'] = {}
  for (const t of LIVE_TABLES) {
    const table = live.server[t as keyof Mirror] as Readonly<Record<string, unknown>>
    const rows = (isGrouped(t) ? Object.values(table).flatMap((g) => Object.values(g as Loose)) : Object.values(table)) as Loose[]
    if (!rows.length) continue
    out[t] = rows.map((r) => (live.partial[localKey(t, r)] ? { ...r, partial: true } : r))
  }
  return out
}

/** how many rows the copy of the database holds (a copy too big to keep is tried again only once it has fewer) */
export function rowCount(server: Mirror): number {
  let n = 0
  for (const t of LIVE_TABLES) {
    const table = server[t as keyof Mirror] as Readonly<Record<string, unknown>>
    if (!isGrouped(t)) n += Object.keys(table).length
    else for (const g of Object.values(table)) n += Object.keys(g as Loose).length
  }
  return n
}

/** the copy without archived issues and what belongs to them */
export function shrink(rows: CacheBody['rows']): CacheBody['rows'] {
  const archived = new Set((rows.issues ?? []).filter((r) => r.archived_at != null).map((r) => String(r.id)))
  if (!archived.size) return rows
  const out = { ...rows, issues: rows.issues?.filter((r) => !archived.has(String(r.id))) }
  for (const t of ['issue_labels', 'issue_followers', 'comments'] as const) if (rows[t]) out[t] = rows[t].filter((r) => !archived.has(String(r.issue_id)))
  return out
}

const bodyOf = (rows: CacheBody['rows']) => JSON.stringify({ v: CACHE_FORMAT, rows } satisfies CacheBody)

/**
 * The copy to keep: null when it's too big even without the archive. `small`: without the archive from the start
 * (the browser said it's full).
 */
export function encode(
  live: Pick<LiveState, 'server' | 'partial'>,
  o: { id: CacheId; mark: string; caughtUpAt: number; archive: boolean; now: number; max?: number; small?: boolean },
): { meta: CacheMeta; body: string } | null {
  const max = o.max ?? MAX_CHARS
  const rows = rowsOf(live)
  let body: string
  let archive = o.archive
  const whole = o.small ? null : bodyOf(rows)
  if (whole !== null && whole.length <= max) body = whole
  else {
    body = bodyOf(shrink(rows))
    archive = false
    if (body.length > max) return null
  }
  const meta: CacheMeta = { ...wanted(o.id), mark: o.mark, caughtUpAt: o.caughtUpAt, savedAt: o.now, chars: body.length, archive }
  return { meta, body }
}

const isRow = (r: unknown): r is Loose => !!r && typeof r === 'object' && !Array.isArray(r)

/** a body as kept, or null when it can't be read (not JSON, another format, a table we don't know, rows that aren't rows) */
export function decode(body: string): CacheBody | null {
  let b: unknown
  try {
    b = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRow(b)) return null
  const { v, rows } = b as Partial<CacheBody>
  if (v !== CACHE_FORMAT || !isRow(rows)) return null
  for (const [t, list] of Object.entries(rows)) {
    if (!(LIVE_TABLES as readonly string[]).includes(t) || !Array.isArray(list) || !list.every(isRow)) return null
  }
  return b as unknown as CacheBody
}

/** the kept rows as inputs for applyRows (as if just read): people and teams first, to read easily */
export function inputsOf(body: CacheBody): Incoming[] {
  const order: LiveTable[] = ['profiles', 'teams', ...LIVE_TABLES.filter((t) => t !== 'profiles' && t !== 'teams')]
  return order.flatMap((table): Incoming[] => (body.rows[table]?.length ? [{ from: 'fetch', table, rows: body.rows[table] }] : []))
}

/** why a copy can't be used */
export type Unusable = 'format' | 'app' | 'schema' | 'project' | 'profile' | 'workspace' | 'no-mark' | 'too-old'

/** the copy's facts when it can be used, or why not */
export function check(meta: unknown, want: Wanted, now: number): { meta: CacheMeta } | { bad: Unusable } {
  if (!isRow(meta)) return { bad: 'format' }
  const m = meta as Partial<CacheMeta>
  if (m.v !== want.v) return { bad: 'format' }
  if (m.app !== want.app) return { bad: 'app' }
  if (m.schema !== want.schema) return { bad: 'schema' }
  if (m.project !== want.project) return { bad: 'project' }
  if (m.profileId !== want.profileId) return { bad: 'profile' }
  if (m.workspaceId !== want.workspaceId) return { bad: 'workspace' }
  if (typeof m.mark !== 'string' || micros(m.mark) === null) return { bad: 'no-mark' }
  if (typeof m.caughtUpAt !== 'number' || !Number.isFinite(m.caughtUpAt) || tooLongAgo(m.caughtUpAt, now, MAX_AGE_DAYS)) return { bad: 'too-old' }
  if (typeof m.chars !== 'number' || typeof m.archive !== 'boolean' || typeof m.savedAt !== 'number') return { bad: 'format' }
  return { meta: m as CacheMeta }
}

/**
 * Two tabs keep the same copy: the one already kept stays when it is further along (a later mark, or the same mark
 * last up to date more recently), so a tab that slept for days can't replace a fresh copy with one that reads it all
 * again. Otherwise the last one kept wins.
 */
export function keepStored(stored: unknown, next: CacheMeta, now: number): boolean {
  const s = check(stored, next, now)
  if (!('meta' in s)) return false
  const c = compareStamp(s.meta.mark, next.mark)
  return c > 0 || (c === 0 && s.meta.caughtUpAt > next.caughtUpAt)
}

/** inbox notes the copy has that aren't there any more (the inbox leaves no deletions behind): DELETEs for them */
export function inboxGone(kept: Iterable<string>, now: ReadonlySet<string>): Incoming[] {
  return [...kept].filter((id) => !now.has(id)).map((id): Incoming => ({ from: 'message', message: { table: 'inbox', op: 'DELETE', row: { id } } }))
}
