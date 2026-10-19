/**
 * The open workspace, kept up to date: opening it (listen first, then read everything, then apply what arrived
 * meanwhile), teammates' changes as they happen, and catching up after the connection dropped or the tab slept.
 * Everything goes into the store through applyRows.
 *
 * Opening and closing run one after the other (a chain), so a quick close and open of the same workspace never joins
 * a channel that is still leaving.
 *
 * Saving comes in phase 5: until then actions still change the store the old way, and nothing they do is saved.
 */
import { create } from 'zustand'
import { EMPTY, useData, type DataState } from '@/data/store'
import { applyRows, emptyLive, type Incoming, type LiveState, type StoreSlice } from './apply'
import { useAuth } from './auth'
import { keyString } from './changes'
import { getClient } from './client'
import { fetchByKeys, loadAll, loadArchived, loadChanged, loadTable, partsOf, planFetch, sinceMark, tooOld } from './load'
import { Channels, track, type ChannelStatus, type Topic, type Tracked } from './live'
import type { MyProfile } from './profiles'
import { registry } from './registry'
import { connectionState, resetStatus, useSaveStatus, type SaveStatus } from './status'
import type { LiveTable, Message } from './tables'

export type Phase = 'closed' | 'opening' | 'open' | 'failed' | 'gone'

export interface BackendState {
  phase: Phase
  workspaceId?: string
  /** why it didn't open: it isn't there for you, or the database can't be reached */
  failure?: 'gone' | 'network'
  /** why it closed while open: deleted by its owner, you were removed, or it just isn't there any more */
  gone?: 'deleted' | 'removed' | 'missing'
}

export const useBackend = create<BackendState>()(() => ({ phase: 'closed' }))

type Db = NonNullable<ReturnType<typeof getClient>>

const SLICE_KEYS = ['workspace', 'me', 'people', 'members', 'labels', 'teams', 'issues', 'archive', 'projects', 'views', 'comments', 'inbox', 'readState'] as const satisfies readonly (keyof StoreSlice)[]
const pick = (s: DataState): StoreSlice => Object.fromEntries(SLICE_KEYS.map((k) => [k, s[k]])) as unknown as StoreSlice

/** catching up failed: try again after these, then every 30 s */
const RETRY = [2_000, 5_000, 15_000, 30_000]
/** a row asked for isn't asked for again this soon (one that is gone or hidden would loop) */
const ASK_AGAIN = 30_000
/** after this long hidden, coming back catches up (the browser may have paused the connection) */
const SLEPT = 60_000

