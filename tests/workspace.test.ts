import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Incoming } from '@/backend/apply'
import type { ConnectionEvents } from '@/backend/connection'
import type { ChannelEvents, ChannelsLike, ChannelStatus, Topic } from '@/backend/live'
import { sinceMark, type Reader } from '@/backend/load'
import { Registry } from '@/backend/registry'
import type { SaveStatus } from '@/backend/status'
import type { Message } from '@/backend/tables'
import type { CopyHooks, KeptCopy, Snapshot } from '@/backend/keep'
import { Lifecycle, LiveWorkspace, NO_WRITES, type BackendState, type Delays, type WorkspaceEnv, type WritesHooks } from '@/backend/workspace'
import { EMPTY, type DataState } from '@/data/store'
import type { Person } from '@/model/schema'
import { fakeTimers } from './support/fakeTimers'

const WS = 'ws-1'
const ME = 'p-ana'
const ANA: Person = { login: 'ana', githubId: 0, name: 'Ana', avatarUrl: '' }
const T = (s: number) => `2026-10-19T12:00:${String(s).padStart(2, '0')}.000000+00:00`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const DELAYS: Delays = { flush: 1, fetch: 1, askAgain: 10_000, retry: [5], slept: 60_000, cascade: 10, catchUpQuiet: 5, catchUpMax: 20 }

// failures are told with console.warn; the tests make them on purpose
let warn: ReturnType<typeof spyOn>
beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

const fetch = (table: Extract<Incoming, { from: 'fetch' }>['table'], rows: object[]): Incoming => ({ from: 'fetch', table, rows: rows as Record<string, unknown>[] })
const issueRow = (id: string, title: string, s: number) => ({
  id, workspace_id: WS, team_id: 't-eng', number: 1, title, description: '', status: 'todo', priority: 0, assignee_id: null,
  project_id: null, parent_id: null, due_date: null, estimate: null, sort_order: 'a0', duplicate_of: null, former_refs: [],
  created_by: ME, created_at: T(1), updated_at: T(s), completed_at: null, archived_at: null, archived_by: null,
  linear_id: null, changed_at: T(s), extra: {},
})
/** a workspace with ana, team ENG and one issue */
const world = (): Incoming[] => [
  fetch('workspaces', [{ id: WS, name: 'Acme', created_by: ME, created_at: T(0), changed_at: T(0), extra: {} }]),
  fetch('profiles', [{ id: ME, user_id: 'u', login: 'ana', github_id: null, name: 'Ana', avatar_url: '', name_set_here: false, guest_of: null, linear_ids: [], created_at: T(0), changed_at: T(0), extra: {} }]),
  fetch('workspace_members', [{ workspace_id: WS, profile_id: ME, role: 'owner', joined_at: T(0), removed_at: null, changed_at: T(0) }]),
  fetch('teams', [{ id: 't-eng', workspace_id: WS, key: 'ENG', name: 'Engineering', emoji: '', last_number: 1, auto_archive: 6, linear_id: null, created_at: T(0), changed_at: T(0), extra: {} }]),
  fetch('issues', [issueRow('i-1', 'First', 2)]),
]
const update = (id: string, title: string, s: number): Message => ({ table: 'issues', op: 'UPDATE', row: { id, workspace_id: WS, title, changed_at: T(s) } })

