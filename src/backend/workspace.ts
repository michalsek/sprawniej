/**
 * The open workspace, kept up to date: opening it (listen first, then read everything, then apply what arrived
 * meanwhile), teammates' changes as they happen, and catching up after the connection dropped or the tab slept.
 * Everything goes into the store through applyRows.
 *
 * Your own changes are saved by the writer (writes.ts), which shows them on the open workspace: it attaches once the
 * workspace is open, stays while the workspace is read again from the start, and stops when it closes.
 *
 * A copy of the workspace kept in this browser (keep.ts, cache.ts) makes opening quick: it shows at once, and then
 * only what changed since it is read.
 *
 * Everything it talks to (the database, the channels, the browser, the stores, the writer) comes in an env, so tests
 * can give it pretend ones; index.ts gives it the real ones.
 */
import type { StoreApi } from 'zustand'
import { EMPTY, type DataState } from '@/data/store'
import { applyRows, emptyLive, type Incoming, type LiveState, type Mirror, type StoreSlice } from './apply'
import { cacheMark, inboxGone } from './cache'
import type { ConnectionEvents } from './connection'
import { RowFetcher, type Asked } from './fetching'
import { isMessage, track, type ChannelEvents, type ChannelsLike, type ChannelStatus, type Topic, type Tracked } from './live'
import { CopyKeeper, NO_COPY, readCopy, type CopyHooks, type KeptCopy, type Snapshot } from './keep'
import { planFetch, sinceMark, type Reader } from './load'
import { tooLongAgo } from './rows'
import type { MyProfile } from './profiles'
import type { Registry } from './registry'
import { chipState, type SaveStatus } from './status'
import type { LiveTable, Message } from './tables'
import type { WriteTarget } from './writes'

export type Phase = 'closed' | 'opening' | 'open' | 'failed' | 'gone'

export interface BackendState {
  phase: Phase
  workspaceId?: string
  /** why it didn't open: it isn't there for you, or Sprawniej can't be reached */
  failure?: 'gone' | 'network'
  /** why it closed while open: deleted by its owner, you were removed, or it just isn't there any more */
  gone?: 'deleted' | 'removed' | 'missing'
}

export interface Delays {
  /** messages that arrive together are applied together */
  flush: number
  /** rows asked for are gathered this long */
  fetch: number
  /** a row isn't asked for again sooner (one that is gone or hidden would loop) */
  askAgain: number
  /** after a failure, try again after these, then every last one */
  retry: readonly number[]
  /** after this long hidden, coming back catches up (the browser may have paused the connection) */
  slept: number
  /** a deleted team or project: catch up this long after, for whatever of its many rows' messages didn't come */
  cascade: number
}

export const DELAYS: Delays = { flush: 16, fetch: 50, askAgain: 30_000, retry: [2_000, 5_000, 15_000, 30_000], slept: 60_000, cascade: 3_000 }

/** what an open workspace needs from the writer (writes.ts) */
export interface WritesHooks {
  /** open: your changes show on this workspace (what's still unsaved shows again) */
  attach(target: WriteTarget): void
  /** read again from the start: keep sending, show nothing until the next attach */
  detach(): void
  /** closing for good: send what's waiting for up to `ms`, then stop */
  finish(ms: number): Promise<void>
  /** the workspace went away: stop at once, quietly */
  stop(): void
  status(): { pending: number; waiting: boolean }
}

export const NO_WRITES: WritesHooks = {
  attach: () => {},
  detach: () => {},
  finish: () => Promise.resolve(),
  stop: () => {},
  status: () => ({ pending: 0, waiting: false }),
}

type Store<T> = Pick<StoreApi<T>, 'getState' | 'setState'>

export interface WorkspaceEnv {
  reader: Reader
  channels(on: ChannelEvents): ChannelsLike
  data: Store<DataState>
  status: Store<SaveStatus>
  backend: Store<BackendState>
  registry: Registry
  online(): boolean
  signedIn(): boolean
  /** starts listening to the browser and the sign-in; returns the function that stops */
  watch(on: ConnectionEvents): () => void
  /** read the whole workspace again (catching up from too far back) */
  reopen(): void
  delays: Delays
  writes: WritesHooks
  /** the time here (Date.now; tests give their own) */
  now?: () => number
  /** the copy kept in this browser (none when not given) */
  copy?: CopyHooks
}

