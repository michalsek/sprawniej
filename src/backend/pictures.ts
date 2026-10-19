/**
 * Pictures pasted into descriptions and comments. Each is kept once per workspace, under `<workspace id>/<name>`,
 * where the name comes from the picture's own bytes (src/data/assets.ts): the same picture pasted twice is one file,
 * and a file never changes. They are private, so showing one takes an address signed for a day; the addresses that
 * are needed together are asked for in one go, kept while the app is open, and signed again before they stop working.
 *
 * Everything it talks to comes in `PictureDeps`, so tests/pictures.test.ts needs no Supabase.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { getClient } from './client'
import type { Database } from './database.types'

export type PictureEntry =
  | { state: 'loading' }
  /**
   * `until`: when the address stops working (ms); `local`: the picture you added, shown from this browser;
   * `retryAt`: signing it again failed, so it isn't asked for again before then
   */
  | { state: 'ready'; url: string; until: number; local?: boolean; retryAt?: number }
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
export const SIGNED_FOR_S = 86_400
/** an address with less than this left is signed again */
export const RESIGN_BEFORE = 3_600_000
/** a picture that isn't there is asked for again after this */
export const MISSING_RETRY = 5 * 60_000
/** one that couldn't be asked for, after this */
export const FAILED_RETRY = 30_000
/** addresses asked for together */
export const CHUNK = 100
/** addresses wanted within this long are asked for in one go */
const GATHER = 30

export interface Pictures {
  /** the address to show `path` from, if there is one now; never changes the store while it's called */
  url(path: string): string | undefined
  /** when `url(path)` should be asked again (a retry, signing again, or the address running out); undefined: no need */
  nextCheck(path: string): number | undefined
  /** show a picture you're adding from this browser's own copy, at once */
  preview(path: string, file: Blob): void
  /** keep a picture; done once it's kept (or was already). If it can't be, its preview goes */
  add(path: string, file: Blob): Promise<void>
  /** switching workspace, signing out, removed from it: forget everything */
  clear(): void
}

