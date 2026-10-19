/**
 * Where the copies of workspaces are kept (cache.ts says what they hold): one IndexedDB database, `sprawniej-cache`,
 * with two entries per person and workspace, written together in one transaction: `m:…` the facts about the copy and
 * `b:…` its rows (a JSON string).
 *
 * Nothing here throws. When the browser won't keep anything (private windows, blocked storage, full disk, a database
 * that never opens), the app just reads everything on every start, as it would without a copy. Once a sign-out
 * anywhere deletes the database, nothing is kept again for the rest of the page.
 */
import { backendConfig } from './client'
import { check, decode, keepStored, MAX_WORKSPACES, wanted, type CacheBody, type CacheId, type CacheMeta, type Unusable } from './cache'

export const CACHE_DB = 'sprawniej-cache'
const STORE = 'snapshots'
/** Safari can leave opening hanging */
const OPEN_WAIT = 1_500
/** this tab's browser left opening hanging once: later loads in it don't wait again */
const SLOW_MARK = 'sprawniej:cache-hangs'

/** what the copies are kept in (IndexedDB; tests give a pretend one) */
export interface CacheKV {
  getMany(keys: string[]): Promise<unknown[]>
  /** one transaction: reads meta[0]; when keep(old) says so, writes nothing ('kept'), otherwise puts both */
  putIf(meta: [string, CacheMeta], body: [string, string], keep: (old: unknown) => boolean): Promise<'written' | 'kept'>
  /**
   * Both put at once, unchecked, in a transaction started right now (the page is going: there is no time for a round
   * trip). False when there is no open database to start it on.
   */
  putNow?(meta: [string, CacheMeta], body: [string, string]): boolean
  /** one transaction: reads key; `next(old)` gives what to put instead, or null for nothing */
  update(key: string, next: (old: unknown) => unknown): Promise<void>
  delMany(keys: string[]): Promise<void>
  /** every `m:` entry */
  metas(): Promise<[string, unknown][]>
  /** let go of the database (before deleting it) */
  close(): void
}

type Entry = { meta: CacheMeta; body: string }

const metaKey = (id: CacheId) => `m:${id.project}:${id.profileId}:${id.workspaceId}`
/** the body that goes with a meta key */
const pairOf = (key: string) => `b:${key.slice(2)}`
const both = (id: CacheId) => [metaKey(id), pairOf(metaKey(id))]

// ---------- IndexedDB ----------

const ask = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
  })

const done = (tx: IDBTransaction) => {
  const p = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error ?? new DOMException('The copy wasn’t kept', 'AbortError'))
  })
  // awaited later (or not at all, when a request fails first): never an unhandled rejection
  p.catch(() => {})
  return p
}

export class SlowOpen extends Error {}

/**
 * The copies in IndexedDB. `deleted`: the database was deleted from somewhere (a sign-out in another tab); this
 * connection lets go at once so the delete isn't blocked.
 */
export function idbKV(o: { factory?: IDBFactory; wait?: number; deleted?: () => void } = {}): CacheKV {
  const factory = o.factory ?? indexedDB
  const wait = o.wait ?? OPEN_WAIT
  let dbp: Promise<IDBDatabase> | undefined
  let current: IDBDatabase | undefined
  const open = (): Promise<IDBDatabase> =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      let late = false
      const timer = setTimeout(() => {
        late = true
        reject(new SlowOpen('IndexedDB took too long to open'))
      }, wait)
      let req: IDBOpenDBRequest
      try {
        req = factory.open(CACHE_DB, 1)
      } catch (e) {
        // private windows and sandboxed pages may refuse outright
        clearTimeout(timer)
        return reject(e instanceof Error ? e : new Error(String(e)))
      }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => {
        clearTimeout(timer)
        const db = req.result
        if (late) return db.close()
        // another tab deleting it (signing out) must not wait for this one
        db.onversionchange = (e) => {
          db.close()
          dbp = current = undefined
          if (e.newVersion === null) o.deleted?.()
        }
        db.onclose = () => {
          dbp = current = undefined
        }
        current = db
        resolve(db)
      }
      req.onerror = () => {
        clearTimeout(timer)
        reject(req.error ?? new Error('IndexedDB didn’t open'))
      }
    }).catch((e: unknown) => {
      dbp = undefined
      throw e
    }))
  const store = async (mode: IDBTransactionMode) => {
    const tx = (await open()).transaction(STORE, mode)
    return { tx, s: tx.objectStore(STORE) }
  }
  return {
    async getMany(keys) {
      const { s } = await store('readonly')
      return Promise.all(keys.map((k) => ask(s.get(k))))
    },
    async putIf(meta, body, keep) {
      const { tx, s } = await store('readwrite')
      const finished = done(tx)
      const kept = keep(await ask(s.get(meta[0])))
      if (!kept) {
        s.put(meta[1], meta[0])
        s.put(body[1], body[0])
      }
      await finished
      return kept ? 'kept' : 'written'
    },
    putNow(meta, body) {
      if (!current) return false
      try {
        const tx = current.transaction(STORE, 'readwrite')
        const s = tx.objectStore(STORE)
        s.put(meta[1], meta[0])
        s.put(body[1], body[0])
        void done(tx)
        return true
      } catch {
        return false
      }
    },
    async update(key, next) {
      const { tx, s } = await store('readwrite')
      const finished = done(tx)
      const v = next(await ask(s.get(key)))
      if (v !== null) s.put(v, key)
      await finished
    },
    async delMany(keys) {
      const { tx, s } = await store('readwrite')
      const finished = done(tx)
      for (const k of keys) s.delete(k)
      await finished
    },
    async metas() {
      const { s } = await store('readonly')
      const range = IDBKeyRange.bound('m:', 'm:\uffff')
      const [keys, values] = await Promise.all([ask(s.getAllKeys(range)), ask(s.getAll(range))])
      return keys.map((k, n): [string, unknown] => [String(k), values[n]])
    },
    close() {
      current?.close()
      dbp = current = undefined
    },
  }
}