const slice = (s: DataState): StoreSlice => ({
  workspace: s.workspace,
  me: s.me,
  people: s.people,
  members: s.members,
  labels: s.labels,
  teams: s.teams,
  issues: s.issues,
  archive: s.archive,
  projects: s.projects,
  views: s.views,
  comments: s.comments,
  inbox: s.inbox,
  readState: s.readState,
})

/** the keys asked for, by table, as an answer that brought none of them (so they may be asked for again) */
function noAnswer(reqs: readonly Asked[]): Incoming[] {
  const byTable = new Map<LiveTable, Record<string, string>[]>()
  for (const r of reqs) byTable.set(r.table, [...(byTable.get(r.table) ?? []), r.key])
  return [...byTable].map(([table, keys]): Incoming => ({ from: 'fetch', table, rows: [], keys }))
}

export class LiveWorkspace implements WriteTarget {
  readonly workspaceId: string
  readonly me: MyProfile
  closed = false
  /** you are leaving it yourself (backend.leave) */
  leaving = false
  catchUps = 0
  live: LiveState = emptyLive()
  channels: ChannelsLike | null = null
  private env: WorkspaceEnv
  private fetcher: RowFetcher
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
  private archiveTries = 0
  private archiveTimer: ReturnType<typeof setTimeout> | undefined
  /** rows whose fetch failed: asked for again after the next catch-up */
  private refetch: Asked[] = []
  private catching: Promise<void> | null = null
  private again = false
  private resuming: Promise<void> | null = null
  private failing = false
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private cascadeTimer: ReturnType<typeof setTimeout> | undefined
  /** when this browser last had everything (the first read, or a catch-up that worked), by its own clock */
  private caughtUpAt = 0
  private unwatch: (() => void) | undefined
  /** where what's on screen came from: the copy kept here, or reading everything */
  source: 'copy' | 'full' | null = null
  /** a catch-up (or the first read) has worked since opening: until then the copy shows, and the chip says Loading */
  private upToDate = false
  /** the next catch-up compares the inbox too (notes that went leave nothing behind) */
  private checkInbox = false
  /** the floor came only from hiding the tab: shown again soon, with the channels up, nothing was missed */
  private hideFloor = false
  /** the archive was asked for while opening: it is read once the first catch-up is in */
  private archiveWanted = false
  /** the copy kept in this browser */
  readonly keeper: CopyKeeper

  constructor(env: WorkspaceEnv, workspaceId: string, me: MyProfile) {
    this.env = env
    this.workspaceId = workspaceId
    this.me = me
    this.keeper = new CopyKeeper(env.copy ?? NO_COPY, () => this.snapshot())
    this.fetcher = new RowFetcher({
      wait: env.delays.fetch,
      askAgain: env.delays.askAgain,
      // an issue that moved here or came back while we weren't looking: its labels and comments come too
      fetch: (reqs) => {
        const known = this.live.server.issues
        return env.reader.byKeys(planFetch(reqs), reqs.filter((r) => r.table === 'issues' && !known[r.key.id]).map((r) => r.key.id))
      },
      done: (inputs) => this.apply(inputs),
      failed: (reqs, e) => {
        console.warn('Sprawniej couldn’t read some changes', e)
        this.apply(noAnswer(reqs))
        this.refetch.push(...reqs)
        // what they pointed at may have changed meanwhile too: catch up, then ask again
        this.gap()
        this.retryLater()
      },
    })
  }

  get meId(): string {
    return this.me.id
  }

  get registry(): Registry {
    return this.env.registry
  }

  server(): Mirror {
    return this.live.server
  }

  private now(): number {
    return (this.env.now ?? Date.now)()
  }

