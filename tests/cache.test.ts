import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { applyRows, emptyLive, type Incoming, type LiveState, type StoreSlice } from '@/backend/apply'
import { IDBFactory as FakeIDBFactory, IDBKeyRange as FakeIDBKeyRange, IDBObjectStore as FakeIDBObjectStore } from 'fake-indexeddb'
import { CACHE_FORMAT, cacheMark, check, decode, encode, inboxGone, inputsOf, keepStored, rowCount, rowsOf, SCHEMA_ID, shrink, wanted, type CacheId, type CacheMeta } from '@/backend/cache'
import {
  CACHE_DB,
  cacheState,
  dropCache,
  idbKV,
  pruneCaches,
  readCache,
  setCacheKV,
  stopCaching,
  touchCache,
  wipeCaches,
  writeCache,
  writeCacheNow,
  type CacheKV,
} from '@/backend/cacheStore'
import { compareCopy, Saver, type Shot } from '@/backend/keep'
import { Registry } from '@/backend/registry'
import type { Row } from '@/backend/tables'
import { EMPTY } from '@/data/store'
import { fakeTimers } from './support/fakeTimers'

const WS = 'ws-1'
const ME = 'p-ana'
const ID: CacheId = { project: 'db.example.co', profileId: ME, workspaceId: WS }
const DAY = 86_400_000
/** a database time, `s` seconds after noon, to the microsecond */
const T = (s: number, us = '123456') => `2026-10-19T12:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${us}+00:00`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let warn: ReturnType<typeof spyOn>
beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

type Loose = Record<string, unknown>
const fetch = (table: Extract<Incoming, { from: 'fetch' }>['table'], rows: object[]): Incoming => ({ from: 'fetch', table, rows: rows as Loose[] })

const issueRow = (id: string, s: number, more: Partial<Row<'issues'>> = {}): Row<'issues'> => ({
  id,
  workspace_id: WS,
  team_id: 't-eng',
  number: 1,
  title: `Issue ${id}`,
  description: 'Text',
  status: 'todo',
  priority: 0,
  assignee_id: ME,
  project_id: null,
  parent_id: null,
  due_date: null,
  estimate: null,
  sort_order: 'a0',
  duplicate_of: null,
  former_refs: [],
  created_by: ME,
  created_at: T(1),
  updated_at: T(s),
  completed_at: null,
  archived_at: null,
  archived_by: null,
  linear_id: null,
  changed_at: T(s),
  extra: {},
  ...more,
})
const comment = (id: string, issue: string, s: number) => ({ id, workspace_id: WS, issue_id: issue, author_id: ME, body: `On ${issue}`, created_at: T(s), edited_at: null, linear_id: null, changed_at: T(s), extra: {} })
const note = (id: string, s: number) => ({ id, workspace_id: WS, recipient_id: ME, type: 'comment', issue_id: 'i-1', comment_id: null, actor_id: 'p-bob', status: null, at: T(s), read_at: null, changed_at: T(s), extra: {} })
const label = (id: string, s: number) => ({ id, workspace_id: WS, name: id, color: '#f00', linear_id: null, changed_at: T(s), extra: {} })
const tagged = (issue: string, l: string, s: number) => ({ workspace_id: WS, issue_id: issue, label_id: l, changed_at: T(s) })