class LiveWorkspace {
  readonly workspaceId: string
  readonly me: MyProfile
  closed = false
  catchUps = 0
  live: LiveState = emptyLive()
  channels: Channels | null = null
  private db: Db
  /** messages that arrive while opening, applied after the first load */
  private held: Message[] | null = []
  private queue: Message[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private tracks: Record<Topic, Tracked> = { ws: { up: false, missed: false }, me: { up: false, missed: false } }
  /** a channel dropped while opening */
  private gapWhileOpening = false
  /** the mark from which messages may have been missed (null: none missed) */
  private floor: string | null = null
  private archive: 'none' | 'loading' | 'done' = 'none'
  private requested = new Map<string, number>()
  private toFetch: { table: LiveTable; key: Record<string, string> }[] = []
  private fetchTimer: ReturnType<typeof setTimeout> | undefined
  private catching: Promise<void> | null = null
  private again = false
  private failing = false
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private hiddenAt: number | null = null
  private stopAuth: (() => void) | undefined
  private wasSignedIn = true

  constructor(db: Db, workspaceId: string, me: MyProfile) {
    this.db = db
    this.workspaceId = workspaceId
    this.me = me
  }

  async open(): Promise<void> {
    registry.clear()
    useData.setState({ ...EMPTY, me: this.me.person })
    resetStatus()
    useSaveStatus.setState({ progress: 'Opening your workspace…', synced: false })
    useBackend.setState({ phase: 'opening', workspaceId: this.workspaceId, failure: undefined, gone: undefined })

    this.channels = this.newChannels()
    const joined = await this.channels.join()
    if (this.closed) return
    if (joined === 'denied' && !(await this.exists().catch(() => true))) return this.fail('gone')
    if (this.closed) return
    // not joined in time: they keep trying, and once they're in we catch up on what they missed
    for (const t of ['ws', 'me'] as const) if (!this.tracks[t].up) this.tracks[t] = { up: false, missed: true }

    let inputs: Incoming[]
    try {
      inputs = await loadAll(this.db, this.workspaceId, this.me.id, (progress) => !this.closed && useSaveStatus.setState({ progress }))
    } catch (e) {
      console.warn('Sprawniej couldn’t open the workspace', e)
      return this.fail('network')
    }
    if (this.closed) return
    if (inputs.some((i) => i.from === 'fetch' && i.table === 'workspaces' && i.rows.length === 0)) return this.fail('gone')

    const held = this.held ?? []
    this.held = null
    // a held delete may be older than what was just read (deleted, then made again): catching up settles it
    const catchUp = this.gapWhileOpening || this.tracks.ws.missed || this.tracks.me.missed || held.some((m) => m.op === 'DELETE' || m.op === 'catch_up')
    this.apply([...inputs, ...held.map((message): Incoming => ({ from: 'message', message }))])
    if (this.closed || useBackend.getState().phase !== 'opening') return
    useBackend.setState({ phase: 'open' })
    this.listen()
    this.refresh({ synced: true, progress: undefined })
    if (catchUp) void this.catchUp()
  }

  async close(): Promise<void> {
    this.closed = true
    clearTimeout(this.flushTimer)
    clearTimeout(this.fetchTimer)
    clearTimeout(this.retryTimer)
    this.unlisten()
    await this.channels?.close()
  }

  // ---------- channels ----------

  private newChannels(): Channels {
    const ch: Channels = new Channels(this.db, this.workspaceId, this.me.id, {
      message: (m) => this.onMessage(m),
      // channels left behind (after signing in again) say CLOSED as they go: that's no drop
      status: (t, s) => ch === this.channels && this.onStatus(t, s),
    })
    return ch
  }

  private onMessage(m: Message) {
    if (this.closed) return
    if (this.held) {
      this.held.push(m)
      return
    }
    // a burst (a deleted team's issues, say) is drawn once
    this.queue.push(m)
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined
      const q = this.queue
      this.queue = []
      this.apply(q.map((message): Incoming => ({ from: 'message', message })))
    }, 16)
  }

  private onStatus(t: Topic, s: ChannelStatus) {
    if (this.closed) return
    const r = track(this.tracks[t], s, this.channels?.closing ?? true)
    this.tracks[t] = r.next
    if (r.dropped) {
      if (this.held) this.gapWhileOpening = true
      this.gap()
    }
    if (r.back && !this.held) void this.catchUp()
    this.refresh()
  }

  /** messages may be missed from here on: catching up starts no later than this */
  private gap() {
    this.floor ??= this.live.mark
  }

  // ---------- the browser ----------

  private onOnline = () => {
    this.refresh()
    void this.catchUp()
  }

  private onOffline = () => {
    this.gap()
    this.refresh()
  }

  private onVisible = () => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now()
      this.gap()
      return
    }
    const slept = this.hiddenAt !== null && Date.now() - this.hiddenAt > SLEPT
    this.hiddenAt = null
    if (slept) void this.catchUp()
  }

  private listen() {
    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
    document.addEventListener('visibilitychange', this.onVisible)
    this.wasSignedIn = !!useAuth.getState().user
    this.stopAuth = useAuth.subscribe((a) => {
      const signedIn = !!a.user
      if (signedIn === this.wasSignedIn) return
      this.wasSignedIn = signedIn
      // signed out, the channels can't hear anything; signed in again (the same person), they start over
      if (!signedIn) this.gap()
      else void this.resume()
      this.refresh()
    })
  }

  private unlisten() {
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
    document.removeEventListener('visibilitychange', this.onVisible)
    this.stopAuth?.()
  }

  /** the chip, from the facts as they are now */
  private refresh(more: Partial<SaveStatus> = {}) {
    if (this.closed) return
    const phase = useBackend.getState().phase
    if (phase !== 'open' && !more.synced) return
    const state = connectionState(navigator.onLine, this.tracks.ws.up && this.tracks.me.up, !!useAuth.getState().user, this.failing)
    useSaveStatus.setState({ state, pending: 0, detail: undefined, ...more })
  }

  // ---------- applying ----------

  private apply(inputs: Incoming[]) {
    if (this.closed || !inputs.length) return
    const r = applyRows(this.live, pick(useData.getState()), inputs, { workspaceId: this.workspaceId, meId: this.me.id, registry })
    this.live = r.state
    if (Object.keys(r.patch).length) useData.setState(r.patch)
    if (r.workspaceGone) return this.goneAway('deleted')
    if (useData.getState().members[this.me.person.login]?.removedAt) return this.goneAway('removed')
    if (r.fetch.length) this.requestFetch(r.fetch)
    if (r.catchUp) void this.catchUp()
  }

  private requestFetch(reqs: { table: LiveTable; key: Record<string, string> }[]) {
    const now = Date.now()
    for (const r of reqs) {
      const k = `${r.table}:${keyString(r.table, r.key)}`
      const at = this.requested.get(k)
      if (at !== undefined && now - at < ASK_AGAIN) continue
      this.requested.set(k, now)
      this.toFetch.push(r)
    }
    if (this.toFetch.length) this.fetchTimer ??= setTimeout(() => void this.runFetch(), 50)
  }

  private async runFetch() {
    this.fetchTimer = undefined
    const reqs = this.toFetch
    this.toFetch = []
    // an issue that moved here or came back while we weren't looking: its labels and comments come too
    const known = this.live.server.issues
    const issuesNew = reqs.filter((r) => r.table === 'issues' && !known[r.key.id]).map((r) => r.key.id)
    try {
      const inputs = await fetchByKeys(this.db, this.workspaceId, planFetch(reqs), issuesNew)
      this.apply(inputs)
    } catch (e) {
      for (const r of reqs) this.requested.delete(`${r.table}:${keyString(r.table, r.key)}`)
      console.warn('Sprawniej couldn’t read some changes', e)
    }
  }

  // ---------- catching up ----------

  catchUp(): Promise<void> {
    if (this.closed || this.held) return Promise.resolve()
    if (this.catching) {
      this.again = true
      return this.catching
    }
    this.catching = (async () => {
      do {
        this.again = false
        if (!(await this.catchUpOnce())) break
      } while (this.again && !this.closed)
    })().finally(() => {
      this.catching = null
    })
    return this.catching
  }

  /** false when it failed (a retry is planned) */
  private async catchUpOnce(): Promise<boolean> {
    const from = this.floor ?? this.live.mark
    if (!from || tooOld(sinceMark(from), Date.now())) {
      void reopen(this)
      return true
    }
    const floor = this.floor
    try {
      const members = new Set(Object.values(this.live.server.workspace_members).map((m) => m.profile_id))
      const { inputs, full, gone } = await loadChanged(this.db, this.workspaceId, this.me.id, sinceMark(from), members)
      if (this.closed) return true
      if (gone) {
        this.goneAway('missing')
        return true
      }
      for (const t of full) inputs.push(...(await loadTable(this.db, this.workspaceId, this.me.id, t)))
      const known = this.live.server.issues
      const fresh = inputs.flatMap((i) => (i.from === 'fetch' && i.table === 'issues' ? i.rows.map((r) => String(r.id)).filter((id) => !known[id]) : []))
      if (fresh.length) inputs.push(...(await Promise.all(partsOf(this.db, this.workspaceId, fresh))))
      if (this.closed) return true
      this.apply(inputs)
      // a gap that opened while this ran stays for the next one
      if (this.floor === floor) this.floor = null
      this.failing = false
      this.retries = 0
      clearTimeout(this.retryTimer)
      this.catchUps++
      this.refresh({ caughtUpAt: Date.now() })
      return true
    } catch (e) {
      if (this.closed) return true
      console.warn('Sprawniej couldn’t catch up with teammates’ changes', e)
      this.failing = true
      this.refresh()
      clearTimeout(this.retryTimer)
      this.retryTimer = setTimeout(() => void this.catchUp(), RETRY[Math.min(this.retries++, RETRY.length - 1)])
      return false
    }
  }

  /** signed in again after "Please sign in again": fresh channels (the old ones lost their access), then catch up */
  async resume(): Promise<void> {
    if (this.closed || this.held) return
    this.gap()
    await this.channels?.close()
    if (this.closed) return
    this.tracks = { ws: { up: false, missed: true }, me: { up: false, missed: true } }
    this.channels = this.newChannels()
    this.refresh()
    await this.channels.join()
    await this.catchUp()
  }

  // ---------- the archive ----------

  loadArchive() {
    if (this.closed || this.held || this.archive !== 'none') return
    this.archive = 'loading'
    loadArchived(this.db, this.workspaceId).then(
      (inputs) => {
        if (this.closed) return
        this.apply(inputs)
        useData.setState({ archiveLoaded: true })
        this.archive = 'done'
      },
      (e: unknown) => {
        this.archive = 'none'
        console.warn('Sprawniej couldn’t read the archive', e)
      },
    )
  }

  // ---------- endings ----------

  private exists(): Promise<boolean> {
    return Promise.resolve(this.db.from('workspaces').select('id').eq('id', this.workspaceId)).then(({ data, error }) => {
      if (error) throw error
      return data.length > 0
    })
  }

  private fail(failure: 'gone' | 'network') {
    if (this.closed) return
    void this.close()
    useBackend.setState({ phase: 'failed', failure })
  }

  /** deleted or left while open: say so, and keep what's on screen until they choose another workspace */
  private goneAway(gone: 'deleted' | 'removed' | 'missing') {
    if (this.closed) return
    void this.close()
    useBackend.setState({ phase: 'gone', gone })
  }
}