  /**
   * Never throws: whatever goes wrong while opening shows as "We couldn't open this workspace". `again`: the same
   * workspace read again from the start; what's on screen stays until the new copy is in (changes made meanwhile are
   * shown on it), and the ids of people and teams stay known.
   */
  async open(again = false): Promise<void> {
    try {
      await this.opening(again)
    } catch (e) {
      console.warn('Sprawniej couldn’t open the workspace', e)
      this.fail('network')
    }
  }

  private async opening(again: boolean) {
    const { env } = this
    if (!again) {
      env.registry.clear()
      env.data.setState({ ...EMPTY, me: this.me.person })
    }
    env.status.setState({ state: 'loading', pending: 0, detail: undefined, progress: undefined, synced: false, caughtUpAt: undefined })
    env.backend.setState({ phase: 'opening', workspaceId: this.workspaceId, failure: undefined, gone: undefined })

    const read = await readCopy(this.env.copy ?? NO_COPY)
    if (this.closed) return
    const kept = read && this.showCopy(read, again) ? read : null
    if (this.closed) return

    this.channels = this.newChannels()
    const joined = await this.channels.join()
    if (this.closed) return
    // refused: maybe the workspace is gone. Can't tell right now? Then carry on; the read below will say
    if (joined === 'denied' && !(await env.reader.exists().catch(() => true))) return this.fail('gone')
    if (this.closed) return
    // not joined in time: they keep trying, and once they're in we catch up on what they missed
    for (const t of ['ws', 'me'] as const) if (!this.tracks[t].up) this.tracks[t] = { up: false, missed: true }

    if (kept) return this.catchUpFromCopy(kept)
    this.source = 'full'
    const inputs = await env.reader.all((progress) => !this.closed && env.status.setState({ progress }))
    if (this.closed) return
    if (inputs.some((i) => i.from === 'fetch' && i.table === 'workspaces' && i.rows.length === 0)) return this.fail('gone')

    const held = this.takeHeld()
    // the first copy replaces whatever the store had
    this.apply([...inputs, ...held.inputs], true)
    this.caughtUpAt = this.now()
    if (this.closed || env.backend.getState().phase !== 'opening') return
    this.upToDate = true
    this.begin()
    this.refresh({ synced: true, progress: undefined })
    this.afterHeld(held.catchUp)
    this.keeper.poke()
  }

  /** opening is over: the messages held meanwhile, as inputs, and whether to catch up for them */
  private takeHeld(): { inputs: Incoming[]; catchUp: boolean } {
    const held = this.held ?? []
    this.held = null
    // a held delete may be older than what was just read (deleted, then made again): catching up settles it
    const catchUp = this.gapWhileOpening || this.tracks.ws.missed || this.tracks.me.missed || held.some((m) => m.op === 'DELETE' || m.op === 'catch_up')
    return { inputs: held.map((message): Incoming => ({ from: 'message', message })), catchUp }
  }

  /** what waited for opening to be over: a catch-up for the held messages, the archive asked for meanwhile */
  private afterHeld(catchUp: boolean) {
    if (catchUp) void this.catchUp()
    if (this.archiveWanted) this.loadArchive()
  }

  /** open: the app shows, it hears about the browser, and your changes show on it */
  private begin() {
    const { env } = this
    env.backend.setState({ phase: 'open' })
    this.unwatch = env.watch({
      online: () => {
        this.refresh()
        void this.catchUp()
      },
      offline: () => {
        this.gap()
        this.refresh()
      },
      hidden: () => {
        this.gap(true)
        void this.keepAtOnce()
      },
      visible: (away) => {
        if (away > env.delays.slept) void this.catchUp()
        // back soon, and the channels stayed up: nothing was missed
        else if (this.hideFloor && this.tracks.ws.up && this.tracks.me.up) {
          this.floor = null
          this.hideFloor = false
        }
      },
      // signed out, the channels can't hear anything; signed in again (the same person: auth.ts starts over for
      // anyone else), they start over
      signedIn: (on) => {
        if (!on) this.gap()
        else void this.resume()
        this.refresh()
      },
    })
    env.writes.attach(this)
  }

