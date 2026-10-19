/**
 * Saving: every change an action makes shows at once and is sent to the database a moment later. Nothing waits for a
 * Save button (CLAUDE.md, golden rules).
 *
 * How it goes:
 * - write() shows a batch of changes at once (applyRows, `local`) and puts each on its row's queue. Each row sends
 *   one thing at a time, first in, first out; a change that comes while an earlier one of the same row still waits
 *   to be sent joins it (quick typing makes one request, not ten).
 * - A row that points at another one being made (an issue's labels, a comment on a new issue) waits until that one is
 *   saved. Changes ready together go in as few requests as they can (send.ts, requests.ts).
 * - The answer settles each change (applyRows, `settled`): saved, it gives way to the row the database sent back;
 *   refused, it is undone and the person reads why, once.
 * - No answer at all (offline, a busy moment): it is tried again after 1, 2, 5, 10, 20 s, then every 30 s, and at once
 *   when the connection comes back. Meanwhile the chip says so, and closing the tab asks first.
 * - Inbox notes for teammates, and changes that only make sense once the rest is saved (a view's filter without a
 *   deleted team), go only once everything else in their batch is saved.
 *
 * The writer outlives an open workspace being read again from the start (detach, then attach): changes made
 * meanwhile still queue, and everything not saved yet shows again on the new copy.
 *
 * The queue keeps to these:
 * - a row's items are sent one at a time, oldest first; only the first may be on its way or waiting to try again;
 * - a change joins only an item that was never sent (one that was sent may have landed);
 * - an item is held while a row it points at has an insert in the queue;
 * - every change shown with `local` is settled exactly once (saved, undone, or dropped with its insert).
 */
import type { Incoming } from './apply'
import { mirrorRow, type Mirror } from './apply/mirror'
import { localKey } from './apply/take'
import type { AnyChange, Call } from './changes'
import type { Registry } from './registry'
import type { LiveTable } from './tables'
import { MESSAGES } from './writes/problems'
import { answerKey, parentsOf, plan } from './writes/requests'
import type { NoteRow, Outcome, Request, Transport, Answer } from './writes/send'
import { equal } from '@/lib/equal'

export type { NoteRow, Transport } from './writes/send'

type Loose = Readonly<Record<string, unknown>>

/** what actions need to make changes: null while no workspace is open */
export interface WriteContext {
  workspaceId: string
  /** your profile id */
  meId: string
  registry: Registry
}

/** where changes show (the open workspace, LiveWorkspace) */
export interface WriteTarget {
  readonly workspaceId: string
  readonly meId: string
  readonly registry: Registry
  /** applyRows and the store in one go */
  apply(inputs: Incoming[]): void
  /** the database's rows as we know them, to settle once the database agrees */
  server(): Mirror
}

export interface Batch {
  /** sent, and shown at once */
  changes: AnyChange[]
  /** shown at once, never sent: what the database does by itself when the changes save (deleting a team deletes its issues) */
  cascade?: AnyChange[]
  /** shown at once, never sent: what the database empties by itself (a deleted parent); settled once the database's copy agrees, or after 10 s */
  untilEcho?: AnyChange[]
  /** shown at once, sent only once every change above is saved, undone if one isn't (a view's filter without a deleted team) */
  after?: AnyChange[]
  /** teammates' inbox notes: sent once every change here is saved, never shown, never read back (E54) */
  notes?: NoteRow[]
  /** after the database answered. `rows`: `${table}:${keyString}` → the row as the database has it now */
  done?: (r: { ok: true; rows: ReadonlyMap<string, Loose> } | { ok: false }) => void
}

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
}

const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
}

/** what the writer needs from the page */
export interface Page {
  /** ask before the tab closes while something isn't saved */
  guard(on: boolean): void
  /** `retry` when the connection comes back or the tab is shown again; returns the function that stops */
  watch(retry: () => void): () => void
}

function hold(e: BeforeUnloadEvent) {
  e.preventDefault()
  // deprecated, but older Safari asks only when this is set too
  e.returnValue = ''
}

const BROWSER: Page = {
  guard(on) {
    if (typeof window === 'undefined') return
    if (on) window.addEventListener('beforeunload', hold)
    else window.removeEventListener('beforeunload', hold)
  },
  watch(retry) {
    if (typeof window === 'undefined') return () => {}
    const visible = () => document.visibilityState === 'visible' && retry()
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', visible)
    }
  },
}

