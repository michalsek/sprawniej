/**
 * Where the copies of workspaces are kept (cache.ts says what they hold): one IndexedDB database, `sprawniej-cache`,
 * with two entries per person and workspace, written together in one transaction: `m:…` the facts about the copy and
 * `b:…` its rows (a JSON string).
 *
 * Nothing here throws. When the browser won't keep anything (private windows, blocked storage, full disk), the app
 * just reads everything on every start, as it would without a copy.
 */
import { check, decode, keepStored, MAX_WORKSPACES, wanted, type CacheBody, type CacheId, type CacheMeta, type Unusable } from './cache'

const DB = 'sprawniej-cache'
const STORE = 'snapshots'
/** Safari can leave opening hanging */
const OPEN_WAIT = 1_500

/** what the copies are kept in (IndexedDB; tests give a pretend one) */
export interface CacheKV {
  getMany(keys: string[]): Promise<unknown[]>
  /** one transaction: reads meta[0]; when keep(old) says so, writes nothing ('kept'), otherwise puts both */
  putIf(meta: [string, CacheMeta], body: [string, string], keep: (old: unknown) => boolean): Promise<'written' | 'kept'>
  delMany(keys: string[]): Promise<void>
  /** every `m:` entry */
  metas(): Promise<[string, unknown][]>
  /** let go of the database (before deleting it) */
  close(): void
}

type Entry = { meta: CacheMeta; body: string }

const metaKey = (id: CacheId) => `m:${id.project}:${id.profileId}:${id.workspaceId}`
const bodyKey = (id: CacheId) => `b:${id.project}:${id.profileId}:${id.workspaceId}`
const both = (id: CacheId) => [metaKey(id), bodyKey(id)]

// ---------- IndexedDB ----------

const ask = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
  })

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error ?? new DOMException('The copy wasn’t kept', 'AbortError'))
  })

function idbKV(): CacheKV {
  let dbp: Promise<IDBDatabase> | undefined
  let current: IDBDatabase | undefined
  const open = (): Promise<IDBDatabase> =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      let late = false
      const timer = setTimeout(() => {
        late = true
        reject(new Error('IndexedDB took too long to open'))
      }, OPEN_WAIT)
      let req: IDBOpenDBRequest
      try {
        req = indexedDB.open(DB, 1)
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
        db.onversionchange = () => {
          db.close()
          dbp = current = undefined
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
      const old = await ask(s.get(meta[0]))
      const kept = keep(old)
      if (!kept) {
        s.put(meta[1], meta[0])
        s.put(body[1], body[0])
      }
      await finished
      return kept ? 'kept' : 'written'
    },
    async delMany(keys) {
      const { tx, s } = await store('readwrite')
      for (const k of keys) s.delete(k)
      await done(tx)
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

function getKV(): CacheKV | null {
  if (kv !== undefined) return kv
  kv = typeof indexedDB === 'undefined' ? null : idbKV()
  if (!kv) turnOff('blocked')
  return kv
}

/** where copies are kept now (null: nowhere) */
const usable = (): CacheKV | null => (stopped || off ? null : getKV())

/** the database the copies belong to: its host */
export function cacheProject(url: string | undefined = import.meta.env.VITE_SUPABASE_URL): string {
  try {
    return url ? new URL(url.trim()).host : ''
  } catch {
    return ''
  }
}

/** the kept copy, or why there is none ('blocked': the browser keeps nothing) */
export async function readCache(id: CacheId, now: number): Promise<{ meta: CacheMeta; body: CacheBody } | { miss: Unusable | 'none' | 'blocked' | 'broken' }> {
  const k = usable()
  if (!k) return { miss: 'blocked' }
  let meta: unknown, body: unknown
  try {
    ;[meta, body] = await k.getMany(both(id))
  } catch (e) {
    turnOff('blocked', e)
    return { miss: 'blocked' }
  }
  if (meta === undefined && body === undefined) return { miss: 'none' }
  const bad = check(meta, wanted(id), now)
  const decoded = !bad && typeof body === 'string' && body.length === (meta as CacheMeta).chars ? decode(body) : null
  if (!bad && decoded) return { meta: meta as CacheMeta, body: decoded }
  await k.delMany(both(id)).catch(() => {})
  return { miss: bad ?? 'broken' }
}

const isQuota = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')

/** after keeping one: copies of other people or databases go, and only this person's newest few stay */
async function evict(k: CacheKV, meta: CacheMeta) {
  const mine: { key: string; savedAt: number }[] = []
  const drop: string[] = []
  for (const [key, m] of await k.metas()) {
    const rest = key.slice(2)
    const other = !m || typeof m !== 'object' || (m as CacheMeta).project !== meta.project || (m as CacheMeta).profileId !== meta.profileId
    if (other) drop.push(key, `b:${rest}`)
    else mine.push({ key, savedAt: Number((m as CacheMeta).savedAt) || 0 })
  }
  mine.sort((a, b) => b.savedAt - a.savedAt)
  for (const { key } of mine.slice(MAX_WORKSPACES)) drop.push(key, `b:${key.slice(2)}`)
  if (drop.length) await k.delMany(drop)
}

/**
 * Keep a copy (the one already kept stays if it is further along, see keepStored). `smaller`: the copy without the
 * archive, tried once when the browser says it's full.
 */
export async function writeCache(entry: Entry, smaller?: () => Entry | null): Promise<'written' | 'kept' | 'off'> {
  const k = usable()
  if (!k) return 'off'
  const put = (e: Entry) => k.putIf([metaKey(e.meta), e.meta], [bodyKey(e.meta), e.body], (old) => keepStored(old, e.meta, Date.now()))
  try {
    const r = await put(entry)
    failures = 0
    await evict(k, entry.meta).catch(() => {})
    return r
  } catch (e) {
    if (stopped) return 'off'
    if (isQuota(e)) {
      // make room: every copy goes, then this one once more without the archive
      try {
        await k.delMany((await k.metas()).flatMap(([key]) => [key, `b:${key.slice(2)}`]))
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
    warnOnce('Sprawniej couldn’t keep a copy of your workspace.', e)
    if (++failures >= 3) off = 'failing'
    return 'off'
  }
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
      return gone ? [key, `b:${key.slice(2)}`] : []
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
export async function wipeCaches(): Promise<void> {
  stopped = true
  kv?.close()
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB)
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