  /**
   * The copy kept here shows at once (your unsaved changes on top); what changed since it comes next. False when it
   * can't be shown (a copy that reads back but doesn't apply): it goes, and everything is read instead.
   */
  private showCopy(kept: KeptCopy, again: boolean): boolean {
    try {
      this.apply(kept.inputs, true)
    } catch (e) {
      console.warn('Sprawniej couldn’t use the copy of the workspace kept in this browser', e)
      this.keeper.discard()
      this.live = emptyLive()
      if (!again) {
        this.env.registry.clear()
        this.env.data.setState({ ...EMPTY, me: this.me.person })
      }
      return false
    }
    if (this.closed) return true
    this.source = 'copy'
    // the copy is complete up to its mark, not up to its newest row (it may have been kept during a gap)
    this.floor = kept.mark
    this.caughtUpAt = kept.caughtUpAt
    this.checkInbox = true
    if (kept.archive) {
      this.archive = 'done'
      this.env.data.setState({ archiveLoaded: true })
    }
    this.keeper.shown({ live: this.live, mark: kept.mark, caughtUpAt: kept.caughtUpAt, archive: kept.archive })
    this.begin()
    this.refresh({ progress: undefined })
    return true
  }

  /** opening from the copy: what changed since it, then the messages held meanwhile; can't be read? The copy stays */
  private async catchUpFromCopy(kept: KeptCopy) {
    const from = this.floor ?? kept.mark
    let changes: Incoming[] | null = null
    let failure: unknown
    try {
      const r = await this.changesSince(from)
      if (this.closed) return
      if (r.gone) return this.goneAway('missing')
      changes = r.inputs
    } catch (e) {
      if (this.closed) return
      failure = e
    }
    const held = this.takeHeld()
    // what was read goes first, so a delete held meanwhile still wins
    this.apply([...(changes ?? []), ...held.inputs])
    if (this.closed) return
    if (changes) this.caughtUp(from)
    else this.failedCatchUp(failure)
    this.afterHeld(held.catchUp && !!changes)
  }

  /** a catch-up from `from` worked */
  private caughtUp(from: string | null) {
    // a gap that opened while it ran stays for the next one
    if (this.floor === from) this.floor = null
    this.hideFloor = false
    const first = !this.upToDate
    this.upToDate = true
    this.checkInbox = false
    this.failing = false
    this.retries = 0
    clearTimeout(this.retryTimer)
    this.catchUps++
    this.caughtUpAt = this.now()
    this.refresh({ caughtUpAt: this.now(), ...(first && { synced: true, progress: undefined }) })
    const refetch = this.refetch
    this.refetch = []
    if (refetch.length) this.fetcher.request(refetch)
    this.keeper.poke()
  }

  /** catching up failed: the chip stays calm, and it's tried again in a while */
  private failedCatchUp(e: unknown) {
    console.warn('Sprawniej couldn’t catch up with teammates’ changes', e)
    this.failing = true
    this.refresh()
    this.retryLater()
  }

  /**
   * Closing: the copy is kept first (for up to a second), while what the writer just saved is in. Then it stops. A
   * workspace that went keeps no copy.
   */
  close(): Promise<void> {
    if (this.closed || !this.keeper.wants()) return this.shut()
    return this.keeper.beforeClose().then(() => this.shut())
  }

  /** keep the copy now (scripted checks) */
  keepNow(): Promise<void> {
    return this.closed ? Promise.resolve() : this.keeper.saveNow()
  }

  /** the tab is hidden or the page goes: the copy is kept at once */
  keepAtOnce(): Promise<void> {
    if (this.closed) return Promise.resolve()
    const fresh = this.upToDate && !this.failing && this.tracks.ws.up && this.tracks.me.up
    return this.keeper.saveAtOnce(fresh)
  }

  private async shut(): Promise<void> {
    this.closed = true
    this.keeper.stop()
    clearTimeout(this.flushTimer)
    clearTimeout(this.retryTimer)
    clearTimeout(this.archiveTimer)
    clearTimeout(this.cascadeTimer)
    this.fetcher.stop()
    this.unwatch?.()
    await this.channels?.close()
  }

  // ---------- channels ----------