export interface WriterOptions {
  transport: Transport
  /** a message for the person (a toast) */
  tell: (message: string) => void
  /** pending, sending or waiting changed (the chip) */
  onStatus: () => void
  clock?: Clock
  page?: Page
  /** 0..1, for the spread of retry delays (tests make it fixed) */
  random?: () => number
}

/** requests on their way at once */
export const IN_FLIGHT = 6
/** waits before trying again, then every last one */
const RETRY = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000]
/** an emptied column that never echoed is taken as done after this long */
const ECHO_WAIT = 10_000
const ECHO_CHECK = 250
/** the same message isn't told twice within this */
const TOLD_WITHIN = 3_000

/** why a batch didn't save: with a message for the person, or quietly (you deleted what it was about) */
type Failure = { quiet: true } | { quiet: false; message: string }

interface Group {
  /** items still carrying this batch's changes */
  open: Set<Item>
  failure?: Failure
  /** one of its deletes failed: what the database would have done with it didn't happen */
  deleteFailed?: boolean
  rows: Map<string, Loose>
  cascade: AnyChange[]
  untilEcho: AnyChange[]
  after: AnyChange[]
  notes?: NoteRow[]
  done?: Batch['done']
}

interface Item {
  seq: number
  /** `${table}:${keyString}`; notes: `inbox:notes:${seq}` */
  ks: string
  table: LiveTable
  key: Record<string, string>
  op: 'insert' | 'update' | 'delete' | 'call' | 'notes'
  fields: Loose
  call?: Call
  notes?: NoteRow[]
  solo?: boolean
  /** the changes it saves, settled one by one (applyRows finds them by value) */
  changes: AnyChange[]
  groups: Set<Group>
  state: 'waiting' | 'sending' | 'retry'
  tries: number
  nextTry: number
}

/** an update that can join a waiting insert of its row: an issue's archived_at can only be sent as an update */
export const insertable = (c: AnyChange) => !(c.table === 'issues' && 'archived_at' in (c.fields ?? {}))

export class Writer {
  private o: Required<WriterOptions>
  private target: WriteTarget | null = null
  /** what actions use; it stays while the workspace is read again (detached) */
  private ctx: WriteContext | null = null
  private rows = new Map<string, Item[]>()
  private groups = new Set<Group>()
  private seq = 0
  private inFlight = 0
  private stopped = false
  private scheduled = false
  /** rows you deleted (outright or with something else): their "deleted meanwhile" stays quiet */
  private goneByMe = new Set<string>()
  /** emptied columns waiting for the database's copy to agree */
  private echo: { change: AnyChange; until: number }[] = []
  private echoTimer: unknown
  private retryTimer: unknown
  private retryAt = Infinity
  /** rows the database sent back while nothing was attached, shown on the next attach */
  private kept: Incoming[] = []
  private flushes: { resolve: (left: number) => void; timer: unknown }[] = []
  private told = new Map<string, number>()
  private guarded = false
  private lastStatus = ''
  private unwatch: () => void

  constructor(o: WriterOptions) {
    this.o = { clock: REAL_CLOCK, page: BROWSER, random: Math.random, ...o }
    this.unwatch = this.o.page.watch(() => this.retryNow())
  }

  // ---------- where changes show ----------

  context(): WriteContext | null {
    return this.stopped ? null : this.ctx
  }

  /** the open workspace (the first time, or read again from the start): what's still unsaved shows on it */
  attach(target: WriteTarget) {
    if (this.stopped) return
    this.target = target
    this.ctx = { workspaceId: target.workspaceId, meId: target.meId, registry: target.registry }
    const replay: Incoming[] = this.kept
    this.kept = []
    const items = [...this.rows.values()].flat().sort((a, b) => a.seq - b.seq)
    for (const i of items) for (const change of i.changes) replay.push({ from: 'local', change })
    for (const g of this.groups) for (const change of [...g.cascade, ...g.untilEcho, ...g.after]) replay.push({ from: 'local', change })
    for (const e of this.echo) replay.push({ from: 'local', change: e.change })
    if (replay.length) target.apply(replay)
    this.watchEcho()
    this.schedule()
  }

