/**
 * Keeping the open workspace's copy in this browser (cache.ts says what a copy is, cacheStore.ts keeps it): a few
 * seconds after the database's rows change (never later than half a minute), at once when the tab is hidden or the
 * page goes, and before the workspace closes. A copy just like the last one kept isn't kept again; one that only got
 * up to date again just says so.
 *
 * The workspace (workspace.ts) says what there is to keep and when; the hooks do the keeping (browserCopy is the
 * real one, tests give pretend ones).
 */
import type { Incoming, LiveState, Mirror } from './apply'
import { encode, inputsOf, rowCount, type CacheId } from './cache'
import { cacheProject, cacheState, dropCache, readCache, touchCache, writeCache, writeCacheNow } from './cacheStore'

/** kept once nothing changed for this long… */
export const QUIET = 3_000
/** …and never later than this after a change */
export const MOST = 30_000
/** opening waits at most this long for the copy (a browser may take its time) */
export const READ_WAIT = 2_000
/** closing waits at most this long for the copy to be kept */
export const CLOSE_WAIT = 1_000

/** a copy of the workspace kept in this browser, as read back */
export interface KeptCopy {
  /** its rows, as inputs for applyRows */
  inputs: Incoming[]
  /** the raw database time the rows are complete up to */
  mark: string
  /** when this browser last had everything, by its own clock */
  caughtUpAt: number
  /** every archived issue is in it */
  archive: boolean
}

/** what there is to keep now */
export interface Snapshot {
  live: LiveState
  mark: string
  caughtUpAt: number
  archive: boolean
}

export interface Timers {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(t: unknown): void
}

const REAL: Timers = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) }

/** keeping the copy (browserCopy; tests give a pretend one) */
export interface CopyHooks {
  /** the copy, when there is one that can be used */
  read(): Promise<KeptCopy | null>
  /** keep this one; 'too-big': it can't be kept at all (its old copy went) */
  write(copy: Snapshot): Promise<'written' | 'kept' | 'off' | 'too-big'>
  /** keep it at once, the page is going (false: can't right now) */
  writeNow?(copy: Snapshot): boolean
  /** the copy kept with this mark was up to date again at `caughtUpAt` */
  touch?(mark: string, caughtUpAt: number): Promise<boolean>
  /** the workspace went (or its copy couldn't be used): so does its copy */
  drop(): Promise<void>
  /** tests: other waits, other timers */
  timing?: { quiet: number; most: number }
  timers?: Timers
}

export const NO_COPY: CopyHooks = { read: async () => null, write: async () => 'off', drop: async () => {} }

/** the copy, or null when there is none or it doesn't come within `ms` */
export function readCopy(hooks: CopyHooks, ms = READ_WAIT): Promise<KeptCopy | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)))
  return Promise.race([hooks.read().catch(() => null), late]).finally(() => clearTimeout(timer))
}

/** what a kept copy was made from (compared by identity: applyRows makes new objects only for what changed) */
export interface Shot {
  server: Mirror
  partial: LiveState['partial']
  mark: string
  caughtUpAt: number
  archive: boolean
}

export const shotOf = (s: Snapshot): Shot => ({ server: s.live.server, partial: s.live.partial, mark: s.mark, caughtUpAt: s.caughtUpAt, archive: s.archive })

/** 'same': nothing to keep; 'touch': only up to date again; 'new': keep it */
export function compareCopy(last: Shot | null, next: Shot): 'same' | 'touch' | 'new' {
  if (!last || last.server !== next.server || last.partial !== next.partial || last.mark !== next.mark || last.archive !== next.archive) return 'new'
  return last.caughtUpAt === next.caughtUpAt ? 'same' : 'touch'
}

/**
 * Keeping a while after things change: once nothing has changed for `quiet` ms, and never later than `most` ms after
 * the first change. One save at a time; a change during a save makes one more after it.
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
    this.timer = this.t.setTimeout(() => void this.saveNow(), wait)
  }

  /** keep it now; done once kept */
  saveNow(): Promise<void> {
    this.settle()
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

  /** what was waiting was kept another way (at once, as the page goes) */
  settle() {
    this.t.clearTimeout(this.timer)
    this.timer = undefined
    this.first = null
  }

  cancel() {
    this.stopped = true
    this.settle()
  }
}

/** one open workspace's copy: when to keep it, and what was kept last */
export class CopyKeeper {
  /** Date.now() when this tab last kept the copy (scripted checks read it) */
  keptAt: number | null = null
  /** too big to keep with this many rows: tried again only once it has fewer */
  private tooBig: number | null = null
  private dropped = false
  private last: Shot | null = null
  private hooks: CopyHooks
  private take: () => Snapshot | null
  private saver: Saver
  private t: Timers