  private newChannels(): ChannelsLike {
    const ch: ChannelsLike = this.env.channels({
      message: (m) => this.onMessage(m),
      // channels left behind (after signing in again) say CLOSED as they go: that's no drop
      status: (t, s) => ch === this.channels && this.onStatus(t, s),
    })
    return ch
  }

  private onMessage(m: Message) {
    if (this.closed || !isMessage(m)) return
    if (this.held) {
      this.held.push(m)
      return
    }
    // a burst (a deleted team's issues, say) is drawn once
    this.queue.push(m)
    // so many rows go with a team or a project that some messages may not come: a catch-up finds the rest
    if (m.op === 'DELETE' && (m.table === 'teams' || m.table === 'projects')) {
      clearTimeout(this.cascadeTimer)
      this.cascadeTimer = setTimeout(() => void this.catchUp(), this.env.delays.cascade)
    }
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined
      const q = this.queue
      this.queue = []
      this.apply(q.map((message): Incoming => ({ from: 'message', message })))
    }, this.env.delays.flush)
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

  /** messages may be missed from here on: catching up starts no later than this. `hiding`: only the tab was hidden */
  private gap(hiding = false) {
    if (!hiding) this.hideFloor = false
    else if (this.floor === null) this.hideFloor = true
    this.floor ??= this.live.mark
  }

  /** the chip, from the facts as they are now (the writer calls it too) */
  refresh(more: Partial<SaveStatus> = {}) {
    if (this.closed) return
    if (this.env.backend.getState().phase !== 'open' && !more.synced) return
    const w = this.env.writes.status()
    const c = { online: this.env.online(), channelsUp: this.tracks.ws.up && this.tracks.me.up, signedIn: this.env.signedIn(), failing: this.failing }
    const state = chipState(c, w)
    // the copy shows, and the latest isn't in yet (the channels may still be joining)
    const loading = !this.upToDate && (state === 'saved' || (state === 'reconnecting' && !this.failing))
    this.env.status.setState({ state: loading ? 'loading' : state, pending: w.pending, waiting: w.waiting, detail: undefined, ...more })
  }

  // ---------- applying ----------

  /**
   * Everything goes into the store through here: loads, messages, and your own changes (the writer). `fresh`: the
   * first copy, which replaces the whole store.
   */
  apply(inputs: Incoming[], fresh = false) {
    if (this.closed || !inputs.length) return
    const { env } = this
    const base: DataState = fresh ? { ...EMPTY, me: this.me.person } : env.data.getState()
    const was = this.live
    const r = applyRows(this.live, slice(base), inputs, { workspaceId: this.workspaceId, meId: this.me.id, registry: env.registry })
    this.live = r.state
    // the database's rows changed: the copy is kept again in a moment
    if (r.state.server !== was.server || r.state.mark !== was.mark || r.state.partial !== was.partial) this.keeper.poke()
    if (fresh) env.data.setState({ ...base, ...r.patch })
    else if (Object.keys(r.patch).length) env.data.setState(r.patch)
    if (r.workspaceGone) return this.goneAway('deleted')
    if (env.data.getState().members[this.me.person.login]?.removedAt) return this.goneAway('removed')
    if (r.fetch.length) this.fetcher.request(r.fetch)
    if (r.catchUp) void this.catchUp()
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

  private retryLater() {
    if (this.closed) return
    const { retry } = this.env.delays
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.catchUp(), retry[Math.min(this.retries++, retry.length - 1)])
  }

  /** false when it failed (a retry is planned) */
  private async catchUpOnce(): Promise<boolean> {
    const { env } = this
    const from = this.floor ?? this.live.mark
    // deletions are kept 45 days: away from them longer than that, some could be missed (a quiet workspace's newest
    // change may be old; what counts is when this browser last had everything)
    if (!from || tooLongAgo(this.caughtUpAt, this.now())) {
      env.reopen()
      return true
    }
    const floor = this.floor
    try {
      const { inputs, gone } = await this.changesSince(from)
      if (this.closed) return true
      if (gone) {
        this.goneAway('missing')
        return true
      }
      this.apply(inputs)
      if (this.closed) return true
      this.caughtUp(floor)
      return true
    } catch (e) {
      if (this.closed) return true
      this.failedCatchUp(e)
      return false
    }
  }

  /**
   * What changed since `from` (a raw database time): changed rows and deletions, the labels, followers and comments
   * of issues new to us, and (opening from a copy) DELETEs for the inbox notes that went.
   */
  private async changesSince(from: string): Promise<{ inputs: Incoming[]; gone: boolean }> {
    const { reader } = this.env
    const members = new Set(Object.values(this.live.server.workspace_members).map((m) => m.profile_id))
    // the notes we have before asking: one that comes meanwhile is no note that went
    const notes = this.checkInbox ? Object.keys(this.live.server.inbox) : null
    const [{ inputs, gone }, inbox] = await Promise.all([reader.changed(sinceMark(from), members), notes ? reader.inboxIds() : null])
    if (gone || this.closed) return { inputs, gone }
    const known = this.live.server.issues
    const fresh = inputs.flatMap((i) => (i.from === 'fetch' && i.table === 'issues' ? i.rows.map((r) => String(r.id)).filter((id) => !known[id]) : []))
    if (fresh.length) inputs.push(...(await reader.partsOf(fresh)))
    if (notes && inbox) inputs.push(...inboxGone(notes, inbox))
    return { inputs, gone }
  }

  // ---------- the copy kept in this browser ----------

  /** what there is to keep now, or null when nothing should be (still opening, closed, too long since up to date) */
  private snapshot(): Snapshot | null {
    if (this.closed || this.held || this.env.backend.getState().phase !== 'open') return null
    const mark = cacheMark(this.live.mark, this.floor)
    // too long since this browser had everything: the copy would be read again whole anyway
    if (!mark || tooLongAgo(this.caughtUpAt, this.now())) return null
    return { live: this.live, mark, caughtUpAt: this.caughtUpAt, archive: this.archive === 'done' }
  }

  /** signed in again after "Please sign in again": fresh channels (the old ones lost their access), then catch up */
  resume(): Promise<void> {
    if (this.closed || this.held) return Promise.resolve()
    this.resuming ??= this.rejoin().finally(() => {
      this.resuming = null
    })
    return this.resuming
  }

  private async rejoin() {
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

  /** archived issues into the store, once per opening; tried again a while after a failure */
  loadArchive() {
    if (this.closed || this.archive !== 'none') return
    // still opening: read once the first catch-up is in (until then rows apply in a set order)
    if (this.held) {
      this.archiveWanted = true
      return
    }
    this.archiveWanted = false
    this.archive = 'loading'
    clearTimeout(this.archiveTimer)
    this.env.reader.archived().then(
      (inputs) => {
        if (this.closed) return
        this.apply(inputs)
        this.env.data.setState({ archiveLoaded: true })
        this.archive = 'done'
      },
      (e: unknown) => {
        console.warn('Sprawniej couldn’t read the archive', e)
        this.archive = 'none'
        if (this.closed) return
        const { retry } = this.env.delays
        this.archiveTimer = setTimeout(() => this.loadArchive(), retry[Math.min(this.archiveTries++, retry.length - 1)])
      },
    )
  }

  /** how many archived issues a team has (deleting it says so); 0 when it can't be told */
  async countArchived(teamKey: string): Promise<number> {
    const id = this.env.registry.teamId(teamKey)
    if (!id || this.closed) return 0
    return this.env.reader.countArchived(id).catch((e: unknown) => {
      console.warn('Sprawniej couldn’t count the archived issues', e)
      return 0
    })
  }

  // ---------- endings ----------

  private fail(failure: 'gone' | 'network') {
    if (this.closed) return
    if (failure === 'gone') this.keeper.drop()
    // said first: a copy that shows (opening from it) isn't kept again on the way out
    this.env.backend.setState({ phase: 'failed', failure })
    void this.close()
  }

  /** deleted or left while open: say so, and keep what's on screen until they choose another workspace */
  private goneAway(gone: 'deleted' | 'removed' | 'missing') {
    // leaving on purpose: no "You're no longer in this workspace" for it (it closes next)
    if (this.closed || this.leaving) return
    this.keeper.drop()
    // nothing of yours can be saved there any more, and saying so for each change helps nobody
    this.env.writes.stop()
    void this.close()
    this.env.status.setState({ state: 'closed', detail: undefined })
    this.env.backend.setState({ phase: 'gone', gone })
  }
}