/** a workspace: ana and bob, team ENG with both, labels, issues 1 to 3 (3 archived), comments, a follower, notes */
function world(): Incoming[] {
  const profile = (id: string, login: string) => ({ id, user_id: `u-${login}`, login, github_id: null, name: login, avatar_url: '', name_set_here: false, guest_of: null, linear_ids: [], created_at: T(0), changed_at: T(0), extra: {} })
  return [
    fetch('workspaces', [{ id: WS, name: 'Acme', created_by: ME, created_at: T(0), changed_at: T(0), extra: {} }]),
    fetch('profiles', [profile(ME, 'ana'), profile('p-bob', 'bob')]),
    fetch('workspace_members', [
      { workspace_id: WS, profile_id: ME, role: 'owner', joined_at: T(0), removed_at: null, changed_at: T(0) },
      { workspace_id: WS, profile_id: 'p-bob', role: 'member', joined_at: T(0), removed_at: null, changed_at: T(0) },
    ]),
    fetch('teams', [{ id: 't-eng', workspace_id: WS, key: 'ENG', name: 'Engineering', emoji: '', last_number: 3, auto_archive: 6, linear_id: null, created_at: T(0), changed_at: T(0), extra: {} }]),
    fetch('team_members', [
      { workspace_id: WS, team_id: 't-eng', profile_id: ME, changed_at: T(1) },
      { workspace_id: WS, team_id: 't-eng', profile_id: 'p-bob', changed_at: T(1) },
    ]),
    fetch('labels', [label('l-bug', 1), label('l-ui', 1)]),
    fetch('issues', [issueRow('i-1', 10), issueRow('i-2', 11, { number: 2 }), issueRow('i-3', 12, { number: 3, status: 'done', archived_at: T(12) })]),
    fetch('issue_labels', [tagged('i-1', 'l-bug', 10), tagged('i-2', 'l-ui', 11), tagged('i-3', 'l-bug', 12)]),
    fetch('issue_followers', [{ workspace_id: WS, issue_id: 'i-1', profile_id: 'p-bob', changed_at: T(10) }]),
    fetch('comments', [comment('c-1', 'i-1', 13), comment('c-2', 'i-3', 14)]),
    fetch('inbox', [note('n-1', 15), note('n-2', 16)]),
  ]
}

const ctx = (registry = new Registry()) => ({ workspaceId: WS, meId: ME, registry })
const load = (inputs: Incoming[], from: LiveState = emptyLive(), data: StoreSlice = { ...EMPTY }, registry?: Registry) => applyRows(from, data, inputs, ctx(registry))
/** what a copy holds, read back into a fresh state */
function roundTrip(live: LiveState) {
  const e = encode(live, { id: ID, mark: live.mark!, caughtUpAt: 1, archive: true, now: 2 })!
  return { e, back: load(inputsOf(decode(e.body)!)) }
}
const noBigint = (v: unknown): boolean => (typeof v === 'bigint' ? false : v && typeof v === 'object' ? Object.values(v).every(noBigint) : true)

