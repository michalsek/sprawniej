/**
 * Pictures pasted into descriptions and comments. Each is kept once per workspace, under `<workspace id>/<name>`,
 * where the name comes from the picture's own bytes (src/data/assets.ts): the same picture pasted twice is one file,
 * and a file never changes. They are private, so showing one takes an address signed for a day; the addresses that
 * are needed together are asked for in one go, and kept while the app is open.
 *
 * Everything it talks to comes in `PictureDeps`, so tests/pictures.test.ts needs no Supabase.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { getClient } from './client'
import type { Database } from './database.types'

export type PictureEntry =
  | { state: 'loading' }
  /** `until`: when the address stops working (ms); `local`: the picture you added, shown from this browser */
  | { state: 'ready'; url: string; until: number; local?: boolean }
  | { state: 'missing'; retryAt: number }
  | { state: 'failed'; retryAt: number }

export interface PicturesState {
  /** by path, `<workspace id>/<name>` */
  entries: Record<string, PictureEntry>
}

export type PicturesStore = UseBoundStore<StoreApi<PicturesState>>

export const usePictures: PicturesStore = create<PicturesState>()(() => ({ entries: {} }))

/** why a picture couldn't be added */
export type PictureProblem = 'too-big' | 'wrong-type' | 'refused' | 'signed-out' | 'network'

export class PictureError extends Error {
  readonly kind: PictureProblem
  constructor(kind: PictureProblem) {
    super(kind)
    this.kind = kind
  }
}

export interface PictureDeps {
  /** signed addresses for these paths, null for one that isn't there (or isn't yours); throws when it can't ask */
  sign(paths: string[]): Promise<{ path: string; url: string | null }[]>
  /** 'there': it was already kept; throws a PictureError */
  upload(path: string, file: Blob): Promise<'added' | 'there'>
  now(): number
  later(fn: () => void, ms: number): void
  objectUrl?(file: Blob): string
  revokeUrl?(url: string): void
  /** calls `fn` whenever the browser is back online */
  onOnline?(fn: () => void): void
}

/** how long a signed address works, in seconds */
export const DAY = 86_400
/** an address with less than this left is signed again */
export const RESIGN_BEFORE = 3_600_000
/** a picture that isn't there is asked for again after this */
export const MISSING_RETRY = 5 * 60_000
/** one that couldn't be asked for, after this */
export const FAILED_RETRY = 30_000
/** addresses asked for together */
const CHUNK = 100
/** addresses wanted within this long are asked for in one go */
const GATHER = 30

export interface Pictures {
  store: PicturesStore
  /** the address to show `path` from, if there is one yet; never changes the store while it's called */
  url(path: string): string | undefined
  /** keep a picture; done once it's kept (or was already) */
  add(path: string, file: Blob): Promise<void>
  /** switching workspace, signing out: forget everything */
  clear(): void
}