/**
 * One open workspace at a time. Opening and closing run one after the other (a chain), so a quick close and open of
 * the same workspace never joins a channel that is still leaving.
 */
export class Lifecycle {
  current: LiveWorkspace | null = null
  private chain: Promise<void> = Promise.resolve()
  private make: (workspaceId: string, me: MyProfile) => LiveWorkspace | null
  private backend: Store<BackendState>
  private registry: Registry
  private writes: WritesHooks
  private onClosed: () => void
  /** the workspace whose unsaved changes the writer still holds, detached (it opens again next, or it failed to open) */
  private kept: string | null = null

  /**
   * `writes`: the writer (none in some tests); `closed`: a workspace closed for good (not when it's read again from
   * the start), so what belonged to it is forgotten
   */
  constructor(make: Lifecycle['make'], backend: Store<BackendState>, registry: Registry, more: { writes?: WritesHooks; closed?: () => void } = {}) {
    this.make = make
    this.backend = backend
    this.registry = registry
    this.writes = more.writes ?? NO_WRITES
    this.onClosed = more.closed ?? (() => {})
  }

  private queue(job: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(job, job)
    return this.chain
  }

  open(workspaceId: string, me: MyProfile): Promise<void> {
    return this.queue(() => this.start(workspaceId, me, false))
  }