  /** the workspace is being read again: keep taking changes and sending, show them on the next attach */
  detach() {
    this.target = null
    this.o.clock.clearTimeout(this.echoTimer)
    this.echoTimer = undefined
  }

  /** closing for good: what's still waiting is dropped */
  stop() {
    if (this.stopped) return
    this.stopped = true
    this.target = null
    const { clock } = this.o
    clock.clearTimeout(this.echoTimer)
    clock.clearTimeout(this.retryTimer)
    this.unwatch()
    this.guard(false)
    for (const f of this.flushes) {
      clock.clearTimeout(f.timer)
      f.resolve(this.pending())
    }
    this.flushes = []
  }

  private show(inputs: Incoming[]) {
    if (!inputs.length) return
    if (this.target) return this.target.apply(inputs)
    // nothing to show them on: the rows the database sent back are shown once attached
    for (const i of inputs) if (i.from === 'settled' && i.ok && i.row && i.change.op !== 'delete') this.kept.push({ from: 'fetch', table: i.change.table, rows: [i.row] })
  }

  // ---------- writing ----------

  write(batch: Batch) {
    if (this.stopped) return
    const shown = [...batch.changes, ...(batch.cascade ?? []), ...(batch.untilEcho ?? []), ...(batch.after ?? [])]
    const settles: Incoming[] = []
    this.add(batch, settles)
    const dones = this.complete(settles)
    this.show([...shown.map((change): Incoming => ({ from: 'local', change })), ...settles])
    for (const d of dones) d()
    this.schedule()
    this.publishStatus()
  }

  /** a batch onto the queues (its changes are shown by whoever called) */
  private add(batch: Batch, settles: Incoming[]) {
    const group: Group = { open: new Set(), rows: new Map(), cascade: batch.cascade ?? [], untilEcho: batch.untilEcho ?? [], after: batch.after ?? [], notes: batch.notes, done: batch.done }
    this.groups.add(group)
    for (const c of batch.changes) this.enqueue(c, group, settles)
    // what the database deletes along with it: waiting changes to it are pointless now
    for (const c of group.cascade) {
      if (c.op !== 'delete') continue
      const ks = localKey(c.table, c.key)
      this.goneByMe.add(ks)
      for (const i of [...(this.rows.get(ks) ?? [])]) if (i.state === 'waiting') this.drop(i, { quiet: true }, settles)
    }
  }

  /** joins the last waiting change of its row when it can, else waits behind it */
  private enqueue(c: AnyChange, group: Group, settles: Incoming[]) {
    const ks = localKey(c.table, c.key)
    const op = c.call ? 'call' : c.op
    if (op === 'delete') this.goneByMe.add(ks)
    else if (op === 'insert') this.goneByMe.delete(ks)
    const q = this.rows.get(ks) ?? []
    const last = q.at(-1)
    if (last?.state === 'waiting') {
      if (op === 'update' && (last.op === 'update' || (last.op === 'insert' && insertable(c)))) {
        last.fields = { ...last.fields, ...c.fields }
        last.changes.push(c)
        this.join(last, group)
        return
      }
      if (op === 'delete' && last.op === 'insert' && q.length === 1) {
        // made and deleted before it was sent: nothing to send, nothing changes on screen
        this.drop(last, { quiet: true }, settles)
        settles.push({ from: 'settled', change: c, ok: true })
        return
      }
      if (op === 'delete' && last.op === 'update') {
        // the edits are hidden by the delete already; it goes instead of them
        for (const change of last.changes) settles.push({ from: 'settled', change, ok: false })
        for (const g of last.groups) this.leave(g, last, { quiet: true })
        Object.assign(last, { op: 'delete', fields: {}, changes: [c], groups: new Set<Group>() })
        this.join(last, group)
        return
      }
    }
    const item: Item = { seq: ++this.seq, ks, table: c.table, key: { ...c.key }, op, fields: { ...c.fields }, call: c.call, changes: [c], groups: new Set(), state: 'waiting', tries: 0, nextTry: 0 }
    q.push(item)
    this.rows.set(ks, q)
    this.join(item, group)
  }

  private join(item: Item, group: Group) {
    item.groups.add(group)
    group.open.add(item)
  }