// ---------- the copies ----------

let kv: CacheKV | null | undefined
let off: string | null = null
let stopped = false
let failures = 0
let warned = false

function warnOnce(text: string, e?: unknown) {
  if (warned) return
  warned = true
  console.warn(text, e)
}

function turnOff(reason: string, e?: unknown) {
  off = reason
  warnOnce('Sprawniej can’t keep a copy of your workspace in this browser, so it reads everything each time.', e)
}

const session = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function getKV(): CacheKV | null {
  if (kv !== undefined) return kv
  if (session()?.getItem(SLOW_MARK)) {
    off = 'slow'
    kv = null
    return kv
  }
  kv = typeof indexedDB === 'undefined' ? null : idbKV({ deleted: () => (stopped = true) })
  if (!kv) turnOff('blocked')
  return kv
}

/** where copies are kept now (null: nowhere) */
const usable = (): CacheKV | null => (stopped || off ? null : getKV())

/** the database the copies belong to: its host */
export function cacheProject(url: string | undefined = backendConfig()?.url): string {
  try {
    return url ? new URL(url.trim()).host : ''
  } catch {
    return ''
  }
}

/** opening failed: a hanging one is remembered for this tab's later loads too */
function failedToOpen(e: unknown) {
  if (e instanceof SlowOpen) {
    try {
      session()?.setItem(SLOW_MARK, '1')
    } catch {
      // only this load, then
    }
    return turnOff('slow', e)
  }
  turnOff('blocked', e)
}

/** the kept copy, or why there is none ('blocked'/'slow': the browser keeps nothing; 'stopped': signing out) */
export async function readCache(id: CacheId, now: number): Promise<{ meta: CacheMeta; body: CacheBody } | { miss: Unusable | 'none' | 'blocked' | 'slow' | 'stopped' | 'broken' }> {
  if (stopped) return { miss: 'stopped' }
  const k = usable()
  if (!k) return { miss: off === 'slow' ? 'slow' : 'blocked' }
  let meta: unknown, body: unknown
  try {
    ;[meta, body] = await k.getMany(both(id))
  } catch (e) {
    failedToOpen(e)
    return { miss: off === 'slow' ? 'slow' : 'blocked' }
  }
  if (meta === undefined && body === undefined) return { miss: 'none' }
  const c = check(meta, wanted(id), now)
  const decoded = 'meta' in c && typeof body === 'string' && body.length === c.meta.chars ? decode(body) : null
  if ('meta' in c && decoded) return { meta: c.meta, body: decoded }
  await k.delMany(both(id)).catch(() => {})
  return { miss: 'bad' in c ? c.bad : 'broken' }
}

const isQuota = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')

/** after keeping one: copies of other people or databases go, and only this person's newest few stay */
async function evict(k: CacheKV, meta: CacheMeta) {
  const mine: { key: string; savedAt: number }[] = []
  const drop: string[] = []
  for (const [key, m] of await k.metas()) {
    const other = !m || typeof m !== 'object' || (m as CacheMeta).project !== meta.project || (m as CacheMeta).profileId !== meta.profileId
    if (other) drop.push(key, pairOf(key))
    else mine.push({ key, savedAt: Number((m as CacheMeta).savedAt) || 0 })
  }
  mine.sort((a, b) => b.savedAt - a.savedAt)
  for (const { key } of mine.slice(MAX_WORKSPACES)) drop.push(key, pairOf(key))
  if (drop.length) await k.delMany(drop)
}