  /**
   * You leave the open workspace (`call` tells the database), and it closes. Your own leaving gets no "You're no
   * longer in this workspace": the message saying you left may come before it closes.
   */
  async leave(call: (workspaceId: string) => Promise<void>): Promise<void> {
    const ws = this.current
    if (!ws) return
    ws.leaving = true
    try {
      await call(ws.workspaceId)
    } catch (e) {
      ws.leaving = false
      throw e
    }
    // you're no longer in it: its copy goes from this browser
    ws.keeper.drop()
    await this.close()
  }

  /** a workspace that failed to open keeps what's waiting: "Try again" opens it once more */
  close(): Promise<void> {
    return this.queue(() => this.closeNow(this.backend.getState().phase === 'failed'))
  }

  /** the same workspace read again from the start, if it's still the one open; your unsaved changes carry over */
  reopen(ws: LiveWorkspace): void {
    if (this.current === ws) void this.queue(() => (this.current === ws ? this.start(ws.workspaceId, ws.me, true) : Promise.resolve()))
  }

  private async start(workspaceId: string, me: MyProfile, again: boolean) {
    const cur = this.current
    if (cur) await this.closeNow(again || cur.workspaceId === workspaceId || this.backend.getState().phase === 'failed')
    // what another workspace still had waiting gets a moment to be sent, then goes
    if (this.kept !== null && this.kept !== workspaceId) await this.writes.finish(3_000)
    this.kept = null
    const ws = this.make(workspaceId, me)
    if (!ws) return
    this.current = ws
    // opening isn't waited for here: a close that comes meanwhile marks it closed, and it stops at its next step
    void ws.open(again)
  }

  /** `keep`: what's waiting to be saved stays with the writer (the same workspace opens next, or it failed to open) */
  private async closeNow(keep: boolean) {
    const ws = this.current
    this.current = null
    if (!ws) return
    if (keep) {
      this.writes.detach()
      this.kept = ws.workspaceId
    } else {
      // switching workspace or signing out: a moment to send what's waiting, while it still shows
      await this.writes.finish(3_000)
      this.kept = null
    }
    await ws.close()
    // the same workspace read again keeps the ids it knows (changes made meanwhile name them)
    if (!keep) this.registry.clear()
    this.backend.setState({ phase: 'closed', workspaceId: undefined, failure: undefined, gone: undefined })
    // once nothing shows it as open any more, so nothing asks for its pictures again
    if (!keep) this.onClosed()
  }
}