  /** a group stops waiting for this item; with `failure` when it didn't save */
  private leave(g: Group, item: Item, failure?: Failure) {
    g.open.delete(item)
    if (!failure) return
    if (!g.failure || (g.failure.quiet && !failure.quiet)) g.failure = failure
    if (item.op === 'delete') g.deleteFailed = true
  }

  private remove(item: Item) {
    const q = this.rows.get(item.ks)
    if (!q) return
    const rest = q.filter((i) => i !== item)
    if (rest.length) this.rows.set(item.ks, rest)
    else this.rows.delete(item.ks)
  }

  /** an unsent item that won't be sent: undone, and so is what waited for it */
  private drop(item: Item, failure: Failure, settles: Incoming[]) {
    this.remove(item)
    for (const change of item.changes) settles.push({ from: 'settled', change, ok: false })
    for (const g of item.groups) this.leave(g, item, failure)
    if (item.op === 'insert') this.dropDependents(item.ks, settles)
  }

  /** a row that won't be made: whatever still waits for it (its labels, a comment on it, later edits) goes, quietly */
  private dropDependents(ks: string, settles: Incoming[]) {
    for (const i of [...(this.rows.get(ks) ?? [])]) if (i.state === 'waiting') this.drop(i, { quiet: true }, settles)
    for (const q of [...this.rows.values()]) {
      for (const i of [...q]) if (i.state === 'waiting' && parentsOf(i).includes(ks)) this.drop(i, { quiet: true }, settles)
    }
  }

  // ---------- sending ----------

  private schedule() {
    if (this.scheduled || this.stopped) return
    this.scheduled = true
    queueMicrotask(() => this.dispatch())
  }

  /** a row waits while something it points at is still being made */
  private blocked(item: Item): boolean {
    return parentsOf(item).some((p) => p !== item.ks && !!this.rows.get(p)?.some((i) => i.op === 'insert'))
  }

  private dispatch() {
    this.scheduled = false
    if (this.stopped) return
    const now = this.o.clock.now()
    const ready: Item[] = []
    for (const q of this.rows.values()) {
      const head = q[0]
      if (!head || head.state === 'sending' || (head.state === 'retry' && head.nextTry > now) || this.blocked(head)) continue
      ready.push(head)
    }
    for (const { req, items } of plan(ready)) {
      if (this.inFlight >= IN_FLIGHT) break
      this.send(req, items)
    }
    this.planRetry()
    this.checkFlushes()
    this.publishStatus()
  }

  private send(req: Request, items: Item[]) {
    const retry = items.some((i) => i.tries > 0)
    for (const i of items) i.state = 'sending'
    this.inFlight++
    this.o.transport.run(req, { retry }).then(
      (answer) => this.answered(req, items, answer),
      (e: unknown) => {
        console.error('Sprawniej couldn’t save a change', e)
        this.answered(req, items, { problem: { kind: 'bug', message: MESSAGES.bug } })
      },
    )
  }

  private answered(req: Request, items: Item[], answer: Answer) {
    this.inFlight--
    if (this.stopped) return
    const now = this.o.clock.now()
    const settles: Incoming[] = []
    if ('problem' in answer) {
      const p = answer.problem
      if (p.kind === 'network' || p.kind === 'auth') {
        for (const i of items) {
          i.state = 'retry'
          i.tries++
          i.nextTry = now + this.delay(i.tries)
        }
      } else if (req.kind === 'notes' && items.length > 1) {
        // one bad note fails the request: each batch's notes try again on their own
        for (const i of items) Object.assign(i, { state: 'waiting', solo: true })
      } else {
        if (p.kind === 'bug') console.error('Sprawniej couldn’t save a change', req, p)
        for (const i of items) this.finish(i, { ok: false, why: p.kind === 'gone' ? 'gone' : 'refused', message: p.message }, settles)
      }
    } else {
      for (const i of items) this.finish(i, answer.outcomes.get(answerKey(i)) ?? { ok: true }, settles)
      // the connection works: what waits to try again goes now
      this.dueNow()
    }
    const dones = this.complete(settles)
    this.show(settles)
    for (const d of dones) d()
    this.schedule()
    this.publishStatus()
  }

  private delay(tries: number): number {
    const base = RETRY[Math.min(tries, RETRY.length) - 1]
    return Math.round(base * (0.8 + 0.4 * this.o.random()))
  }