/**
 * Keep a copy (the one already kept stays if it is further along, see keepStored). `smaller`: the copy without the
 * archive, tried once when the browser says it's full.
 */
export async function writeCache(entry: Entry, smaller?: () => Entry | null): Promise<'written' | 'kept' | 'off'> {
  const k = usable()
  if (!k) return 'off'
  // checked again inside the transaction: a sign-out may have deleted everything meanwhile
  const put = (e: Entry) => k.putIf([metaKey(e.meta), e.meta], [pairOf(metaKey(e.meta)), e.body], (old) => stopped || keepStored(old, e.meta, Date.now()))
  try {
    const r = await put(entry)
    failures = 0
    if (stopped) return 'off'
    await evict(k, entry.meta).catch(() => {})
    return r
  } catch (e) {
    if (stopped) return 'off'
    if (isQuota(e)) {
      // make room: every copy goes, then this one once more without the archive
      try {
        await k.delMany((await k.metas()).flatMap(([key]) => [key, pairOf(key)]))
        const s = smaller?.()
        if (s) {
          const r = await put(s)
          failures = 0
          return r
        }
      } catch {
        // full even so
      }
      turnOff('quota', e)
      return 'off'
    }
    if (e instanceof SlowOpen) {
      failedToOpen(e)
      return 'off'
    }
    warnOnce('Sprawniej couldn’t keep a copy of your workspace.', e)
    if (++failures >= 3) off = 'failing'
    return 'off'
  }
}

/**
 * The page is going: the copy is put at once, unchecked (a tab that is up to date has nothing older to give). False
 * when that can't be done right now; then writeCache is the way.
 */
export function writeCacheNow(entry: Entry): boolean {
  const k = usable()
  if (!k?.putNow) return false
  return k.putNow([metaKey(entry.meta), entry.meta], [pairOf(metaKey(entry.meta)), entry.body])
}

/**
 * Nothing changed but this browser was up to date again: the kept copy says so (when it is the same copy, complete up
 * to the same mark), without writing its rows again.
 */
export async function touchCache(id: CacheId, mark: string, caughtUpAt: number): Promise<boolean> {
  const k = usable()
  if (!k) return false
  let touched = false
  try {
    await k.update(metaKey(id), (old) => {
      const c = check(old, wanted(id), Date.now())
      if (stopped || !('meta' in c) || c.meta.mark !== mark || c.meta.caughtUpAt >= caughtUpAt) return null
      touched = true
      return { ...c.meta, caughtUpAt }
    })
  } catch {
    return false
  }
  return touched
}

/** the workspace went (deleted, or you left): its copy goes too */
export async function dropCache(id: CacheId): Promise<void> {
  const k = stopped ? null : getKV()
  await k?.delMany(both(id)).catch(() => {})
}

/** after the list of your workspaces is read: copies of the ones you're no longer in go */
export async function pruneCaches(profileId: string, keepWorkspaces: readonly string[], project = cacheProject()): Promise<void> {
  const k = usable()
  if (!k) return
  try {
    const keep = new Set(keepWorkspaces)
    const drop = (await k.metas()).flatMap(([key, m]) => {
      const meta = m as Partial<CacheMeta> | undefined
      const gone = meta?.project === project && meta.profileId === profileId && !keep.has(String(meta.workspaceId))
      return gone ? [key, pairOf(key)] : []
    })
    if (drop.length) await k.delMany(drop)
  } catch {
    // tried again next time the list is read
  }
}

/** nothing is read or kept for the rest of this page (signing out, or someone else signing in) */
export function stopCaching(): void {
  stopped = true
}

/** signing out: every copy goes from this browser (other tabs let go of the database when asked) */
export async function wipeCaches(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<void> {
  stopped = true
  kv?.close()
  if (!factory) return
  await new Promise<void>((resolve) => {
    try {
      const req = factory.deleteDatabase(CACHE_DB)
      // blocked: it goes as soon as the other tabs let go
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** for scripted checks: whether copies are kept, and if not why */
export const cacheState = (): { off: boolean; reason?: string } => (stopped ? { off: true, reason: 'stopped' } : off ? { off: true, reason: off } : { off: false })

/** tests: a pretend store (null: none), and everything as at the start */
export function setCacheKV(next: CacheKV | null | undefined): void {
  kv = next
  off = null
  stopped = false
  failures = 0
  warned = false
}