  /** `take`: what there is to keep now, or null when nothing should be (still opening, closed) */
  constructor(hooks: CopyHooks, take: () => Snapshot | null) {
    this.hooks = hooks
    this.take = take
    this.t = hooks.timers ?? REAL
    const { quiet, most } = hooks.timing ?? { quiet: QUIET, most: MOST }
    this.saver = new Saver({ quiet, most, save: () => this.save() }, this.t)
  }

  /** why no copy is kept for this workspace, if that's about it */
  get reason(): 'too-big' | 'gone' | undefined {
    return this.dropped ? 'gone' : this.tooBig !== null ? 'too-big' : undefined
  }

  /** the rows changed: kept in a moment */
  poke() {
    if (!this.dropped) this.saver.poke()
  }

  /** opened from this copy: it is what was kept last */
  shown(s: Snapshot) {
    this.last = shotOf(s)
  }

  /** there is something to keep */
  wants(): boolean {
    const s = this.next()
    return !!s && compareCopy(this.last, shotOf(s)) !== 'same'
  }

  saveNow(): Promise<void> {
    return this.saver.saveNow()
  }

  /**
   * The page is going (hidden, or closing): kept at once. `fresh`: this tab is up to date, so its copy may be put
   * without comparing with what is kept (there's no time for that); otherwise as usual.
   */
  saveAtOnce(fresh: boolean): Promise<void> {
    const s = this.next()
    if (!s || !this.hooks.writeNow || !fresh) return this.saveNow()
    const shot = shotOf(s)
    if (compareCopy(this.last, shot) === 'same') return Promise.resolve()
    if (!this.hooks.writeNow(s)) return this.saveNow()
    this.saver.settle()
    this.kept(shot)
    return Promise.resolve()
  }

  /** closing: kept first, for up to a second */
  beforeClose(): Promise<void> {
    if (!this.wants()) return Promise.resolve()
    let timer: unknown
    const waited = new Promise<void>((resolve) => (timer = this.t.setTimeout(resolve, CLOSE_WAIT)))
    return Promise.race([this.saveNow(), waited]).then(() => this.t.clearTimeout(timer))
  }

  /** the copy just read couldn't be used: it goes (a new one is kept once everything is read) */
  discard() {
    this.last = null
    void this.hooks.drop().catch(() => {})
  }

  /** the workspace went: its copy goes, and none is kept again */
  drop() {
    if (this.dropped) return
    this.dropped = true
    this.saver.cancel()
    void this.hooks.drop().catch(() => {})
  }

  stop() {
    this.saver.cancel()
  }

  private next(): Snapshot | null {
    if (this.dropped) return null
    const s = this.take()
    if (!s) return null
    if (this.tooBig !== null) {
      if (rowCount(s.live.server) >= this.tooBig) return null
      this.tooBig = null
    }
    return s
  }

  private kept(shot: Shot) {
    this.last = shot
    this.keptAt = this.t.now()
  }

  private async save(): Promise<void> {
    const s = this.next()
    if (!s) return
    const shot = shotOf(s)
    const how = compareCopy(this.last, shot)
    if (how === 'same') return
    if (how === 'touch' && this.hooks.touch) {
      if (await this.hooks.touch(shot.mark, shot.caughtUpAt)) return this.kept(shot)
    }
    const r = await this.hooks.write(s)
    if (r === 'written' || r === 'kept') this.kept(shot)
    else if (r === 'too-big') this.tooBig = rowCount(s.live.server)
  }
}

/** why the last opening read everything (scripted checks read it) */
let lastMiss: string | null = null
export const lastCopyMiss = (): string | null => lastMiss

/** the real copy of one workspace in this browser, for one person; `signedIn`: nothing is kept for nobody */
export function browserCopy(workspaceId: string, profileId: string, signedIn: () => boolean): CopyHooks {
  const id: CacheId = { project: cacheProject(), profileId, workspaceId }
  const entryOf = (c: Snapshot, small = false) => encode(c.live, { id, mark: c.mark, caughtUpAt: c.caughtUpAt, archive: c.archive, now: Date.now(), small })
  const can = () => signedIn() && !cacheState().off
  return {
    async read() {
      const r = await readCache(id, Date.now())
      lastMiss = 'miss' in r ? r.miss : null
      if ('miss' in r) return null
      return { inputs: inputsOf(r.body), mark: r.meta.mark, caughtUpAt: r.meta.caughtUpAt, archive: r.meta.archive }
    },
    async write(c) {
      if (!can()) return 'off'
      const entry = entryOf(c)
      if (!entry) {
        await dropCache(id)
        return 'too-big'
      }
      const r = await writeCache(entry, () => entryOf(c, true))
      return r
    },
    writeNow(c) {
      if (!can()) return false
      const entry = entryOf(c)
      return !!entry && writeCacheNow(entry)
    },
    touch: (mark, caughtUpAt) => (can() ? touchCache(id, mark, caughtUpAt) : Promise.resolve(false)),
    drop: () => dropCache(id),
  }
}