  /** a sent item is answered */
  private finish(item: Item, outcome: Outcome, settles: Incoming[]) {
    this.remove(item)
    if (item.op === 'notes') {
      if (!outcome.ok) console.warn('Sprawniej couldn’t send some inbox notes', outcome.message)
      return
    }
    if (outcome.ok) {
      for (const change of item.changes) settles.push(outcome.row ? { from: 'settled', change, ok: true, row: outcome.row } : { from: 'settled', change, ok: true })
      for (const g of item.groups) {
        if (outcome.row) g.rows.set(item.ks, outcome.row)
        this.leave(g, item)
      }
      return
    }
    // deleted by you (or with something you deleted): no need to say it wasn't saved
    const quiet = outcome.why === 'gone' && [item.ks, ...parentsOf(item)].some((k) => this.goneByMe.has(k))
    // your delete was refused: the row is still there, and a later "deleted meanwhile" about it is news
    if (item.op === 'delete') this.goneByMe.delete(item.ks)
    for (const change of item.changes) settles.push({ from: 'settled', change, ok: false })
    for (const g of item.groups) this.leave(g, item, quiet ? { quiet: true } : { quiet: false, message: outcome.message })
    if (item.op === 'insert') this.dropDependents(item.ks, settles)
  }

  /** batches with nothing left to wait for: what the database did along with them, what comes after, done() */
  private complete(settles: Incoming[]): (() => void)[] {
    const dones: (() => void)[] = []
    const now = this.o.clock.now()
    for (;;) {
      const g = [...this.groups].find((x) => !x.open.size)
      if (!g) break
      this.groups.delete(g)
      const along = !g.deleteFailed
      for (const change of g.cascade) {
        settles.push(along ? { from: 'settled', change, ok: true } : { from: 'settled', change, ok: false })
        if (!along && change.op === 'delete') this.goneByMe.delete(localKey(change.table, change.key))
      }
      for (const change of g.untilEcho) {
        if (along) this.echo.push({ change, until: now + ECHO_WAIT })
        else settles.push({ from: 'settled', change, ok: false })
      }
      const failure = g.failure
      if (!failure) {
        // shown already; sent now, as a batch of their own
        if (g.after.length) this.add({ changes: g.after }, settles)
        if (g.notes?.length) this.queueNotes(g.notes)
        dones.push(() => g.done?.({ ok: true, rows: g.rows }))
      } else {
        for (const change of g.after) settles.push({ from: 'settled', change, ok: false })
        dones.push(() => {
          g.done?.({ ok: false })
          if (!failure.quiet) this.say(failure.message)
        })
      }
    }
    this.watchEcho()
    return dones
  }

  private queueNotes(notes: NoteRow[]) {
    const seq = ++this.seq
    const item: Item = { seq, ks: `inbox:notes:${seq}`, table: 'inbox', key: {}, op: 'notes', fields: {}, notes, changes: [], groups: new Set(), state: 'waiting', tries: 0, nextTry: 0 }
    this.rows.set(item.ks, [item])
  }

  // ---------- emptied columns, settled once the database agrees ----------

  private watchEcho() {
    if (!this.echo.length || !this.target || this.echoTimer !== undefined) return
    this.echoTimer = this.o.clock.setTimeout(() => {
      this.echoTimer = undefined
      this.checkEcho()
    }, ECHO_CHECK)
  }

  private checkEcho() {
    if (!this.target) return
    const server = this.target.server()
    const now = this.o.clock.now()
    const settles: Incoming[] = []
    this.echo = this.echo.filter((e) => {
      const c = e.change
      const row: Loose | undefined = mirrorRow(server, c.table, c.key)
      const agrees = !row || Object.entries({ ...c.fields, ...c.guess }).every(([k, v]) => equal(row[k], v))
      if (!agrees && now < e.until) return true
      settles.push({ from: 'settled', change: c, ok: true })
      return false
    })
    this.show(settles)
    this.watchEcho()
  }

  // ---------- trying again ----------

  /** everything waiting to try again may go at the next dispatch */
  private dueNow() {
    const now = this.o.clock.now()
    for (const q of this.rows.values()) for (const i of q) if (i.state === 'retry') i.nextTry = now
  }

