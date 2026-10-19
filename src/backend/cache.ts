/**
 * The copy of a workspace this browser keeps between visits (the read cache), as plain data: what goes in it, when it
 * can be used again, and making it smaller. Opening shows the copy at once and then reads only what changed since it
 * (workspace.ts); cacheStore.ts keeps it in IndexedDB.
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
import { compareStamp, micros } from './rows'
import { tooLongAgo } from './load'
import { LIVE_TABLES, type LiveTable } from './tables'

/** bump when CacheBody or CacheMeta change shape */
export const CACHE_FORMAT = 1
/** the newest migration: a copy made for another database layout is never read (a test checks it) */
export const SCHEMA_ID = '20261019000008'
/** a copy longer than this (JSON characters) leaves the archive out, and if it's still too long it isn't kept */
export const MAX_CHARS = 20_000_000
/** workspaces kept per browser */
export const MAX_WORKSPACES = 3
/** deletions are kept 45 days: a copy last up to date longer ago than this could miss some */
export const MAX_AGE_DAYS = 44

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
export const wanted = (id: CacheId): Pick<CacheMeta, 'v' | 'app' | 'schema' | keyof CacheId> => ({ v: CACHE_FORMAT, app: APP_VERSION, schema: SCHEMA_ID, ...id })

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

/** the copy without archived issues and what belongs to them */
export function shrink(rows: CacheBody['rows']): CacheBody['rows'] {
  const archived = new Set((rows.issues ?? []).filter((r) => r.archived_at != null).map((r) => String(r.id)))
  if (!archived.size) return rows
  const out = { ...rows, issues: rows.issues?.filter((r) => !archived.has(String(r.id))) }
  for (const t of ['issue_labels', 'issue_followers', 'comments'] as const) if (rows[t]) out[t] = rows[t].filter((r) => !archived.has(String(r.issue_id)))
  return out
}

/** the copy to keep: null when it's too big even without the archive */
export function encode(
  live: Pick<LiveState, 'server' | 'partial'>,
  o: { id: CacheId; mark: string; caughtUpAt: number; archive: boolean; now: number; max?: number; small?: boolean },
): { meta: CacheMeta; body: string } | null {
  const max = o.max ?? MAX_CHARS
  let rows = rowsOf(live)
  let archive = o.archive
  let body = o.small ? '' : JSON.stringify({ v: CACHE_FORMAT, rows } satisfies CacheBody)
  // `small`: without the archive from the start (the browser said it's full)
  if (o.small || body.length > max) {
    rows = shrink(rows)
    archive = false
    body = JSON.stringify({ v: CACHE_FORMAT, rows } satisfies CacheBody)
    if (body.length > max) return null
  }
  const meta: CacheMeta = { ...wanted(o.id), mark: o.mark, caughtUpAt: o.caughtUpAt, savedAt: o.now, chars: body.length, archive }
  return { meta, body }
}

/** a body as kept, or null when it can't be read */
export function decode(body: string): CacheBody | null {
  try {
    const b = JSON.parse(body) as unknown
    if (!b || typeof b !== 'object') return null
    const { v, rows } = b as Partial<CacheBody>
    if (v !== CACHE_FORMAT || !rows || typeof rows !== 'object') return null
    for (const [t, list] of Object.entries(rows)) if (!(LIVE_TABLES as readonly string[]).includes(t) || !Array.isArray(list)) return null
    return b as CacheBody
  } catch {
    return null
  }
}

/** the kept rows as inputs for applyRows (as if just read): people and teams first, to read easily */
export function inputsOf(body: CacheBody): Incoming[] {
  const order: LiveTable[] = ['profiles', 'teams', ...LIVE_TABLES.filter((t) => t !== 'profiles' && t !== 'teams')]
  return order.flatMap((table): Incoming[] => (body.rows[table]?.length ? [{ from: 'fetch', table, rows: body.rows[table] }] : []))
}

/** why a copy can't be used */
export type Unusable = 'format' | 'app' | 'schema' | 'project' | 'profile' | 'workspace' | 'no-mark' | 'too-old'

/** null when the copy can be used */
export function check(meta: unknown, want: ReturnType<typeof wanted>, now: number): Unusable | null {
  if (!meta || typeof meta !== 'object') return 'format'
  const m = meta as Partial<CacheMeta>
  if (m.v !== want.v) return 'format'
  if (m.app !== want.app) return 'app'
  if (m.schema !== want.schema) return 'schema'
  if (m.project !== want.project) return 'project'
  if (m.profileId !== want.profileId) return 'profile'
  if (m.workspaceId !== want.workspaceId) return 'workspace'
  if (typeof m.mark !== 'string' || micros(m.mark) === null) return 'no-mark'
  if (typeof m.caughtUpAt !== 'number' || !Number.isFinite(m.caughtUpAt) || tooLongAgo(m.caughtUpAt, now, MAX_AGE_DAYS)) return 'too-old'
  return null
}

/**
 * Two tabs keep the same copy: the one already kept stays when it is further along (a later mark, or the same mark
 * last up to date more recently), so a tab that slept for days can't replace a fresh copy with one that reads it all
 * again. Otherwise the last one kept wins.
 */
export function keepStored(stored: unknown, next: CacheMeta, now: number): boolean {
  if (check(stored, next, now)) return false
  const s = stored as CacheMeta
  const c = compareStamp(s.mark, next.mark)
  return c > 0 || (c === 0 && s.caughtUpAt > next.caughtUpAt)
}

/** inbox notes the copy has that aren't there any more (the inbox leaves no deletions behind): DELETEs for them */
export function inboxGone(kept: Iterable<string>, now: ReadonlySet<string>): Incoming[] {
  return [...kept].filter((id) => !now.has(id)).map((id): Incoming => ({ from: 'message', message: { table: 'inbox', op: 'DELETE', row: { id } } }))
}

interface Timers {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(t: unknown): void
}

const REAL: Timers = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) }

/**
 * Keeping the copy a while after things change: once nothing has changed for `quiet` ms, and never later than `most`
 * ms after the first change. One save at a time; a change during a save makes one more after it.
 */
export class Saver {
  private o: { quiet: number; most: number; save: () => Promise<void> }
  private t: Timers
  private timer: unknown
  private first: number | null = null
  private running: Promise<void> | null = null
  private again = false
  private stopped = false

  constructor(o: { quiet: number; most: number; save: () => Promise<void> }, timers: Timers = REAL) {
    this.o = o
    this.t = timers
  }

  poke() {
    if (this.stopped) return
    const at = this.t.now()
    this.first ??= at
    this.t.clearTimeout(this.timer)
    const wait = Math.max(0, Math.min(this.o.quiet, this.first + this.o.most - at))
    this.timer = this.t.setTimeout(() => void this.now(), wait)
  }

  /** keep it now (the tab is being hidden or closed); done once kept */
  now(): Promise<void> {
    this.t.clearTimeout(this.timer)
    this.timer = undefined
    this.first = null
    if (this.stopped) return Promise.resolve()
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        await this.o.save().catch((e: unknown) => console.warn('Sprawniej couldn’t keep a copy of the workspace', e))
      } while (this.again && !this.stopped)
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  cancel() {
    this.stopped = true
    this.t.clearTimeout(this.timer)
    this.timer = undefined
  }
}