/** channels that join when told to, and say what the test says */
class FakeChannels implements ChannelsLike {
  status: Record<Topic, ChannelStatus> = { ws: 'joining', me: 'joining' }
  closing = false
  on: ChannelEvents
  private joined: Promise<'up' | 'slow' | 'denied'>
  constructor(on: ChannelEvents, joined: Promise<'up' | 'slow' | 'denied'>) {
    this.on = on
    this.joined = joined
  }
  async join() {
    const r = await this.joined
    if (r === 'up') for (const t of ['ws', 'me'] as const) this.say(t, 'SUBSCRIBED')
    return r
  }
  say(t: Topic, s: ChannelStatus) {
    this.status[t] = s
    this.on.status(t, s)
  }
  async close() {
    this.closing = true
    this.status = { ws: 'CLOSED', me: 'CLOSED' }
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(reader: Partial<Reader> = {}, joined: Promise<'up' | 'slow' | 'denied'> = Promise.resolve('up'), writes: WritesHooks = NO_WRITES, copy?: CopyHooks) {
  const channels: FakeChannels[] = []
  let events: ConnectionEvents | undefined
  const r: Reader = {
    all: mock(async () => world()),
    changed: mock(async () => ({ inputs: [] as Incoming[], gone: false })),
    inboxIds: async () => new Set<string>(),
    archived: async () => [],
    byKeys: mock(async () => [] as Incoming[]),
    partsOf: async () => [],
    exists: async () => true,
    countArchived: async () => 0,
    ...reader,
  }
  const env: WorkspaceEnv = {
    reader: r,
    channels: (on) => {
      const ch = new FakeChannels(on, joined)
      channels.push(ch)
      return ch
    },
    data: createStore<DataState>()(() => ({ ...EMPTY })),
    status: createStore<SaveStatus>()(() => ({ state: 'loading', pending: 0 })),
    backend: createStore<BackendState>()(() => ({ phase: 'closed' })),
    registry: new Registry(),
    online: () => true,
    signedIn: () => true,
    watch: (on) => {
      events = on
      return () => (events = undefined)
    },
    reopen: () => {},
    delays: DELAYS,
    writes,
    copy,
  }
  const ws = new LiveWorkspace(env, WS, { id: ME, person: ANA })
  return { ws, env, reader: r, channels, events: () => events }
}

describe('opening a workspace', () => {
  test('messages that come while reading are applied after it, newer ones winning', async () => {
    const load = deferred<Incoming[]>()
    const s = setup({ all: () => load.promise })
    const opened = s.ws.open()
    await sleep(1)
    s.channels[0].on.message(update('i-1', 'Renamed meanwhile', 5))
    s.channels[0].on.message(update('i-1', 'Older than the read', 1))
    expect(s.env.data.getState().issues).toEqual({})
    load.resolve(world())
    await opened
    expect(s.env.backend.getState().phase).toBe('open')
    expect(s.env.data.getState().issues['i-1'].title).toBe('Renamed meanwhile')
    expect(s.env.status.getState()).toMatchObject({ state: 'saved', synced: true })
  })

  test('closed while reading: nothing lands in the store, it never says open', async () => {
    const load = deferred<Incoming[]>()
    const s = setup({ all: () => load.promise })
    const opened = s.ws.open()
    await sleep(1)
    await s.ws.close()
    load.resolve(world())
    await opened
    expect(s.env.data.getState().issues).toEqual({})
    expect(s.env.backend.getState().phase).toBe('opening')
    expect(s.channels[0].closing).toBe(true)
    expect(s.events()).toBeUndefined()
  })

  test('anything going wrong while opening shows as a failure that can be tried again', async () => {
    const s = setup({
      all: () => {
        throw new Error('something odd')
      },
    })
    await s.ws.open()
    expect(s.env.backend.getState()).toMatchObject({ phase: 'failed', failure: 'network' })
    expect(s.ws.closed).toBe(true)
  })

  test('refused and not there: gone', async () => {
    const s = setup({ exists: async () => false }, Promise.resolve('denied'))
    await s.ws.open()
    expect(s.env.backend.getState()).toMatchObject({ phase: 'failed', failure: 'gone' })
  })
})

describe('keeping up', () => {
  async function opened(reader: Partial<Reader> = {}) {
    const s = setup(reader)
    await s.ws.open()
    return s
  }

  test('a drop while catching up keeps where to catch up from, and catches up again once back', async () => {
    const first = deferred<{ inputs: Incoming[]; gone: boolean }>()
    const calls: string[] = []
    const s = await opened({
      changed: (since) => {
        calls.push(since)
        return calls.length === 1 ? first.promise : Promise.resolve({ inputs: [], gone: false })
      },
    })
    const mark = s.ws.live.mark!
    const running = s.ws.catchUp()
    s.channels[0].say('ws', 'CHANNEL_ERROR')
    first.resolve({ inputs: [fetch('issues', [issueRow('i-1', 'Newer', 9)])], gone: false })
    await running
    expect(s.env.data.getState().issues['i-1'].title).toBe('Newer')
    expect(s.env.status.getState().state).toBe('reconnecting')
    s.channels[0].say('ws', 'SUBSCRIBED')
    await sleep(5)
    expect(calls).toEqual([sinceMark(mark), sinceMark(mark)])
    expect(s.env.status.getState().state).toBe('saved')
  })

  test('a failed catch-up is tried again, and the chip stays calm', async () => {
    let n = 0
    const s = await opened({
      changed: async () => {
        if (++n === 1) throw new TypeError('Failed to fetch')
        return { inputs: [], gone: false }
      },
    })
    await s.ws.catchUp()
    expect(s.env.status.getState().state).toBe('reconnecting')
    await sleep(20)
    expect(n).toBe(2)
    expect(s.env.status.getState().state).toBe('saved')
    expect(s.env.status.getState().caughtUpAt).toBeNumber()
  })

  test('a catch-up asked for while one runs gives exactly one more', async () => {
    const gate = deferred<void>()
    let n = 0
    const s = await opened({
      changed: async () => {
        n++
        if (n === 1) await gate.promise
        return { inputs: [], gone: false }
      },
    })
    const first = s.ws.catchUp()
    void s.ws.catchUp()
    void s.ws.catchUp()
    gate.resolve()
    await first
    expect(n).toBe(2)
  })

  // the waits below are hundreds of milliseconds and every check sits at least 75 ms from when a catch-up would
  // (or wouldn't) start, so a slow machine doesn't make them flaky
  test('catch-up messages that come together make one catch-up, a while after the last', async () => {
    const changed = mock(async () => ({ inputs: [] as Incoming[], gone: false }))
    const s = await opened({ changed })
    s.env.delays = { ...DELAYS, catchUpQuiet: 300, catchUpMax: 10_000 }
    for (let k = 0; k < 5; k++) s.channels[0].on.message({ op: 'catch_up' })
    await sleep(150)
    for (let k = 0; k < 5; k++) s.channels[0].on.message({ op: 'catch_up', table: 'issues' })
    // 375 ms in: the first burst alone would have caught up at 300; the second moved it to 450
    await sleep(225)
    expect(changed).toHaveBeenCalledTimes(0)
    await sleep(225)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  test('catch-up messages that keep coming still catch up, no later than a while after the first', async () => {
    const changed = mock(async () => ({ inputs: [] as Incoming[], gone: false }))
    const s = await opened({ changed })
    s.env.delays = { ...DELAYS, catchUpQuiet: 300, catchUpMax: 600 }
    // a message every 150 ms for 900 ms: each one alone would wait again, but 600 ms after the first it catches up
    for (let k = 0; k < 6; k++) {
      s.channels[0].on.message({ op: 'catch_up', table: 'issues' })
      await sleep(150)
    }
    expect(changed).toHaveBeenCalledTimes(1)
    await sleep(450)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  test('while your import saves, catch-up messages wait; when it is done it catches up once', async () => {
    const changed = mock(async () => ({ inputs: [] as Incoming[], gone: false }))
    const s = await opened({ changed })
    s.env.delays = { ...DELAYS, catchUpQuiet: 50, catchUpMax: 1_000 }
    // one waiting already when the import starts: it is left too
    s.channels[0].on.message({ op: 'catch_up', table: 'issues' })
    await sleep(10)
    s.ws.holdCatchUp()
    for (let k = 0; k < 5; k++) s.channels[0].on.message({ op: 'catch_up', table: 'issues' })
    await sleep(200)
    expect(changed).toHaveBeenCalledTimes(0)
    await s.ws.releaseCatchUp()
    expect(changed).toHaveBeenCalledTimes(1)
    await sleep(200)
    expect(changed).toHaveBeenCalledTimes(1)
    // with nothing held back it still catches up once: what the import saved comes in
    s.ws.holdCatchUp()
    await s.ws.releaseCatchUp()
    expect(changed).toHaveBeenCalledTimes(2)
  })

  test('a teammate’s import of archived issues: catching up brings them into an archive already read', async () => {
    const archived = mock(async () => [] as Incoming[])
    const old = { ...issueRow('i-7', 'Imported, archived', 9), archived_at: T(9), status: 'done' }
    const s = await opened({ archived, changed: async () => ({ inputs: [fetch('issues', [old])], gone: false }) })
    s.env.delays = { ...DELAYS, catchUpQuiet: 20, catchUpMax: 1_000 }
    s.ws.loadArchive()
    await sleep(5)
    s.channels[0].on.message({ op: 'catch_up', table: 'issues' })
    await sleep(100)
    // read once, never again: the catch-up brought the archived issue
    expect(archived).toHaveBeenCalledTimes(1)
    expect(s.env.data.getState().archive['i-7'].title).toBe('Imported, archived')
    expect(s.env.data.getState().issues['i-7']).toBeUndefined()
  })

  test('a row asked for is asked once in a while; a failed ask is asked again after catching up', async () => {
    let fail = true
    const byKeys = mock(async () => {
      if (fail) throw new TypeError('Failed to fetch')
      return [] as Incoming[]
    })
    const s = await opened({ byKeys })
    // long enough that the try again can't come within the first look below
    s.env.delays = { ...DELAYS, retry: [25] }
    // an update for an issue we don't have: it is asked for
    s.channels[0].on.message(update('i-9', 'Unknown', 9))
    s.channels[0].on.message(update('i-9', 'Unknown', 9))
    await sleep(10)
    expect(byKeys).toHaveBeenCalledTimes(1)
    fail = false
    // the failure caught up after a moment, then asked again
    await sleep(30)
    expect(byKeys).toHaveBeenCalledTimes(2)
    // answered now: the same update doesn't ask again
    s.channels[0].on.message(update('i-9', 'Unknown', 9))
    await sleep(10)
    expect(byKeys).toHaveBeenCalledTimes(2)
  })

  test('the workspace going away while open says so on the chip', async () => {
    const s = await opened()
    s.channels[0].on.message({ table: 'workspaces', op: 'DELETE', row: { id: WS } })
    await sleep(5)
    expect(s.env.backend.getState()).toMatchObject({ phase: 'gone', gone: 'deleted' })
    expect(s.env.status.getState().state).toBe('closed')
  })

  const removed = (): Message => ({ table: 'workspace_members', op: 'UPDATE', row: { workspace_id: WS, profile_id: ME, role: 'owner', removed_at: T(9), changed_at: T(9) } })

  test('removed by someone else: "You\'re no longer in this workspace"', async () => {
    const s = await opened()
    s.channels[0].on.message(removed())
    await sleep(5)
    expect(s.env.backend.getState()).toMatchObject({ phase: 'gone', gone: 'removed' })
  })

  test('leaving yourself: nothing to say, and it closes; a refused leave stays open', async () => {
    const made: ReturnType<typeof setup>[] = []
    const backend = createStore<BackendState>()(() => ({ phase: 'closed' }))
    const life = new Lifecycle(
      () => {
        const s = setup()
        made.push(s)
        return s.ws
      },
      backend,
      new Registry(),
    )
    await life.open(WS, { id: ME, person: ANA })
    await sleep(5)
    const s = made[0]
    const phases: string[] = []
    // setup() makes it a whole store; the workspace only needs getState and setState
    const phase = s.env.backend as StoreApi<BackendState>
    phase.subscribe((b) => phases.push(b.phase))

    await expect(life.leave(async () => Promise.reject(new Error('A workspace needs at least one owner.')))).rejects.toThrow('owner')
    expect(s.ws.leaving).toBe(false)
    expect(life.current).toBe(s.ws)

    // the database's message that you left comes before the leave call returns
    await life.leave(async () => {
      s.channels[0].on.message(removed())
      await sleep(5)
    })
    expect(phases).not.toContain('gone')
    expect(life.current).toBeNull()
    expect(backend.getState().phase).toBe('closed')
    expect(s.ws.closed).toBe(true)
  })
})

describe('one workspace at a time', () => {
  test('quick opens and closes end closed, with every channel left', async () => {
    const made: ReturnType<typeof setup>[] = []
    const backend = createStore<BackendState>()(() => ({ phase: 'closed' }))
    const life = new Lifecycle(
      () => {
        const s = setup()
        made.push(s)
        return s.ws
      },
      backend,
      new Registry(),
    )
    const me = { id: ME, person: ANA }
    void life.open(WS, me)
    void life.close()
    void life.open(WS, me)
    await life.close()
    expect(made).toHaveLength(2)
    expect(made.every((s) => s.ws.closed)).toBe(true)
    expect(life.current).toBeNull()
    expect(backend.getState().phase).toBe('closed')
    await life.open(WS, me)
    await sleep(5)
    expect(made[2].env.backend.getState().phase).toBe('open')
  })
})

describe('the writer and the open workspace', () => {
  /** writer hooks that write down what was asked of them */
  function recording(status = { pending: 0, waiting: false }) {
    const calls: string[] = []
    const hooks: WritesHooks = {
      attach: (t) => calls.push(`attach ${t instanceof LiveWorkspace ? t.workspaceId : '?'}`),
      detach: () => calls.push('detach'),
      finish: async (ms) => {
        calls.push(`finish ${ms}`)
      },
      stop: () => calls.push('stop'),
      status: () => status,
    }
    return { calls, hooks, status }
  }

  test('attached once open; the chip counts what is waiting', async () => {
    const r = recording({ pending: 2, waiting: false })
    const s = setup({}, Promise.resolve('up'), r.hooks)
    await s.ws.open()
    expect(r.calls).toEqual([`attach ${WS}`])
    expect(s.env.status.getState()).toMatchObject({ state: 'saving', pending: 2, waiting: false })
    r.status.waiting = true
    s.ws.refresh()
    expect(s.env.status.getState().state).toBe('error')
  })

  test('read again from the start: detached and attached to the new copy; closing sends what waits, then stops', async () => {
    const r = recording()
    const made: ReturnType<typeof setup>[] = []
    const life = new Lifecycle(
      () => {
        const s = setup({}, Promise.resolve('up'), r.hooks)
        made.push(s)
        return s.ws
      },
      createStore<BackendState>()(() => ({ phase: 'closed' })),
      new Registry(),
      { writes: r.hooks },
    )
    await life.open(WS, { id: ME, person: ANA })
    await sleep(5)
    life.reopen(made[0].ws)
    await sleep(5)
    expect(made).toHaveLength(2)
    expect(r.calls).toEqual([`attach ${WS}`, 'detach', `attach ${WS}`])
    await life.close()
    expect(r.calls.slice(3)).toEqual(['finish 3000'])
  })

  test('the workspace going away stops the writer at once', async () => {
    const r = recording()
    const s = setup({}, Promise.resolve('up'), r.hooks)
    await s.ws.open()
    s.channels[0].on.message({ table: 'workspaces', op: 'DELETE', row: { id: WS } })
    await sleep(5)
    expect(r.calls).toEqual([`attach ${WS}`, 'stop'])
  })

  test('a deleted team catches up a moment later, for the messages its many rows may have missed', async () => {
    const changed = mock(async () => ({ inputs: [] as Incoming[], gone: false }))
    const s = setup({ changed })
    await s.ws.open()
    s.channels[0].on.message({ table: 'teams', op: 'DELETE', row: { id: 't-eng' } })
    await sleep(30)
    expect(changed).toHaveBeenCalledTimes(1)
  })
})

describe('reading the workspace again', () => {
  test('a quiet workspace (its newest change is old) still catches up; 44 days without catching up reads it again', async () => {
    const changed = mock(async () => ({ inputs: [] as Incoming[], gone: false }))
    const reopen = mock(() => {})
    const s = setup({ changed })
    s.env.reopen = reopen
    await s.ws.open()
    s.ws.live = { ...s.ws.live, mark: '2025-01-01T00:00:00.000000+00:00' }
    await s.ws.catchUp()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(reopen).not.toHaveBeenCalled()
    const later = Date.now() + 45 * 86_400_000
    s.env.now = () => later
    await s.ws.catchUp()
    expect(reopen).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  test('what is on screen and the ids it names stay until the new copy is in', async () => {
    const load = deferred<Incoming[]>()
    const made: ReturnType<typeof setup>[] = []
    const data = createStore<DataState>()(() => ({ ...EMPTY }))
    const registry = new Registry()
    const backend = createStore<BackendState>()(() => ({ phase: 'closed' }))
    const life = new Lifecycle(
      () => {
        const s = setup(made.length ? { all: () => load.promise } : {})
        Object.assign(s.env, { data, registry, backend })
        made.push(s)
        return s.ws
      },
      backend,
      registry,
    )
    await life.open(WS, { id: ME, person: ANA })
    await sleep(5)
    expect(data.getState().issues['i-1']).toBeDefined()
    life.reopen(made[0].ws)
    await sleep(5)
    expect(made).toHaveLength(2)
    expect(data.getState().issues['i-1'].title).toBe('First')
    expect(registry.teamId('ENG')).toBe('t-eng')
    load.resolve(world().map((i) => (i.from === 'fetch' && i.table === 'issues' ? fetch('issues', [issueRow('i-1', 'Read again', 3)]) : i)))
    await sleep(5)
    expect(data.getState().issues['i-1'].title).toBe('Read again')
    expect(backend.getState().phase).toBe('open')
  })

  test('a failed open keeps what waits for "Try again"; opening another workspace sends it first', async () => {
    const calls: string[] = []
    const hooks: WritesHooks = {
      attach: (t) => calls.push(`attach ${t.workspaceId}`),
      detach: () => calls.push('detach'),
      finish: async () => {
        calls.push('finish')
      },
      stop: () => calls.push('stop'),
      status: () => ({ pending: 0, waiting: false }),
    }
    let fail = true
    const backend = createStore<BackendState>()(() => ({ phase: 'closed' }))
    const life = new Lifecycle(
      (id) => {
        const s = setup({
          all: async () => {
            if (fail) throw new TypeError('Failed to fetch')
            return world()
          },
        }, Promise.resolve('up'), hooks)
        Object.assign(s.env, { backend })
        return new LiveWorkspace(s.env, id, { id: ME, person: ANA })
      },
      backend,
      new Registry(),
      { writes: hooks },
    )
    await life.open(WS, { id: ME, person: ANA })
    await sleep(5)
    expect(backend.getState().phase).toBe('failed')
    // "Try again": the screen closes it and opens it once more
    await life.close()
    fail = false
    await life.open(WS, { id: ME, person: ANA })
    await sleep(5)
    expect(calls).toEqual(['detach', `attach ${WS}`])
    // failed again, then another workspace
    fail = true
    await life.open('ws-2', { id: ME, person: ANA })
    await sleep(5)
    await life.close()
    await life.open(WS, { id: ME, person: ANA })
    await sleep(5)
    expect(calls).toEqual(['detach', `attach ${WS}`, 'finish', 'detach', 'finish'])
  })
})


describe('the copy kept in this browser', () => {
  const inbox = (id: string, s: number) => ({ id, workspace_id: WS, recipient_id: ME, type: 'comment', issue_id: 'i-1', comment_id: null, actor_id: ME, status: null, at: T(s), read_at: null, changed_at: T(s), extra: {} })
  /** the world as kept a while ago: complete up to T(30), with two inbox notes */
  const keptCopy = (more: Partial<KeptCopy> = {}): KeptCopy => ({
    inputs: [...world(), fetch('inbox', [inbox('n-1', 3), inbox('n-2', 4)])],
    mark: T(30),
    caughtUpAt: Date.now() - 86_400_000,
    archive: false,
    ...more,
  })
  type Written = { mark: string; caughtUpAt: number; archive: boolean; issues: string[]; local: number }
  /** copy hooks on fake timers that hand out `kept` and write down what they were asked to keep */
  function keeping(kept: KeptCopy | null = keptCopy(), o: { write?: CopyHooks['write']; writeNow?: CopyHooks['writeNow'] } = {}) {
    const written: Written[] = []
    const touched: number[] = []
    let dropped = 0
    const timers = fakeTimers()
    const record = (c: Snapshot) => written.push({ mark: c.mark, caughtUpAt: c.caughtUpAt, archive: c.archive, issues: Object.keys(c.live.server.issues), local: Object.keys(c.live.local).length })
    const hooks: CopyHooks = {
      read: async () => kept,
      write:
        o.write ??
        (async (c) => {
          record(c)
          return 'written'
        }),
      writeNow: o.writeNow,
      touch: async (_mark, at) => {
        touched.push(at)
        return true
      },
      drop: async () => {
        dropped++
      },
      timing: { quiet: 3_000, most: 30_000 },
      timers,
    }
    return { hooks, written, touched, timers, record, dropped: () => dropped }
  }

  test('it shows at once; what changed since it comes next, then what was held meanwhile', async () => {
    const changes = deferred<{ inputs: Incoming[]; gone: boolean }>()
    const changed = mock((_since: string, _members: ReadonlySet<string>) => changes.promise)
    const s = setup({ changed }, Promise.resolve('up'), NO_WRITES, keeping().hooks)
    const opened = s.ws.open()
    await sleep(2)
    // the copy shows, and the chip says the latest is still coming
    expect(s.env.backend.getState().phase).toBe('open')
    expect(s.env.data.getState().issues['i-1'].title).toBe('First')
    expect(s.env.status.getState()).toMatchObject({ state: 'loading', synced: false })
    expect(s.ws.source).toBe('copy')
    expect(changed).toHaveBeenCalledWith(sinceMark(T(30)), new Set([ME]))
    expect(s.reader.all).not.toHaveBeenCalled()
    // deleted while the changes were read: the delete wins over the row read before it
    s.channels[0].on.message({ table: 'issues', op: 'DELETE', row: { id: 'i-2' } })
    changes.resolve({ inputs: [fetch('issues', [issueRow('i-1', 'Renamed while away', 40), issueRow('i-2', 'New, then deleted', 41)])], gone: false })
    await opened
    await sleep(2)
    expect(s.env.data.getState().issues['i-1'].title).toBe('Renamed while away')
    expect(s.env.data.getState().issues['i-2']).toBeUndefined()
    expect(s.env.status.getState()).toMatchObject({ state: 'saved', synced: true })
  })

  test('while the channels are still joining, the copy shows and the chip says Loading', async () => {
    const joined = deferred<'up' | 'slow' | 'denied'>()
    const s = setup({}, joined.promise, NO_WRITES, keeping().hooks)
    const opened = s.ws.open()
    await sleep(2)
    expect(s.env.backend.getState().phase).toBe('open')
    expect(s.env.status.getState().state).toBe('loading')
    joined.resolve('up')
    await opened
    expect(s.env.status.getState()).toMatchObject({ state: 'saved', synced: true })
  })

  test('inbox notes that went while away go (they leave nothing behind)', async () => {
    const s = setup({ inboxIds: async () => new Set(['n-1']) }, Promise.resolve('up'), NO_WRITES, keeping().hooks)
    await s.ws.open()
    await sleep(2)
    expect(s.env.data.getState().inbox.map((n) => n.id)).toEqual(['n-1'])
  })

  test('the changes can’t be read: the copy stays on screen, and catching up from it is tried again', async () => {
    const calls: string[] = []
    const s = setup(
      {
        changed: async (since) => {
          calls.push(since)
          if (calls.length === 1) throw new TypeError('Failed to fetch')
          return { inputs: [fetch('issues', [issueRow('i-1', 'Later', 40)])], gone: false }
        },
      },
      Promise.resolve('up'),
      NO_WRITES,
      keeping().hooks,
    )
    await s.ws.open()
    expect(s.env.backend.getState().phase).toBe('open')
    expect(s.env.status.getState().state).toBe('reconnecting')
    expect(s.env.data.getState().issues['i-1'].title).toBe('First')
    await sleep(20)
    expect(calls).toEqual([sinceMark(T(30)), sinceMark(T(30))])
    expect(s.env.data.getState().issues['i-1'].title).toBe('Later')
    expect(s.env.status.getState()).toMatchObject({ state: 'saved', synced: true })
  })

  test('a copy that reads back but can’t be applied goes, and everything is read instead', async () => {
    const k = keeping(keptCopy({ inputs: [fetch('issues', [null as unknown as object])] }))
    const s = setup({}, Promise.resolve('up'), NO_WRITES, k.hooks)
    await s.ws.open()
    expect(s.env.backend.getState().phase).toBe('open')
    expect(s.ws.source).toBe('full')
    expect(s.reader.all).toHaveBeenCalledTimes(1)
    expect(s.env.data.getState().issues['i-1'].title).toBe('First')
    expect(k.dropped()).toBe(1)
    // a fresh copy is kept once everything is in
    await k.timers.tick(3_000)
    expect(k.written.map((w) => w.mark)).toEqual([T(2)])
  })

  test('the archive asked for while the copy shows is read once the changes are in', async () => {
    const changes = deferred<{ inputs: Incoming[]; gone: boolean }>()
    const archived = mock(async () => [] as Incoming[])
    const s = setup({ changed: () => changes.promise, archived }, Promise.resolve('up'), NO_WRITES, keeping().hooks)
    const opened = s.ws.open()
    await sleep(2)
    // what the Archived tab does as it shows
    s.ws.loadArchive()
    expect(archived).not.toHaveBeenCalled()
    changes.resolve({ inputs: [], gone: false })
    await opened
    await sleep(2)
    expect(archived).toHaveBeenCalledTimes(1)
    expect(s.env.data.getState().archiveLoaded).toBe(true)
  })

  test('your unsaved changes show on the copy before the changes since it are in', async () => {
    const changes = deferred<{ inputs: Incoming[]; gone: boolean }>()
    const calls: string[] = []
    const hooks: WritesHooks = { ...NO_WRITES, attach: () => calls.push(`attach, copy shown: ${String(!!s.env.data.getState().issues['i-1'])}`) }
    const s = setup({ changed: () => changes.promise }, Promise.resolve('up'), hooks, keeping().hooks)
    void s.ws.open()
    await sleep(2)
    expect(calls).toEqual(['attach, copy shown: true'])
    changes.resolve({ inputs: [], gone: false })
  })

  test('the workspace went while away: its copy goes too', async () => {
    const k = keeping()
    const s = setup({ exists: async () => false }, Promise.resolve('denied'), NO_WRITES, k.hooks)
    await s.ws.open()
    expect(s.env.backend.getState()).toMatchObject({ phase: 'failed', failure: 'gone' })
    expect(k.dropped()).toBe(1)
    const g = keeping()
    const t = setup({ changed: async () => ({ inputs: [], gone: true }) }, Promise.resolve('up'), NO_WRITES, g.hooks)
    await t.ws.open()
    expect(t.env.backend.getState()).toMatchObject({ phase: 'gone', gone: 'missing' })
    expect(g.dropped()).toBe(1)
    await g.timers.tick(60_000)
    expect(g.written).toEqual([])
  })

  test('kept 3 s after things change, never twice the same; a gap keeps its mark', async () => {
    const k = keeping(null)
    const s = setup({}, Promise.resolve('up'), NO_WRITES, k.hooks)
    await s.ws.open()
    expect(s.ws.source).toBe('full')
    await k.timers.tick(2_999)
    expect(k.written).toEqual([])
    await k.timers.tick(1)
    expect(k.written).toEqual([{ mark: T(2), caughtUpAt: expect.any(Number), archive: false, issues: ['i-1'], local: 0 }])
    await s.ws.keepNow()
    expect(k.written).toHaveLength(1)
    // a drop: messages may be missed from T(2) on, so a later change can't move the copy's mark past it
    s.channels[0].say('ws', 'CHANNEL_ERROR')
    s.channels[0].on.message(update('i-1', 'Later', 9))
    await sleep(5)
    await k.timers.tick(3_000)
    expect(k.written.map((w) => w.mark)).toEqual([T(2), T(2)])
  })

  test('up to date again with nothing new: the kept copy only says so', async () => {
    const k = keeping(null)
    const s = setup({}, Promise.resolve('up'), NO_WRITES, k.hooks)
    await s.ws.open()
    await k.timers.tick(3_000)
    expect(k.written).toHaveLength(1)
    await sleep(2)
    await s.ws.catchUp()
    await k.timers.tick(3_000)
    expect(k.written).toHaveLength(1)
    expect(k.touched).toHaveLength(1)
  })

  test('too big to keep: not tried again on every change, until it has fewer rows', async () => {
    let tries = 0
    const k = keeping(null, {
      write: async () => {
        tries++
        return 'too-big'
      },
    })
    const s = setup({}, Promise.resolve('up'), NO_WRITES, k.hooks)
    await s.ws.open()
    await k.timers.tick(3_000)
    expect(tries).toBe(1)
    expect(s.ws.keeper.reason).toBe('too-big')
    s.channels[0].on.message({ table: 'issues', op: 'INSERT', row: issueRow('i-2', 'One more', 9) })
    await sleep(5)
    await k.timers.tick(3_000)
    expect(tries).toBe(1)
    // fewer rows than when it was too big: tried again
    s.channels[0].on.message({ table: 'issues', op: 'DELETE', row: { id: 'i-2' } })
    s.channels[0].on.message({ table: 'issues', op: 'DELETE', row: { id: 'i-1' } })
    await sleep(5)
    await k.timers.tick(3_000)
    expect(tries).toBe(2)
  })

  test('hidden for a moment with the channels up: nothing was missed, so the copy’s mark moves on', async () => {
    const k = keeping(null)
    const s = setup({}, Promise.resolve('up'), NO_WRITES, k.hooks)
    await s.ws.open()
    s.events()!.hidden()
    await sleep(2)
    s.channels[0].on.message(update('i-1', 'While hidden', 9))
    await sleep(2)
    s.events()!.visible(1_000)
    await s.ws.keepNow()
    expect(k.written.map((w) => w.mark)).toEqual([T(2), T(9)])
  })

  test('the page going keeps the copy at once while up to date, and the usual way otherwise', async () => {
    const now: string[] = []
    const k = keeping(null, {
      writeNow: (c) => {
        now.push(c.mark)
        return true
      },
    })
    const s = setup({}, Promise.resolve('up'), NO_WRITES, k.hooks)
    await s.ws.open()
    s.channels[0].on.message(update('i-1', 'Just now', 9))
    await sleep(2)
    void s.ws.keepAtOnce()
    expect(now).toEqual([T(9)])
    // and nothing more to keep after that
    await k.timers.tick(3_000)
    expect(k.written).toEqual([])
    // not up to date (a channel dropped): compared with what's kept, as usual
    s.channels[0].say('ws', 'CHANNEL_ERROR')
    s.channels[0].on.message(update('i-1', 'Later', 10))
    await sleep(2)
    await s.ws.keepAtOnce()
    expect(now).toEqual([T(9)])
    expect(k.written.map((w) => w.mark)).toEqual([T(9)])
  })

  test('closing keeps the copy first; a workspace still opening keeps none', async () => {
    const k = keeping(null)
    const s = setup({}, Promise.resolve('up'), NO_WRITES, k.hooks)
    await s.ws.open()
    s.channels[0].on.message(update('i-1', 'Just now', 9))
    await sleep(2)
    await s.ws.close()
    expect(k.written.map((w) => w.mark)).toEqual([T(9)])
    const load = deferred<Incoming[]>()
    const o = keeping(null)
    const t = setup({ all: () => load.promise }, Promise.resolve('up'), NO_WRITES, o.hooks)
    const opened = t.ws.open()
    await sleep(1)
    await t.ws.close()
    load.resolve(world())
    await opened
    expect(o.written).toEqual([])
  })

  test('the archive in the copy counts as read', async () => {
    const archived = mock(async () => [] as Incoming[])
    const s = setup({ archived }, Promise.resolve('up'), NO_WRITES, keeping(keptCopy({ archive: true })).hooks)
    await s.ws.open()
    expect(s.env.data.getState().archiveLoaded).toBe(true)
    s.ws.loadArchive()
    expect(archived).not.toHaveBeenCalled()
  })
})