  private planRetry() {
    let at = Infinity
    for (const q of this.rows.values()) for (const i of q) if (i.state === 'retry') at = Math.min(at, i.nextTry)
    if (at === this.retryAt) return
    this.o.clock.clearTimeout(this.retryTimer)
    this.retryAt = at
    if (at === Infinity) return
    this.retryTimer = this.o.clock.setTimeout(
      () => {
        this.retryAt = Infinity
        this.dispatch()
      },
      Math.max(0, at - this.o.clock.now()),
    )
  }

  /** the connection is back (or the tab shown again): everything waiting goes now */
  retryNow() {
    this.dueNow()
    this.schedule()
  }

  /**
   * Sends what's waiting now. Resolves with what is still unsaved: 0 once everything is saved, or more when
   * everything left has failed again since (offline), or when `ms` is up.
   */
  flush(ms = 8_000): Promise<number> {
    if (this.stopped || !this.pending()) return Promise.resolve(this.pending())
    return new Promise((resolve) => {
      const f = { resolve, timer: undefined as unknown }
      f.timer = this.o.clock.setTimeout(() => {
        this.flushes = this.flushes.filter((x) => x !== f)
        resolve(this.pending())
      }, ms)
      this.flushes.push(f)
      this.dueNow()
      this.dispatch()
    })
  }

  /** nothing in flight and nothing ready: whatever is left waits for a later try */
  private checkFlushes() {
    if (!this.flushes.length || (this.pending() && this.inFlight)) return
    for (const f of this.flushes) {
      this.o.clock.clearTimeout(f.timer)
      f.resolve(this.pending())
    }
    this.flushes = []
  }

  // ---------- what the chip and the page see ----------

  /** rows with changes not saved yet (and inbox notes not sent yet, and changes waiting for their batch) */
  pending(): number {
    let n = 0
    for (const q of this.rows.values()) n += q.length
    for (const g of this.groups) n += g.after.length
    return n
  }

  status(): { pending: number; sending: boolean; waiting: boolean } {
    let waiting = false
    for (const q of this.rows.values()) if (q.some((i) => i.tries > 0)) waiting = true
    return { pending: this.pending(), sending: this.inFlight > 0, waiting }
  }

  private publishStatus() {
    if (this.stopped) return
    const s = this.status()
    this.guard(s.pending > 0)
    const now = JSON.stringify(s)
    if (now === this.lastStatus) return
    this.lastStatus = now
    this.o.onStatus()
  }

  private guard(on: boolean) {
    if (on === this.guarded) return
    this.guarded = on
    this.o.page.guard(on)
  }

  /** a message for the person; the same one isn't repeated within a few seconds */
  say(message: string) {
    const now = this.o.clock.now()
    const at = this.told.get(message)
    if (at !== undefined && now - at < TOLD_WITHIN) return
    this.told.set(message, now)
    this.o.tell(message)
  }

  debug(): { table: string; op: string; state: string; tries: number }[] {
    return [...this.rows.values()].flat().map((i) => ({ table: i.table, op: i.op, state: i.state, tries: i.tries }))
  }
}

// ---------- the one writer the app uses ----------

let writer: Writer | null = null

/** one per open session (index.ts); a writer still running is stopped first */
export function startWrites(o: WriterOptions): void {
  writer?.stop()
  writer = new Writer(o)
}

export const started = (): boolean => writer !== null

export function stopWrites(): void {
  writer?.stop()
  writer = null
}

export const attach = (target: WriteTarget): void => writer?.attach(target)
export const detach = (): void => writer?.detach()
/** null while no workspace is open: actions then do nothing */
export const context = (): WriteContext | null => writer?.context() ?? null
export const write = (batch: Batch): void => writer?.write(batch)
export const pending = (): number => writer?.pending() ?? 0
export const flush = (ms?: number): Promise<number> => writer?.flush(ms) ?? Promise.resolve(0)
export const writesStatus = (): { pending: number; sending: boolean; waiting: boolean } => writer?.status() ?? { pending: 0, sending: false, waiting: false }
/** a message for the person (once within a few seconds) */
export const tell = (message: string): void => writer?.say(message)
export const debugWrites = (): ReturnType<Writer['debug']> => writer?.debug() ?? []