export function makePictures(deps: PictureDeps, store: PicturesStore = create<PicturesState>()(() => ({ entries: {} }))): Pictures {
  const queue = new Set<string>()
  /** paths that are kept: no need to add them again */
  const known = new Set<string>()
  const inflight = new Map<string, Promise<'added' | 'there'>>()
  const blobs = new Map<string, string>()
  let scheduled = false
  /** a clear() in between makes answers that arrive afterwards count for nothing */
  let round = 0

  const entry = (path: string): PictureEntry | undefined => store.getState().entries[path]
  function set(patch: Record<string, PictureEntry>) {
    if (Object.keys(patch).length) store.setState((s) => ({ entries: { ...s.entries, ...patch } }))
  }
  const allowed = (retryAt: number | undefined) => retryAt === undefined || deps.now() >= retryAt

  /** paths being asked for right now: wanting one again waits for that answer */
  const asking = new Set<string>()

  function want(path: string) {
    if (asking.has(path)) return
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
    // a picture already showing keeps its address while a fresh one is asked for
    set(Object.fromEntries(paths.filter((p) => entry(p)?.state !== 'ready').map((p): [string, PictureEntry] => [p, { state: 'loading' }])))
    for (let i = 0; i < paths.length; i += CHUNK) {
      const chunk = paths.slice(i, i + CHUNK)
      let answers: { path: string; url: string | null }[]
      for (const p of chunk) asking.add(p)
      try {
        answers = await deps.sign(chunk)
      } catch (e) {
        for (const p of chunk) asking.delete(p)
        if (r !== round) return
        console.warn('Sprawniej couldn’t get pictures', e)
        const retryAt = deps.now() + FAILED_RETRY
        // one still showing keeps its address, and waits before it's signed again
        set(
          Object.fromEntries(
            chunk.map((p): [string, PictureEntry] => {
              const was = entry(p)
              return [p, was?.state === 'ready' ? { ...was, retryAt } : { state: 'failed', retryAt }]
            }),
          ),
        )
        continue
      }
      for (const p of chunk) asking.delete(p)
      if (r !== round) return
      const urls = new Map(answers.map((a) => [a.path, a.url]))
      const now = deps.now()
      const patch: Record<string, PictureEntry> = {}
      for (const p of chunk) {
        const url = urls.get(p)
        const e = entry(p)
        if (url) {
          known.add(p)
          patch[p] = { state: 'ready', url, until: now + SIGNED_FOR_S * 1000 }
        } else if (e?.state === 'ready' && e.until > now) {
          // no new address (you may have been removed): the one shown works until it runs out
          patch[p] = { ...e, retryAt: now + MISSING_RETRY }
        } else {
          patch[p] = { state: 'missing', retryAt: now + MISSING_RETRY }
        }
      }
      set(patch)
    }
  }

  deps.onOnline?.(() => {
    for (const [p, e] of Object.entries(store.getState().entries)) if (e.state === 'failed') want(p)
  })

  function url(path: string): string | undefined {
    const e = entry(path)
    if (!e) {
      want(path)
      return undefined
    }
    const now = deps.now()
    switch (e.state) {
      case 'ready':
        if (e.until - now < RESIGN_BEFORE && allowed(e.retryAt)) want(path)
        return e.until > now ? e.url : undefined
      case 'loading':
        return undefined
      case 'missing':
      case 'failed':
        if (allowed(e.retryAt)) want(path)
        return undefined
    }
  }

  function nextCheck(path: string): number | undefined {
    const e = entry(path)
    if (!e || e.state === 'loading' || (e.state === 'ready' && e.local)) return undefined
    if (e.state !== 'ready') return e.retryAt
    const now = deps.now()
    const resign = Math.max(e.until - RESIGN_BEFORE, e.retryAt ?? 0)
    const times = [resign, e.until].filter((t) => t > now)
    return times.length ? Math.min(...times) : e.retryAt
  }

  function preview(path: string, file: Blob) {
    if (entry(path)?.state === 'ready') return
    const local = (deps.objectUrl ?? URL.createObjectURL)(file)
    blobs.set(path, local)
    set({ [path]: { state: 'ready', url: local, until: Infinity, local: true } })
  }

  async function add(path: string, file: Blob): Promise<void> {
    if (known.has(path)) return
    // whoever adds it sees it from their own copy: no address to ask for
    preview(path, file)
    let going = inflight.get(path)
    if (!going) {
      going = deps.upload(path, file).finally(() => inflight.delete(path))
      inflight.set(path, going)
    }
    const r = round
    try {
      await going
    } catch (e) {
      if (r === round && !known.has(path)) unpreview(path)
      throw e
    }
    if (r === round) known.add(path)
  }

  /** the preview of a picture that couldn't be kept */
  function unpreview(path: string) {
    const blob = blobs.get(path)
    const e = entry(path)
    if (!blob || e?.state !== 'ready' || e.url !== blob) return
    ;(deps.revokeUrl ?? URL.revokeObjectURL)(blob)
    blobs.delete(path)
    store.setState((s) => {
      const { [path]: _gone, ...rest } = s.entries
      return { entries: rest }
    })
  }

  function clear() {
    round++
    for (const b of blobs.values()) (deps.revokeUrl ?? URL.revokeObjectURL)(b)
    blobs.clear()
    queue.clear()
    known.clear()
    inflight.clear()
    asking.clear()
    store.setState({ entries: {} })
  }

  return { url, nextCheck, preview, add, clear }
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

const BUCKET = 'pictures'

export function supabasePictureDeps(db: () => SupabaseClient<Database> | null): PictureDeps {
  return {
    async upload(path, file) {
      const client = db()
      if (!client) throw new PictureError('network')
      // the name is the picture's hash, so what's kept under it never changes: the browser may keep it for long
      const answer = await client.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' })
        .catch(() => {
          throw new PictureError('network')
        })
      if (!answer.error) return 'added'
      if (isAlreadyThere(answer.error)) return 'there'
      throw new PictureError(pictureProblem(answer.error))
    },
    async sign(paths) {
      const client = db()
      if (!client) throw new Error('not set up')
      const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, SIGNED_FOR_S)
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