// ---------- one open workspace at a time ----------

let current: LiveWorkspace | null = null
/** opening and closing, one after the other */
let chain: Promise<void> = Promise.resolve()
const queue = (job: () => Promise<void>): Promise<void> => (chain = chain.then(job, job))

function open(workspaceId: string, me: MyProfile): Promise<void> {
  return queue(async () => {
    const db = getClient()
    if (!db) return
    if (current) await closeNow()
    const ws = new LiveWorkspace(db, workspaceId, me)
    current = ws
    // opening isn't waited for here: a close that comes meanwhile marks it closed, and it stops at its next step
    void ws.open().catch((e: unknown) => console.warn('Sprawniej couldn’t open the workspace', e))
  })
}

async function closeNow() {
  const ws = current
  current = null
  if (!ws) return
  await ws.close()
  registry.clear()
  useBackend.setState({ phase: 'closed', workspaceId: undefined, failure: undefined, gone: undefined })
}

function close(): Promise<void> {
  return queue(closeNow)
}

/** read the whole workspace again (catching up from too far back) */
function reopen(ws: LiveWorkspace): Promise<void> {
  if (current !== ws) return Promise.resolve()
  return open(ws.workspaceId, ws.me)
}

const CLOSED_CHANNELS: Record<Topic, ChannelStatus> = { ws: 'CLOSED', me: 'CLOSED' }

export const backend = {
  open,
  close,
  /** read what changed since the last change we know of (scripted checks call it too) */
  catchUp: (): Promise<void> => current?.catchUp() ?? Promise.resolve(),
  /** archived issues into the store, once per opening */
  loadArchive: (): void => current?.loadArchive(),
  resume: (): Promise<void> => current?.resume() ?? Promise.resolve(),
  /** sends what's still waiting (phase 5) */
  flush: (): Promise<void> => Promise.resolve(),
  /** changes still waiting (phase 5) */
  pending: (): number => 0,
  /** for scripted checks */
  debug: () => ({
    phase: useBackend.getState().phase,
    workspaceId: current?.workspaceId ?? null,
    profileId: current?.me.id ?? null,
    mark: current?.live.mark ?? null,
    channels: current?.channels && !current.closed ? { ...current.channels.status } : { ...CLOSED_CHANNELS },
    catchUps: current?.catchUps ?? 0,
  }),
}

export const loadArchive = backend.loadArchive