describe('what a copy holds', () => {
  test('read back, it is the same copy of the database, groups and comment owners included', () => {
    const first = load(world())
    const { e, back } = roundTrip(first.state)
    expect(back.state.server).toEqual(first.state.server)
    expect(back.state.mark).toBe(first.state.mark)
    expect(back.patch.issues).toEqual(first.patch.issues)
    expect(back.patch.archive).toEqual(first.patch.archive)
    expect(back.patch.comments).toEqual(first.patch.comments)
    expect(back.patch.teams).toEqual(first.patch.teams)
    expect(noBigint(JSON.parse(e.body))).toBe(true)
    expect(JSON.parse(JSON.stringify(e.meta))).toEqual(e.meta)
    // the raw database time, to the microsecond
    expect(e.meta.mark).toBe(T(16))
    expect(e.meta.chars).toBe(e.body.length)
  })

  test('a row whose text is still to come stays so, and is asked for again', () => {
    const first = load([...world(), { from: 'message', message: { table: 'issues', op: 'UPDATE', row: { id: 'i-1', workspace_id: WS, title: 'Long', changed_at: T(20), partial: true } } }])
    expect(first.state.partial['issues:i-1']).toBe(true)
    const { back } = roundTrip(first.state)
    expect(back.state.partial['issues:i-1']).toBe(true)
    expect(back.fetch).toContainEqual({ table: 'issues', key: { id: 'i-1' } })
  })

  test('only the database’s rows: your changes on their way are left out', () => {
    const first = load(world())
    const mine = load(
      [
        { from: 'local', change: { table: 'issues', op: 'insert', key: { id: 'i-9' }, fields: { ...issueRow('i-9', 30) } } },
        { from: 'local', change: { table: 'issues', op: 'update', key: { id: 'i-1' }, fields: { title: 'Mine, not saved' } } },
        { from: 'local', change: { table: 'issues', op: 'delete', key: { id: 'i-2' } } },
      ] as Incoming[],
      first.state,
      { ...EMPTY, ...first.patch } as StoreSlice,
    )
    const rows = rowsOf(mine.state)
    const ids = rows.issues?.map((r) => r.id)
    expect(ids).toContain('i-2')
    expect(ids).not.toContain('i-9')
    expect(rows.issues?.find((r) => r.id === 'i-1')?.title).toBe('Issue i-1')
  })

  test('too big: the archive is left out, and if that isn’t enough nothing is kept', () => {
    const live = load(world()).state
    const rows = shrink(rowsOf(live))
    expect(rows.issues?.map((r) => r.id).sort()).toEqual(['i-1', 'i-2'])
    expect(rows.issue_labels?.map((r) => r.issue_id).sort()).toEqual(['i-1', 'i-2'])
    expect(rows.comments?.map((r) => r.id)).toEqual(['c-1'])
    const full = encode(live, { id: ID, mark: T(16), caughtUpAt: 1, archive: true, now: 2 })!
    const small = encode(live, { id: ID, mark: T(16), caughtUpAt: 1, archive: true, now: 2, max: full.body.length - 1 })!
    expect(small.meta.archive).toBe(false)
    expect(small.body.length).toBeLessThan(full.body.length)
    expect(encode(live, { id: ID, mark: T(16), caughtUpAt: 1, archive: true, now: 2, max: 10 })).toBeNull()
  })

  test('without the archive, archived issues’ pull requests go too', () => {
    const rows = shrink({
      issues: [{ id: 'i-old', archived_at: T(1) }, { id: 'i-new', archived_at: null }],
      issue_pull_requests: [{ issue_id: 'i-old', pull_request_id: '1' }, { issue_id: 'i-new', pull_request_id: '1' }],
    })
    expect(rows.issue_pull_requests?.map((r) => r.issue_id)).toEqual(['i-new'])
  })

  test('a body that isn’t one reads as nothing', () => {
    expect(decode('{')).toBeNull()
    expect(decode(JSON.stringify({ v: CACHE_FORMAT + 1, rows: {} }))).toBeNull()
    expect(decode(JSON.stringify({ v: CACHE_FORMAT, rows: { secrets: [] } }))).toBeNull()
    // rows that aren't rows: applying them would fail
    expect(decode('{"v":1,"rows":{"issues":[null]}}')).toBeNull()
    expect(decode('{"v":1,"rows":{"issues":[[1]]}}')).toBeNull()
    expect(decode('{"v":1,"rows":{"issues":"x"}}')).toBeNull()
    expect(decode(JSON.stringify({ v: CACHE_FORMAT, rows: {} }))).toEqual({ v: CACHE_FORMAT, rows: {} })
  })

  test('the database layout it is for is the newest migration', () => {
    const newest = readdirSync(join(import.meta.dir, '..', 'supabase', 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .at(-1)!
    expect(newest.split('_')[0]).toBe(SCHEMA_ID)
  })
})

describe('when a copy can be used', () => {
  const meta = (more: Partial<CacheMeta> = {}): CacheMeta => ({ ...wanted(ID), mark: T(16), caughtUpAt: Date.now(), savedAt: Date.now(), chars: 2, archive: false, ...more })
  const now = Date.now()

  test('another format, app version, database layout, project, person or workspace: not used', () => {
    const want = wanted(ID)
    const ok = meta()
    expect(check(ok, want, now)).toEqual({ meta: ok })
    expect(check(meta({ v: 999 }), want, now)).toEqual({ bad: 'format' })
    expect(check(meta({ app: '0.0.1' }), want, now)).toEqual({ bad: 'app' })
    expect(check(meta({ schema: '1' }), want, now)).toEqual({ bad: 'schema' })
    expect(check(meta({ project: 'other.example.co' }), want, now)).toEqual({ bad: 'project' })
    expect(check(meta({ profileId: 'p-bob' }), want, now)).toEqual({ bad: 'profile' })
    expect(check(meta({ workspaceId: 'ws-2' }), want, now)).toEqual({ bad: 'workspace' })
    expect(check(null, want, now)).toEqual({ bad: 'format' })
    expect(check(meta({ mark: 'yesterday' }), want, now)).toEqual({ bad: 'no-mark' })
    expect(check({ ...meta(), chars: undefined }, want, now)).toEqual({ bad: 'format' })
  })

  test('last up to date 44 days ago is fine; any longer and it is read again whole', () => {
    const want = wanted(ID)
    expect('meta' in check(meta({ caughtUpAt: now - 44 * DAY + 1_000 }), want, now)).toBe(true)
    expect(check(meta({ caughtUpAt: now - 44 * DAY - 1_000 }), want, now)).toEqual({ bad: 'too-old' })
    expect(check(meta({ caughtUpAt: Number.NaN }), want, now)).toEqual({ bad: 'too-old' })
  })

  test('a gap keeps the mark back', () => {
    expect(cacheMark(T(16), null)).toBe(T(16))
    expect(cacheMark(T(16), T(3))).toBe(T(3))
    expect(cacheMark(null, null)).toBeNull()
  })

  test('two tabs: the one further along stays, to the microsecond', () => {
    const next = meta({ mark: T(16, '000002') })
    expect(keepStored(meta({ mark: T(16, '000003') }), next, now)).toBe(true)
    expect(keepStored(meta({ mark: T(16, '000001') }), next, now)).toBe(false)
    // the same mark: the last one kept wins, unless the one there was up to date more recently
    expect(keepStored(meta({ mark: T(16, '000002') }), next, now)).toBe(false)
    expect(keepStored(meta({ mark: T(16, '000002'), caughtUpAt: next.caughtUpAt + 1 }), next, now)).toBe(true)
    // one that can't be used anyway gives way
    expect(keepStored(meta({ mark: T(50), app: 'old' }), next, now)).toBe(false)
    expect(keepStored(undefined, next, now)).toBe(false)
  })
})

describe('catching up from a copy', () => {
  test('the copy plus what changed since it is the same as reading everything again', () => {
    const registry = new Registry()
    const i5 = issueRow('i-5', 17, { number: 5 })
    const before = load([...world(), fetch('issues', [i5])])
    const copy = load(inputsOf(decode(encode(before.state, { id: ID, mark: before.state.mark!, caughtUpAt: 1, archive: true, now: 2 })!.body)!), emptyLive(), { ...EMPTY }, registry)
    // meanwhile: issue 1 retitled, issue 2 deleted, l-bug taken off issue 1 and put back later, a new issue with a
    // comment, issue 1's follower gone, issue 5 archived, and note n-2 gone (notes leave no deletions behind); and
    // while the changes were read, issue 6 was made and deleted (its DELETE held)
    const archived5 = issueRow('i-5', 25, { number: 5, status: 'done', archived_at: T(25) })
    const after: Incoming[] = world().map((i) => {
      if (i.from !== 'fetch') return i
      if (i.table === 'issues') return fetch('issues', [issueRow('i-1', 20, { title: 'Retitled' }), issueRow('i-3', 12, { number: 3, status: 'done', archived_at: T(12) }), issueRow('i-4', 22, { number: 4 }), archived5])
      if (i.table === 'issue_labels') return fetch('issue_labels', [tagged('i-1', 'l-bug', 24), tagged('i-3', 'l-bug', 12)])
      if (i.table === 'issue_followers') return fetch('issue_followers', [])
      if (i.table === 'comments') return fetch('comments', [comment('c-1', 'i-1', 13), comment('c-2', 'i-3', 14), comment('c-4', 'i-4', 23)])
      if (i.table === 'inbox') return fetch('inbox', [note('n-1', 15)])
      return i
    })
    const deletion = (table: string, key: Record<string, string>, s: number) => ({ id: s, workspace_id: WS, table_name: table, row_key: key, deleted_at: T(s) })
    const changes: Incoming[] = [
      fetch('issues', [issueRow('i-1', 20, { title: 'Retitled' }), issueRow('i-4', 22, { number: 4 }), issueRow('i-1', 5, { title: 'An older copy' }), archived5, issueRow('i-6', 26, { number: 6 })]),
      fetch('issue_labels', [tagged('i-1', 'l-bug', 24)]),
      fetch('comments', [comment('c-4', 'i-4', 23)]),
      {
        from: 'deletions',
        rows: [deletion('issues', { id: 'i-2' }, 21), deletion('issue_labels', { issue_id: 'i-1', label_id: 'l-bug' }, 21), deletion('issue_followers', { issue_id: 'i-1', profile_id: 'p-bob' }, 21)],
      } as Incoming,
      ...inboxGone(Object.keys(copy.state.server.inbox), new Set(['n-1'])),
      { from: 'message', message: { table: 'issues', op: 'DELETE', row: { id: 'i-6' } } },
    ]
    const caught = load(changes, copy.state, { ...EMPTY, ...copy.patch } as StoreSlice, registry)
    const whole = load(after)
    const shown = { ...EMPTY, ...copy.patch, ...caught.patch }
    expect(shown.issues).toEqual(whole.patch.issues!)
    expect(shown.archive).toEqual(whole.patch.archive!)
    expect(shown.comments).toEqual(whole.patch.comments!)
    expect(shown.labels).toEqual(whole.patch.labels!)
    expect(shown.inbox).toEqual(whole.patch.inbox!)
    expect(shown.issues['i-1'].title).toBe('Retitled')
    expect(shown.issues['i-1'].labels).toEqual(['l-bug'])
    expect(shown.issues['i-5']).toBeUndefined()
    expect(shown.archive['i-5'].title).toBe('Issue i-5')
    expect(shown.issues['i-6']).toBeUndefined()
  })

  test('inbox notes not there any more: one DELETE each, and only those go', () => {
    const registry = new Registry()
    const live = load(world(), emptyLive(), { ...EMPTY }, registry)
    const gone = inboxGone(['n-1', 'n-2'], new Set(['n-1', 'n-3']))
    expect(gone).toEqual([{ from: 'message', message: { table: 'inbox', op: 'DELETE', row: { id: 'n-2' } } }])
    const r = load(gone, live.state, { ...EMPTY, ...live.patch } as StoreSlice, registry)
    expect(r.patch.inbox?.map((n) => n.id)).toEqual(['n-1'])
    expect(Object.keys(r.state.server.inbox)).toEqual(['n-1'])
  })
})

describe('keeping the copy a moment after changes', () => {
  test('once nothing changed for 3 s, and never later than 30 s after the first change', async () => {
    const t = fakeTimers()
    let saves = 0
    const s = new Saver({ quiet: 3_000, most: 30_000, save: async () => void saves++ }, t)
    s.poke()
    await t.tick(2_000)
    s.poke()
    await t.tick(2_999)
    expect(saves).toBe(0)
    await t.tick(1)
    expect(saves).toBe(1)
    // changes every 2 s: kept after 30 s all the same
    for (let k = 0; k < 15; k++) {
      s.poke()
      await t.tick(2_000)
    }
    expect(saves).toBe(2)
  })

  test('saveNow() keeps it at once; a change while keeping keeps it once more after', async () => {
    const t = fakeTimers()
    let saves = 0
    let release!: () => void
    const s = new Saver({ quiet: 3_000, most: 30_000, save: () => new Promise<void>((r) => (release = () => (saves++, r()))) }, t)
    s.poke()
    const kept = s.saveNow()
    // the timer went with saveNow(): nothing more is kept on its own
    await t.tick(5_000)
    void s.saveNow()
    release()
    await sleep(0)
    release()
    await kept
    expect(saves).toBe(2)
    s.cancel()
    s.poke()
    await t.tick(10_000)
    expect(saves).toBe(2)
  })

  test('what was kept last: the same copy, one only up to date again, or a new one', () => {
    const live = load(world()).state
    const shot = (more: Partial<Shot> = {}): Shot => ({ server: live.server, partial: live.partial, mark: T(16), caughtUpAt: 1, archive: false, ...more })
    expect(compareCopy(null, shot())).toBe('new')
    expect(compareCopy(shot(), shot())).toBe('same')
    expect(compareCopy(shot(), shot({ caughtUpAt: 2 }))).toBe('touch')
    expect(compareCopy(shot(), shot({ mark: T(17) }))).toBe('new')
    expect(compareCopy(shot(), shot({ archive: true }))).toBe('new')
    expect(compareCopy(shot(), shot({ server: { ...live.server } }))).toBe('new')
    expect(rowCount(live.server)).toBe(21)
  })
})

/** a pretend IndexedDB */
class FakeKV implements CacheKV {
  map = new Map<string, unknown>()
  fail: ((op: string) => Error | null) | null = null
  private check(op: string) {
    const e = this.fail?.(op)
    if (e) throw e
  }
  async getMany(keys: string[]) {
    this.check('get')
    return keys.map((k) => this.map.get(k))
  }
  /** runs inside a write, before it decides (a sign-out elsewhere, say) */
  meanwhile: (() => void) | null = null
  async putIf(meta: [string, CacheMeta], body: [string, string], keep: (old: unknown) => boolean) {
    this.check('put')
    this.meanwhile?.()
    if (keep(this.map.get(meta[0]))) return 'kept' as const
    this.map.set(meta[0], meta[1])
    this.map.set(body[0], body[1])
    return 'written' as const
  }
  putNow(meta: [string, CacheMeta], body: [string, string]) {
    this.map.set(meta[0], meta[1])
    this.map.set(body[0], body[1])
    return true
  }
  async update(key: string, next: (old: unknown) => unknown) {
    const v = next(this.map.get(key))
    if (v !== null) this.map.set(key, v)
  }
  async delMany(keys: string[]) {
    for (const k of keys) this.map.delete(k)
  }
  async metas(): Promise<[string, unknown][]> {
    return [...this.map].filter(([k]) => k.startsWith('m:'))
  }
  close() {}
}

describe('where copies are kept', () => {
  let kv: FakeKV
  beforeEach(() => {
    kv = new FakeKV()
    setCacheKV(kv)
  })
  afterEach(() => setCacheKV(undefined))

  const live = () => load(world()).state
  const entry = (id: CacheId = ID, savedAt = Date.now(), mark = T(16)) => encode(live(), { id, mark, caughtUpAt: Date.now(), archive: false, now: savedAt })!

  test('kept and read back; one of another version is removed, and opening reads everything', async () => {
    expect(await writeCache(entry())).toBe('written')
    const r = await readCache(ID, Date.now())
    expect('meta' in r && r.meta.mark).toBe(T(16))
    expect('body' in r && r.body.rows.issues?.length).toBe(3)
    kv.map.set(`m:${ID.project}:${ME}:${WS}`, { ...(kv.map.get(`m:${ID.project}:${ME}:${WS}`) as object), v: 999 })
    expect(await readCache(ID, Date.now())).toEqual({ miss: 'format' })
    expect(kv.map.size).toBe(0)
    expect(await readCache(ID, Date.now())).toEqual({ miss: 'none' })
  })

  test('a body that doesn’t match its facts is removed', async () => {
    await writeCache(entry())
    kv.map.set(`b:${ID.project}:${ME}:${WS}`, '{"v":1,"rows":{}}')
    expect(await readCache(ID, Date.now())).toEqual({ miss: 'broken' })
    expect(kv.map.size).toBe(0)
  })

  test('the one further along stays', async () => {
    await writeCache(entry(ID, Date.now(), T(20)))
    expect(await writeCache(entry(ID, Date.now(), T(16)))).toBe('kept')
    const r = await readCache(ID, Date.now())
    expect('meta' in r && r.meta.mark).toBe(T(20))
  })

  test('a fourth workspace pushes out the oldest; other people’s copies go', async () => {
    kv.map.set('m:db.example.co:p-bob:ws-1', { profileId: 'p-bob', project: 'db.example.co' })
    kv.map.set('b:db.example.co:p-bob:ws-1', '{}')
    for (const [n, w] of ['ws-1', 'ws-2', 'ws-3', 'ws-4'].entries()) await writeCache(entry({ ...ID, workspaceId: w }, 1_000 + n))
    expect([...kv.map.keys()].filter((k) => k.startsWith('m:')).sort()).toEqual(['m:db.example.co:p-ana:ws-2', 'm:db.example.co:p-ana:ws-3', 'm:db.example.co:p-ana:ws-4'])
    expect(kv.map.has('b:db.example.co:p-ana:ws-1')).toBe(false)
  })

  test('a workspace you left, or one that went, loses its copy', async () => {
    for (const w of ['ws-1', 'ws-2']) await writeCache(entry({ ...ID, workspaceId: w }))
    await pruneCaches(ME, ['ws-2'], ID.project)
    expect([...kv.map.keys()].sort()).toEqual(['b:db.example.co:p-ana:ws-2', 'm:db.example.co:p-ana:ws-2'])
    await dropCache({ ...ID, workspaceId: 'ws-2' })
    expect(kv.map.size).toBe(0)
  })

  test('the browser is full: everything goes, then it is tried once more without the archive; full again, no more copies', async () => {
    await writeCache(entry({ ...ID, workspaceId: 'ws-2' }))
    let puts = 0
    kv.fail = (op) => (op === 'put' && ++puts === 1 ? new DOMException('full', 'QuotaExceededError') : null)
    const small = encode(live(), { id: ID, mark: T(16), caughtUpAt: Date.now(), archive: true, now: 1, small: true })!
    expect(await writeCache(entry(), () => small)).toBe('written')
    expect([...kv.map.keys()].sort()).toEqual(['b:db.example.co:p-ana:ws-1', 'm:db.example.co:p-ana:ws-1'])
    expect(small.meta.archive).toBe(false)
    kv.fail = (op) => (op === 'put' ? new DOMException('full', 'QuotaExceededError') : null)
    expect(await writeCache(entry(), () => small)).toBe('off')
    expect(cacheState()).toEqual({ off: true, reason: 'quota' })
    expect(await writeCache(entry())).toBe('off')
  })

  test('the browser won’t keep anything: everything is read each time, and it says so once', async () => {
    kv.fail = () => new DOMException('no', 'SecurityError')
    expect(await readCache(ID, Date.now())).toEqual({ miss: 'blocked' })
    expect(await writeCache(entry())).toBe('off')
    expect(await readCache(ID, Date.now())).toEqual({ miss: 'blocked' })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('nothing is read or kept after signing out starts', async () => {
    await writeCache(entry())
    stopCaching()
    expect(await readCache(ID, Date.now())).toEqual({ miss: 'stopped' })
    expect(await writeCache(entry())).toBe('off')
    expect(writeCacheNow(entry())).toBe(false)
  })

  test('a sign-out while a copy is on its way: it isn’t written back', async () => {
    kv.meanwhile = () => stopCaching()
    expect(await writeCache(entry())).toBe('off')
    expect(kv.map.size).toBe(0)
  })

  test('the page going: put at once', async () => {
    expect(writeCacheNow(entry(ID, Date.now(), T(20)))).toBe(true)
    const r = await readCache(ID, Date.now())
    expect('meta' in r && r.meta.mark).toBe(T(20))
  })

  test('up to date again: only the facts change, and only on the same copy', async () => {
    const e = entry()
    await writeCache(e)
    const later = e.meta.caughtUpAt + 5_000
    expect(await touchCache(ID, T(16), later)).toBe(true)
    const r = await readCache(ID, Date.now())
    expect('meta' in r && r.meta.caughtUpAt).toBe(later)
    expect('body' in r && r.body.rows.issues?.length).toBe(3)
    // another mark: another copy, left alone
    expect(await touchCache(ID, T(15), later + 1)).toBe(false)
  })
})

describe('IndexedDB itself', () => {
  ;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange ??= FakeIDBKeyRange
  const meta = (mark = T(16)): CacheMeta => ({ ...wanted(ID), mark, caughtUpAt: Date.now(), savedAt: Date.now(), chars: 2, archive: false })

  test('a write keeps what is there or puts both, in one go', async () => {
    const kv = idbKV({ factory: new FakeIDBFactory() })
    expect(await kv.putIf(['m:x', meta()], ['b:x', '{}'], () => false)).toBe('written')
    expect(await kv.putIf(['m:x', meta(T(20))], ['b:x', '{"new":1}'], (old) => (old as CacheMeta).mark === T(16))).toBe('kept')
    expect(await kv.getMany(['m:x', 'b:x'])).toEqual([meta(), '{}'].map((v, n) => (n === 0 ? { ...(v as CacheMeta), caughtUpAt: expect.any(Number), savedAt: expect.any(Number) } : v)))
    expect((await kv.metas()).map(([k]) => k)).toEqual(['m:x'])
    expect(kv.putNow!(['m:y', meta()], ['b:y', '{}'])).toBe(true)
    await sleep(5)
    expect((await kv.getMany(['b:y']))[0]).toBe('{}')
    kv.close()
  })

  test('deleted from elsewhere (a sign-out): this tab lets go at once, and hears about it', async () => {
    const factory = new FakeIDBFactory()
    let told = 0
    const kv = idbKV({ factory, deleted: () => told++ })
    await kv.putIf(['m:x', meta()], ['b:x', '{}'], () => false)
    const blocked = await new Promise<string>((resolve) => {
      const req = factory.deleteDatabase(CACHE_DB)
      req.onsuccess = () => resolve('deleted')
      req.onblocked = () => resolve('blocked')
    })
    expect(blocked).toBe('deleted')
    expect(told).toBe(1)
  })

  test('signing out here deletes it even while this tab has it open', async () => {
    const factory = new FakeIDBFactory()
    const kv = idbKV({ factory })
    await kv.putIf(['m:x', meta()], ['b:x', '{}'], () => false)
    setCacheKV(kv)
    await wipeCaches(factory)
    const names = (await factory.databases()).map((d) => d.name)
    expect(names).not.toContain(CACHE_DB)
    setCacheKV(undefined)
  })

  test('a database that never opens: given up on in time', async () => {
    const hanging = { open: () => ({}) } as unknown as IDBFactory
    const kv = idbKV({ factory: hanging, wait: 20 })
    const start = Date.now()
    expect(await kv.getMany(['m:x']).then(() => 'opened', (e: Error) => e.constructor.name)).toBe('SlowOpen')
    expect(Date.now() - start).toBeLessThan(500)
  })

  test('the browser full: the write fails with the quota error, as writeCache expects', async () => {
    const kv = idbKV({ factory: new FakeIDBFactory() })
    await kv.metas()
    const put = FakeIDBObjectStore.prototype.put
    FakeIDBObjectStore.prototype.put = function () {
      throw new DOMException('full', 'QuotaExceededError')
    }
    try {
      const r = await kv.putIf(['m:x', meta()], ['b:x', '{}'], () => false).then(() => 'written', (e: DOMException) => e.name)
      expect(r).toBe('QuotaExceededError')
    } finally {
      FakeIDBObjectStore.prototype.put = put
    }
  })

  test('a browser whose database hangs once: later loads in the tab don’t wait for it', async () => {
    const g = globalThis as { indexedDB?: unknown; sessionStorage?: unknown }
    const saved = { indexedDB: g.indexedDB, sessionStorage: g.sessionStorage }
    const store = new Map<string, string>()
    g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    g.indexedDB = { open: () => ({}) }
    try {
      setCacheKV(undefined)
      expect(await readCache(ID, Date.now())).toEqual({ miss: 'slow' })
      expect(cacheState()).toEqual({ off: true, reason: 'slow' })
      // the next load in this tab
      setCacheKV(undefined)
      const start = Date.now()
      expect(await readCache(ID, Date.now())).toEqual({ miss: 'slow' })
      expect(Date.now() - start).toBeLessThan(100)
    } finally {
      g.indexedDB = saved.indexedDB
      g.sessionStorage = saved.sessionStorage
      setCacheKV(undefined)
    }
  }, 5_000)
})
