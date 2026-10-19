import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { createStore } from 'zustand/vanilla'
import type { Incoming } from '@/backend/apply'
import type { ConnectionEvents } from '@/backend/connection'
import type { ChannelEvents, ChannelsLike, ChannelStatus, Topic } from '@/backend/live'
import { sinceMark, type Reader } from '@/backend/load'
import { Registry } from '@/backend/registry'
import type { SaveStatus } from '@/backend/status'
import type { Message } from '@/backend/tables'
import { Lifecycle, LiveWorkspace, NO_WRITES, type BackendState, type Delays, type WorkspaceEnv, type WritesHooks } from '@/backend/workspace'
import { EMPTY, type DataState } from '@/data/store'
import type { Person } from '@/model/schema'

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

function setup(reader: Partial<Reader> = {}, joined: Promise<'up' | 'slow' | 'denied'> = Promise.resolve('up'), writes: WritesHooks = NO_WRITES) {
  const channels: FakeChannels[] = []
  let events: ConnectionEvents | undefined
  const r: Reader = {
    all: mock(async () => world()),
    changed: mock(async () => ({ inputs: [] as Incoming[], full: [], gone: false })),
    table: async () => [],
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
    const first = deferred<{ inputs: Incoming[]; full: never[]; gone: boolean }>()
    const calls: string[] = []
    const s = await opened({
      changed: (since) => {
        calls.push(since)
        return calls.length === 1 ? first.promise : Promise.resolve({ inputs: [], full: [], gone: false })
      },
    })
    const mark = s.ws.live.mark!
    const running = s.ws.catchUp()
    s.channels[0].say('ws', 'CHANNEL_ERROR')
    first.resolve({ inputs: [fetch('issues', [issueRow('i-1', 'Newer', 9)])], full: [], gone: false })
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
        return { inputs: [], full: [], gone: false }
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
        return { inputs: [], full: [], gone: false }
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
    const changed = mock(async () => ({ inputs: [] as Incoming[], full: [], gone: false }))
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
    const changed = mock(async () => ({ inputs: [] as Incoming[], full: [], gone: false }))
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
    const changed = mock(async () => ({ inputs: [] as Incoming[], full: [], gone: false }))
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

  test('an import that brought archived issues reads an archive already read again, and not one never read', async () => {
    const archived = mock(async () => [] as Incoming[])
    const s = await opened({ archived })
    s.ws.reloadArchive()
    await sleep(5)
    expect(archived).toHaveBeenCalledTimes(0)
    s.ws.loadArchive()
    // still reading: once it's in, it's read once more
    s.ws.reloadArchive()
    await sleep(5)
    expect(archived).toHaveBeenCalledTimes(2)
    s.ws.reloadArchive()
    await sleep(5)
    expect(archived).toHaveBeenCalledTimes(3)
    expect(s.env.data.getState().archiveLoaded).toBe(true)
  })

  test('a teammate’s import about issues reads an open archive again after catching up; one about labels doesn’t', async () => {
    const archived = mock(async () => [] as Incoming[])
    const s = await opened({ archived })
    s.env.delays = { ...DELAYS, catchUpQuiet: 20, catchUpMax: 1_000 }
    s.channels[0].on.message({ op: 'catch_up', table: 'issues' })
    await sleep(100)
    // never read here: nothing to read again
    expect(archived).toHaveBeenCalledTimes(0)
    s.ws.loadArchive()
    await sleep(5)
    expect(archived).toHaveBeenCalledTimes(1)
    s.channels[0].on.message({ op: 'catch_up', table: 'labels' })
    await sleep(100)
    expect(archived).toHaveBeenCalledTimes(1)
    s.channels[0].on.message({ op: 'catch_up', table: 'comments' })
    await sleep(100)
    expect(archived).toHaveBeenCalledTimes(2)
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
      r.hooks,
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
    const changed = mock(async () => ({ inputs: [] as Incoming[], full: [], gone: false }))
    const s = setup({ changed })
    await s.ws.open()
    s.channels[0].on.message({ table: 'teams', op: 'DELETE', row: { id: 't-eng' } })
    await sleep(30)
    expect(changed).toHaveBeenCalledTimes(1)
  })
})