export function makePictures(deps: PictureDeps, store: PicturesStore = create<PicturesState>()(() => ({ entries: {} }))): Pictures {
  const queue = new Set<string>()
  /** paths that are kept: no need to add them again */
  const known = new Set<string>()
  const inflight = new Map<string, Promise<'added' | 'there'>>()
  const blobs = new Set<string>()
  let scheduled = false
  /** a clear() in between makes answers that arrive afterwards count for nothing */
  let round = 0

  const set = (patch: Record<string, PictureEntry>) => store.setState((s) => ({ entries: { ...s.entries, ...patch } }))

  function want(path: string) {
    queue.add(path)
    if (scheduled) return
    scheduled = true
    deps.later(() => void flush(), GATHER)
  }

  async function flush() {
    scheduled = false
    const paths = [...queue]
    queue.clear()
    if (!paths.length) return
    const r = round
    const entries = store.getState().entries
    // a picture already showing keeps its address while a fresh one is asked for
    const waiting = Object.fromEntries(paths.filter((p) => entries[p]?.state !== 'ready').map((p) => [p, { state: 'loading' } as PictureEntry]))
    if (Object.keys(waiting).length) set(waiting)
    for (let i = 0; i < paths.length; i += CHUNK) {
      const chunk = paths.slice(i, i + CHUNK)
      try {
        const answers = await deps.sign(chunk)
        if (r !== round) return
        const urls = new Map(answers.map((a) => [a.path, a.url]))
        const now = deps.now()
        const patch: Record<string, PictureEntry> = {}
        for (const p of chunk) {
          const url = urls.get(p)
          if (url) {
            known.add(p)
            patch[p] = { state: 'ready', url, until: now + DAY * 1000 }
          } else if (store.getState().entries[p]?.state !== 'ready') {
            patch[p] = { state: 'missing', retryAt: now + MISSING_RETRY }
          }
        }
        set(patch)
      } catch (e) {
        if (r !== round) return
        console.warn('Sprawniej couldn’t get pictures', e)
        const retryAt = deps.now() + FAILED_RETRY
        const now = store.getState().entries
        set(Object.fromEntries(chunk.filter((p) => now[p]?.state !== 'ready').map((p) => [p, { state: 'failed', retryAt } as PictureEntry])))
      }
    }
  }

  deps.onOnline?.(() => {
    for (const [p, e] of Object.entries(store.getState().entries)) if (e.state === 'failed') want(p)
  })

  function url(path: string): string | undefined {
    const e = store.getState().entries[path]
    if (!e) {
      want(path)
      return undefined
    }
    switch (e.state) {
      case 'ready':
        if (e.until - deps.now() < RESIGN_BEFORE) want(path)
        return e.url
      case 'loading':
        return undefined
      case 'missing':
      case 'failed':
        if (deps.now() >= e.retryAt) want(path)
        return undefined
    }
  }

  async function add(path: string, file: Blob): Promise<void> {
    if (known.has(path)) return
    let going = inflight.get(path)
    if (!going) {
      going = deps.upload(path, file).finally(() => inflight.delete(path))
      inflight.set(path, going)
    }
    const r = round
    await going
    if (r !== round) return
    known.add(path)
    if (store.getState().entries[path]?.state === 'ready') return
    // whoever added it sees it from their own copy: no address to ask for
    const local = (deps.objectUrl ?? URL.createObjectURL)(file)
    blobs.add(local)
    set({ [path]: { state: 'ready', url: local, until: Infinity, local: true } })
  }

  function clear() {
    round++
    for (const b of blobs) (deps.revokeUrl ?? URL.revokeObjectURL)(b)
    blobs.clear()
    queue.clear()
    known.clear()
    inflight.clear()
    store.setState({ entries: {} })
  }

  return { store, url, add, clear }
}

// ---------- the real thing ----------

interface StorageErrorLike {
  name?: string
  message?: string
  status?: number
  statusCode?: string | number
}

/** the picture is already kept: the storage answers 409, or 400 with "409" in its body */
export function isAlreadyThere(e: StorageErrorLike): boolean {
  return e.status === 409 || String(e.statusCode) === '409' || /already exists|duplicate/i.test(e.message ?? '')
}

/** what went wrong when keeping a picture */
export function pictureProblem(e: StorageErrorLike): PictureProblem {
  const code = String(e.statusCode ?? '')
  const message = e.message ?? ''
  if (e.status === 413 || code === '413' || /maximum allowed size|too large/i.test(message)) return 'too-big'
  if (e.status === 415 || code === '415' || /mime/i.test(message)) return 'wrong-type'
  if (e.status === 401 || code === '401') return 'signed-out'
  if (e.status === 403 || code === '403' || /row-level security|unauthorized/i.test(message)) return 'refused'
  return 'network'
}

const PICTURES = 'pictures'

export function supabasePictureDeps(db: () => SupabaseClient<Database> | null): PictureDeps {
  return {
    async upload(path, file) {
      const client = db()
      if (!client) throw new PictureError('network')
      let answer: Awaited<ReturnType<ReturnType<SupabaseClient<Database>['storage']['from']>['upload']>>
      try {
        // the name is the picture's hash, so what's kept under it never changes: the browser may keep it for long
        answer = await client.storage.from(PICTURES).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' })
      } catch {
        throw new PictureError('network')
      }
      if (!answer.error) return 'added'
      if (isAlreadyThere(answer.error)) return 'there'
      throw new PictureError(pictureProblem(answer.error))
    },
    async sign(paths) {
      const client = db()
      if (!client) throw new Error('not set up')
      const { data, error } = await client.storage.from(PICTURES).createSignedUrls(paths, DAY)
      if (error) throw error
      return data.map((d, i) => ({ path: d.path ?? paths[i], url: d.error ? null : d.signedUrl }))
    },
    now: () => Date.now(),
    later: (fn, ms) => void setTimeout(fn, ms),
    onOnline: (fn) => {
      if (typeof window !== 'undefined') window.addEventListener('online', fn)
    },
  }
}

/** the app's pictures */
export const pictures: Pictures = makePictures(supabasePictureDeps(getClient), usePictures)
