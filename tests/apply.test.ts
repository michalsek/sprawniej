import { describe, expect, test } from 'bun:test'
import { applyRows, emptyLive, pendingDelete, pendingFields, type ApplyContext, type Incoming, type LiveState, type StoreSlice } from '@/backend/apply'
import type { AnyChange, Writable } from '@/backend/changes'
import { Registry } from '@/backend/registry'
import { KEYS, type DeletionRow, type Row } from '@/backend/tables'
import { EMPTY } from '@/data/store'

const WS = 'ws-1'
const ME = 'p-ana'
const I1 = '01JISSUE000000000001'
const I2 = '01JISSUE000000000002'
/** a database time, `s` seconds after noon */
const T = (s: number, us = '123456') =>
  `2026-10-19T12:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${us}+00:00`
/** the same time as the app keeps it */
const Z = (s: number) => iso(T(s))
const iso = (t: string) => t.replace(/(\.\d{3})\d*\+00:00$/, '$1Z')

const profile = (id: string, login: string, more: Partial<Row<'profiles'>> = {}): Row<'profiles'> => ({
  id,
  user_id: `u-${login}`,
  login,
  github_id: 100,
  name: login,
  avatar_url: '',
  name_set_here: false,
  guest_of: null,
  linear_ids: [],
  created_at: T(0),
  changed_at: T(0),
  extra: {},
  ...more,
})

const issueRow = (id: string, more: Partial<Row<'issues'>> = {}): Row<'issues'> => ({
  id,
  workspace_id: WS,
  team_id: 't-eng',
  number: 1,
  title: 'Fix the chart',
  description: 'Fix the thing',
  status: 'todo',
  priority: 0,
  assignee_id: ME,
  project_id: 'pr-1',
  parent_id: null,
  due_date: null,
  estimate: null,
  sort_order: 'a0',
  duplicate_of: null,
  former_refs: [],
  created_by: ME,
  created_at: T(1),
  updated_at: T(1),
  completed_at: null,
  archived_at: null,
  archived_by: null,
  linear_id: null,
  changed_at: T(10),
  extra: {},
  ...more,
})

const commentRow = (id: string, issue: string, author: string, s: number): Row<'comments'> => ({
  id,
  workspace_id: WS,
  issue_id: issue,
  author_id: author,
  body: `Comment ${id}`,
  created_at: T(s),
  edited_at: null,
  linear_id: null,
  changed_at: T(s),
  extra: {},
})

const teamRow = (id: string, key: string): Row<'teams'> => ({
  id,
  workspace_id: WS,
  key,
  name: key,
  emoji: '',
  last_number: 2,
  auto_archive: 6,
  linear_id: null,
  created_at: T(0),
  changed_at: T(0),
  extra: {},
})

/** a workspace with ana (me), bob (left) and the guest ~jan, team ENG, two issues with comments, a view and an inbox */
function world(): Incoming[] {
  const fetch = (table: Extract<Incoming, { from: 'fetch' }>['table'], rows: object[]): Incoming => ({ from: 'fetch', table, rows: rows as Record<string, unknown>[] })
  return [
    fetch('workspaces', [{ id: WS, name: 'Acme', created_by: ME, created_at: T(0), changed_at: T(0), extra: {} }]),
    fetch('profiles', [
      profile(ME, 'ana', { github_id: 1 }),
      profile('p-bob', 'bob'),
      profile('p-jan', '~jan', { user_id: null, github_id: null, guest_of: WS, linear_ids: ['L-jan'] }),
    ]),
    fetch('workspace_members', [
      { workspace_id: WS, profile_id: ME, role: 'owner', joined_at: T(0), removed_at: null, changed_at: T(0) },
      { workspace_id: WS, profile_id: 'p-bob', role: 'member', joined_at: T(0), removed_at: T(5), changed_at: T(5) },
    ]),
    fetch('teams', [teamRow('t-eng', 'ENG')]),
    fetch('team_members', [
      { workspace_id: WS, team_id: 't-eng', profile_id: ME, changed_at: T(1) },
      { workspace_id: WS, team_id: 't-eng', profile_id: 'p-bob', changed_at: T(2) },
    ]),
    fetch('labels', [
      { id: 'l-bug', workspace_id: WS, name: 'Bug', color: '#f00', linear_id: null, changed_at: T(1), extra: {} },
      { id: 'l-ui', workspace_id: WS, name: 'UI', color: '#00f', linear_id: null, changed_at: T(1), extra: { shade: 'dark' } },
    ]),
    fetch('projects', [{ id: 'pr-1', workspace_id: WS, name: 'Charts', emoji: '📊', description: '', status: 'planned', lead_id: ME, target_date: null, linear_id: null, created_at: T(0), changed_at: T(0), extra: {} }]),
    fetch('project_teams', [{ workspace_id: WS, project_id: 'pr-1', team_id: 't-eng', changed_at: T(1) }]),
    fetch('issues', [issueRow(I1), issueRow(I2, { number: 2, assignee_id: 'p-jan', created_by: 'p-bob', extra: { foo: 'bar' } })]),
    fetch('issue_labels', [{ workspace_id: WS, issue_id: I1, label_id: 'l-bug', changed_at: T(10) }]),
    fetch('issue_followers', []),
    fetch('comments', [commentRow('c-2', I1, ME, 4), commentRow('c-1', I1, 'p-bob', 3)]),
    fetch('views', [
      {
        id: 'v-1',
        workspace_id: WS,
        team_id: null,
        owner_id: ME,
        name: 'Bugs',
        emoji: '🐞',
        description: '',
        filters: { labels: ['l-bug'] },
        display: { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true },
        created_at: T(0),
        linear_id: null,
        changed_at: T(0),
        extra: {},
      },
    ]),
    fetch('inbox', [
      { id: 'n-1', workspace_id: WS, recipient_id: ME, actor_id: 'p-bob', type: 'assigned', issue_id: I1, comment_id: null, status: null, at: T(6), read_at: null, changed_at: T(6), extra: {} },
      { id: 'n-2', workspace_id: WS, recipient_id: ME, actor_id: 'p-bob', type: 'commented', issue_id: I1, comment_id: 'c-1', status: null, at: T(7), read_at: T(8), changed_at: T(8), extra: {} },
    ]),
    fetch('read_state', [{ profile_id: ME, workspace_id: WS, read_until: T(5), changed_at: T(20, '999999'), extra: {} }]),
  ]
}

interface Open {
  ctx: ApplyContext
  state: LiveState
  data: StoreSlice
}

function open(): Open & { first: ReturnType<typeof applyRows> } {
  const ctx = { workspaceId: WS, meId: ME, registry: new Registry() }
  const first = applyRows(emptyLive(), EMPTY, world(), ctx)
  return { ctx, state: first.state, data: { ...EMPTY, ...first.patch }, first }
}

/** applies more inputs on top, like the store would; every row it asks for has a whole key */
function step(w: Open, ...inputs: Incoming[]) {
  const r = applyRows(w.state, w.data, inputs, w.ctx)
  for (const f of r.fetch) for (const k of KEYS[f.table]) expect(f.key[k as keyof typeof f.key]).toBeString()
  w.state = r.state
  w.data = { ...w.data, ...r.patch }
  return r
}

const msg = (table: string, op: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>): Incoming => ({ from: 'message', message: { table, op, row } })
const deletion = (table_name: string, row_key: Record<string, string>, s: number): DeletionRow => ({ id: s, workspace_id: WS, table_name, row_key, deleted_at: T(s) })
const titleChange = (fields: Writable<'issues', 'update'>): AnyChange => ({ table: 'issues', op: 'update', key: { id: I1 }, fields })

describe('first load', () => {
  test('fetched rows build the whole store, with times in the app form', () => {
    const { data, first } = open()
    expect(data.workspace).toEqual({ id: WS, name: 'Acme', createdAt: Z(0) })
    expect(Object.keys(data.people).sort()).toEqual(['ana', 'bob', '~jan'])
    expect(data.me).toBe(data.people.ana)
    expect(data.teams.ENG.members).toEqual(['ana', 'bob'])
    expect(data.projects['pr-1']).toMatchObject({ lead: 'ana', teams: ['ENG'] })
    expect(data.issues[I1]).toMatchObject({ team: 'ENG', number: 1, assignee: 'ana', labels: ['l-bug'], createdAt: Z(1) })
    expect(data.issues[I1].createdAt).toMatch(/^2026-10-19T12:00:01\.123Z$/)
    // oldest first
    expect(data.comments[I1].map((c) => c.id)).toEqual(['c-1', 'c-2'])
    expect(data.comments[I1][0].author).toBe('bob')
    expect(data.views['v-1']).toMatchObject({ owner: 'ana', team: null })
    expect(data.readState).toEqual({ readUntil: Z(5) })
    expect(first.state.mark).toBe(T(20, '999999'))
    expect(first.fetch).toEqual([])
  })

  test('someone who left still has a name on their work', () => {
    const { data } = open()
    expect(data.issues[I2].createdBy).toBe('bob')
    expect(data.people.bob).toBeDefined()
    expect(data.members.bob).toEqual({ role: 'member', removedAt: Z(5) })
    expect(data.members.ana).toEqual({ role: 'owner', removedAt: null })
  })

  test('the same rows again change nothing, even with other values at the same time', () => {
    const w = open()
    expect(step(w, ...world()).patch).toEqual({})
    expect(step(w, { from: 'fetch', table: 'issues', rows: [issueRow(I1, { title: 'Other' })] }).patch).toEqual({})
  })
})

describe('newer wins', () => {
  test('an older change is ignored, a later one applies even if only by a microsecond', () => {
    const w = open()
    expect(step(w, msg('issues', 'UPDATE', { id: I1, title: 'Old', changed_at: T(9) })).patch).toEqual({})
    step(w, msg('issues', 'UPDATE', { id: I1, title: 'New', changed_at: T(10, '123457') }))
    expect(w.data.issues[I1].title).toBe('New')
    expect(step(w, msg('issues', 'UPDATE', { id: I1, title: 'Same time', changed_at: T(10, '123457') })).patch).toEqual({})
    expect(w.data.issues[I1].title).toBe('New')
  })

  test('an update changes only the columns it carries', () => {
    const w = open()
    step(w, msg('issues', 'UPDATE', { id: I1, title: 'A', changed_at: T(11) }))
    step(w, msg('issues', 'UPDATE', { id: I1, priority: 3, changed_at: T(12) }))
    expect(w.data.issues[I1]).toMatchObject({ title: 'A', priority: 3, description: 'Fix the thing', labels: ['l-bug'] })
    expect(w.state.mark).toBe(T(20, '999999'))
    expect(step(w, msg('issues', 'UPDATE', { id: I1, title: 'B', changed_at: T(30) })).state.mark).toBe(T(30))
  })
})

describe('join rows', () => {
  test('a label added changes that one issue, nothing else', () => {
    const w = open()
    const before = w.data
    const r = step(w, msg('issue_labels', 'INSERT', { workspace_id: WS, issue_id: I1, label_id: 'l-ui', changed_at: T(11) }))
    expect(Object.keys(r.patch)).toEqual(['issues'])
    expect(w.data.issues[I1].labels).toEqual(['l-bug', 'l-ui'])
    expect(w.data.issues[I1]).not.toBe(before.issues[I1])
    expect(w.data.issues[I2]).toBe(before.issues[I2])
    expect(w.data.labels).toBe(before.labels)
    expect(w.data.teams).toBe(before.teams)
    expect(w.data.people).toBe(before.people)
  })

  test('team members, project teams and followers fold into their parent', () => {
    const w = open()
    step(w, msg('team_members', 'INSERT', { workspace_id: WS, team_id: 't-eng', profile_id: 'p-jan', changed_at: T(11) }))
    expect(w.data.teams.ENG.members).toEqual(['ana', 'bob', '~jan'])
    step(w, msg('teams', 'INSERT', teamRow('t-web', 'WEB')), msg('project_teams', 'INSERT', { workspace_id: WS, project_id: 'pr-1', team_id: 't-web', changed_at: T(12) }))
    expect(w.data.projects['pr-1'].teams).toEqual(['ENG', 'WEB'])
    step(
      w,
      msg('issue_followers', 'INSERT', { workspace_id: WS, issue_id: I1, profile_id: 'p-bob', following: true, changed_at: T(13) }),
      msg('issue_followers', 'INSERT', { workspace_id: WS, issue_id: I1, profile_id: 'p-jan', following: false, changed_at: T(13) }),
    )
    expect(w.data.issues[I1]).toMatchObject({ subscribers: ['bob'], unsubscribed: ['~jan'] })
    step(w, msg('issue_followers', 'UPDATE', { issue_id: I1, profile_id: 'p-bob', following: false, changed_at: T(14) }))
    expect(w.data.issues[I1].subscribers).toBeUndefined()
    expect(w.data.issues[I1].unsubscribed).toEqual(['bob', '~jan'])
  })

  test('a join row before its issue waits quietly, then shows with it', () => {
    const w = open()
    const r = step(w, msg('issue_labels', 'INSERT', { workspace_id: WS, issue_id: 'I3-000000000000', label_id: 'l-bug', changed_at: T(11) }))
    expect(r.patch).toEqual({})
    expect(r.fetch).toEqual([])
    step(w, msg('issues', 'INSERT', issueRow('I3-000000000000', { number: 3, changed_at: T(12) })))
    expect(w.data.issues['I3-000000000000'].labels).toEqual(['l-bug'])
  })
})

describe('deleting', () => {
  test('deletions found on catch-up remove issues, join rows and guests', () => {
    const w = open()
    step(w, { from: 'deletions', rows: [deletion('issues', { id: I2 }, 30), deletion('issue_labels', { issue_id: I1, label_id: 'l-bug' }, 30), deletion('profiles', { id: 'p-jan' }, 30)] })
    expect(w.data.issues[I2]).toBeUndefined()
    expect(w.data.issues[I1].labels).toEqual([])
    expect(w.data.people['~jan']).toBeUndefined()
    expect(w.state.mark).toBe(T(30))
  })

  test('a row made again after its deletion stays', () => {
    const w = open()
    expect(step(w, { from: 'deletions', rows: [deletion('issues', { id: I1 }, 5)] }).patch).toEqual({})
    expect(w.data.issues[I1]).toBeDefined()
  })

  test('a deleted issue takes its comments along', () => {
    const w = open()
    step(w, msg('issues', 'DELETE', { id: I1 }))
    expect(w.data.issues[I1]).toBeUndefined()
    expect(w.data.comments[I1]).toBeUndefined()
    // it doesn't come back from an older fetch
    expect(step(w, { from: 'fetch', table: 'issues', rows: [issueRow(I1)] }).patch).toEqual({})
  })

  test('a delete by a two-column key', () => {
    const w = open()
    step(w, msg('issue_labels', 'DELETE', { issue_id: I1, label_id: 'l-bug' }))
    expect(w.data.issues[I1].labels).toEqual([])
  })

  test('deleting something we never had changes nothing', () => {
    const w = open()
    const r = step(w, msg('issues', 'DELETE', { id: 'nope-0000000000' }))
    expect(r.patch).toEqual({})
    expect(r.fetch).toEqual([])
  })

  test('a guest linked to an account: their name stays on work not moved yet', () => {
    const w = open()
    step(w, msg('profiles', 'DELETE', { id: 'p-jan' }))
    expect(w.data.people['~jan']).toBeUndefined()
    expect(w.data.issues[I2].assignee).toBe('~jan')
    step(w, msg('issues', 'UPDATE', { id: I2, assignee_id: ME, changed_at: T(31) }))
    expect(w.data.issues[I2].assignee).toBe('ana')
  })
})

describe('what to fetch', () => {
  test('a change to a row we never had asks for the whole row', () => {
    const w = open()
    const r = step(w, msg('issues', 'UPDATE', { id: 'I9-000000000000', title: 'x', changed_at: T(40) }))
    expect(r.patch).toEqual({})
    expect(r.fetch).toEqual([{ table: 'issues', key: { id: 'I9-000000000000' } }])
  })

  test('a note read in another workspace is not fetched', () => {
    const w = open()
    expect(step(w, msg('inbox', 'UPDATE', { id: 'n-9', read_at: T(40), changed_at: T(40) })).fetch).toEqual([])
  })

  test('a row too big to send keeps its old description until the whole row comes', () => {
    const w = open()
    const r = step(w, msg('issues', 'UPDATE', { id: I1, title: 'Big', partial: true, changed_at: T(41) }))
    expect(r.fetch).toEqual([{ table: 'issues', key: { id: I1 } }])
    expect(w.data.issues[I1]).toMatchObject({ title: 'Big', description: 'Fix the thing' })
    step(w, { from: 'fetch', table: 'issues', rows: [issueRow(I1, { title: 'Big', description: 'Huge', changed_at: T(41) })] })
    expect(w.data.issues[I1].description).toBe('Huge')
  })

  test('an issue in a team we don\'t know yet shows once the team arrives', () => {
    const w = open()
    const r = step(w, msg('issues', 'INSERT', issueRow('I4-000000000000', { team_id: 't-new', changed_at: T(42) })))
    expect(w.data.issues['I4-000000000000']).toBeUndefined()
    expect(r.fetch).toEqual([{ table: 'teams', key: { id: 't-new' } }])
    step(w, { from: 'fetch', table: 'teams', rows: [teamRow('t-new', 'NEW')] })
    expect(w.data.issues['I4-000000000000'].team).toBe('NEW')
  })
})

describe('unchanged things keep their objects', () => {
  test('renaming a label changes only labels', () => {
    const w = open()
    const before = w.data
    const r = step(w, msg('labels', 'UPDATE', { id: 'l-bug', name: 'Bugs', changed_at: T(50) }))
    expect(Object.keys(r.patch)).toEqual(['labels'])
    expect(w.data.labels['l-bug'].name).toBe('Bugs')
    expect(w.data.issues).toBe(before.issues)
  })

  test('a change to my profile updates me', () => {
    const w = open()
    const r = step(w, msg('profiles', 'UPDATE', { id: ME, name: 'Ana K', changed_at: T(50) }))
    expect(r.patch.me).toBe(r.patch.people!.ana)
    expect(w.data.me?.name).toBe('Ana K')
  })
})

describe('your own changes', () => {
  test('your title shows while saving, a teammate\'s other columns too', () => {
    const w = open()
    step(w, { from: 'local', change: titleChange({ title: 'Mine' }) })
    expect(w.data.issues[I1].title).toBe('Mine')
    expect(pendingFields(w.state, 'issues', { id: I1 })).toEqual(['title'])
    step(w, msg('issues', 'UPDATE', { id: I1, title: 'Theirs', priority: 2, changed_at: T(50) }))
    expect(w.data.issues[I1]).toMatchObject({ title: 'Mine', priority: 2 })
    // the write came back after theirs: the database has theirs
    step(w, { from: 'settled', change: titleChange({ title: 'Mine' }), ok: true })
    expect(w.data.issues[I1].title).toBe('Theirs')
    expect(pendingFields(w.state, 'issues', { id: I1 })).toEqual([])
  })

  test('a newer edit stays while an older one is confirmed', () => {
    const w = open()
    step(w, { from: 'local', change: titleChange({ title: 'A' }) }, { from: 'local', change: titleChange({ title: 'B' }) })
    step(w, { from: 'settled', change: titleChange({ title: 'A' }), ok: true, row: issueRow(I1, { title: 'A', changed_at: T(51) }) })
    expect(w.data.issues[I1].title).toBe('B')
  })

  test('a failed write is undone', () => {
    const w = open()
    step(w, { from: 'local', change: titleChange({ title: 'X' }) })
    step(w, { from: 'settled', change: titleChange({ title: 'X' }), ok: false })
    expect(w.data.issues[I1].title).toBe('Fix the chart')
  })

  test('adding and removing a label shows at once', () => {
    const w = open()
    const add: AnyChange = { table: 'issue_labels', op: 'insert', key: { issue_id: I1, label_id: 'l-ui' }, fields: { workspace_id: WS, issue_id: I1, label_id: 'l-ui' } }
    step(w, { from: 'local', change: add })
    expect(w.data.issues[I1].labels).toEqual(['l-bug', 'l-ui'])
    step(w, { from: 'local', change: { table: 'issue_labels', op: 'delete', key: { issue_id: I1, label_id: 'l-bug' }, fields: {} } })
    expect(w.data.issues[I1].labels).toEqual(['l-ui'])
  })

  test('the echo of your own saved change changes nothing', () => {
    const w = open()
    step(w, { from: 'local', change: titleChange({ title: 'Mine' }) })
    step(w, { from: 'settled', change: titleChange({ title: 'Mine' }), ok: true, row: issueRow(I1, { title: 'Mine', changed_at: T(60) }) })
    expect(step(w, msg('issues', 'UPDATE', { id: I1, title: 'Mine', changed_at: T(60) })).patch).toEqual({})
    expect(w.data.issues[I1].title).toBe('Mine')
  })
})

describe('the archive', () => {
  test('archiving moves an issue and its comments into the archive, and back', () => {
    const w = open()
    step(w, msg('issues', 'UPDATE', { id: I1, archived_at: T(70), archived_by: ME, changed_at: T(70) }))
    expect(w.data.issues[I1]).toBeUndefined()
    expect(w.data.comments[I1]).toBeUndefined()
    expect(w.data.archive[I1]).toMatchObject({ archivedAt: Z(70), archivedBy: 'ana', title: 'Fix the chart' })
    expect(w.data.archive[I1].comments.map((c) => c.id)).toEqual(['c-1', 'c-2'])
    step(w, msg('comments', 'INSERT', commentRow('c-3', I1, ME, 71)))
    expect(w.data.archive[I1].comments.map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3'])
    step(w, msg('issues', 'UPDATE', { id: I1, archived_at: null, archived_by: null, changed_at: T(72) }))
    expect(w.data.archive[I1]).toBeUndefined()
    expect(w.data.issues[I1].title).toBe('Fix the chart')
    expect(w.data.comments[I1].map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3'])
  })

  test('an archived row that is fetched goes to the archive', () => {
    const w = open()
    step(w, { from: 'fetch', table: 'issues', rows: [issueRow('I5-000000000000', { archived_at: T(73), archived_by: null })] })
    expect(w.data.issues['I5-000000000000']).toBeUndefined()
    expect(w.data.archive['I5-000000000000']).toMatchObject({ archivedAt: Z(73), archivedBy: '', comments: [] })
  })
})

describe('the inbox and the workspace', () => {
  test('newest first, read one by one, only this workspace', () => {
    const w = open()
    expect(w.data.inbox.map((n) => n.id)).toEqual(['n-2', 'n-1'])
    expect(w.data.inbox[0].readAt).toBe(Z(8))
    expect('readAt' in w.data.inbox[1]).toBe(false)
    const other = { id: 'n-3', workspace_id: 'ws-2', recipient_id: ME, actor_id: null, type: 'assigned', issue_id: 'x', comment_id: null, status: null, at: T(80), read_at: null, changed_at: T(80), extra: {} }
    expect(step(w, msg('inbox', 'INSERT', other)).patch).toEqual({})
    step(w, msg('inbox', 'UPDATE', { id: 'n-1', read_at: T(81), changed_at: T(81) }))
    expect(w.data.inbox[1]).toMatchObject({ id: 'n-1', readAt: Z(81) })
  })

  test('a catch-up message asks for one', () => {
    const w = open()
    const r = step(w, { from: 'message', message: { op: 'catch_up' } })
    expect(r.catchUp).toBe(true)
    expect(r.patch).toEqual({})
  })

  test('a deleted workspace says so', () => {
    const w = open()
    const r = step(w, msg('workspaces', 'DELETE', { id: WS }))
    expect(r.workspaceGone).toBe(true)
    expect(r.patch.workspace).toBeNull()
  })
})

describe('rows too big to send', () => {
  test('a later small update keeps waiting for the whole row, and the whole row brings the text', () => {
    const w = open()
    step(w, msg('issues', 'UPDATE', { id: I1, title: 'Big', partial: true, changed_at: T(41) }))
    step(w, msg('issues', 'UPDATE', { id: I1, priority: 2, changed_at: T(42) }))
    expect(w.data.issues[I1].description).toBe('Fix the thing')
    step(w, { from: 'fetch', table: 'issues', rows: [issueRow(I1, { title: 'Big', priority: 2, description: 'Huge', changed_at: T(42) })] })
    expect(w.data.issues[I1]).toMatchObject({ description: 'Huge', priority: 2 })
  })

  test('a partial insert keeps the text we have; a new one gets it once fetched', () => {
    const w = open()
    const { description: _, ...rest } = issueRow(I1, { title: 'Again', changed_at: T(41) })
    const r = step(w, msg('issues', 'INSERT', { ...rest, partial: true }))
    expect(w.data.issues[I1]).toMatchObject({ title: 'Again', description: 'Fix the thing' })
    expect(r.fetch).toEqual([{ table: 'issues', key: { id: I1 } }])
    const id = 'I7-000000000000'
    const { description: __, ...fresh } = issueRow(id, { changed_at: T(41) })
    step(w, msg('issues', 'INSERT', { ...fresh, partial: true }))
    step(w, msg('issues', 'UPDATE', { id, priority: 2, changed_at: T(42) }))
    step(w, { from: 'fetch', table: 'issues', rows: [issueRow(id, { priority: 2, description: 'Huge', changed_at: T(42) })] })
    expect(w.data.issues[id].description).toBe('Huge')
  })
})

describe('only this workspace, and only you', () => {
  test('rows and deletions from another workspace are ignored', () => {
    const w = open()
    const r = step(
      w,
      msg('issues', 'INSERT', issueRow('IX-000000000000', { workspace_id: 'ws-2', changed_at: T(90) })),
      msg('workspace_members', 'UPDATE', { workspace_id: 'ws-2', profile_id: ME, role: 'admin', changed_at: T(90) }),
      { from: 'deletions', rows: [{ ...deletion('issues', { id: I1 }, 95), workspace_id: 'ws-2' }] },
    )
    expect(r.patch).toEqual({})
    expect(r.fetch).toEqual([])
    expect(w.data.issues[I1]).toBeDefined()
  })

  test('a note from another workspace never moves the mark', () => {
    const w = open()
    const before = w.state.mark
    step(w, msg('inbox', 'UPDATE', { id: 'n-x', read_at: T(91), changed_at: T(91) }))
    expect(w.state.mark).toBe(before)
  })

  test('read marks are yours only', () => {
    const w = open()
    expect(step(w, msg('read_state', 'UPDATE', { profile_id: 'p-bob', workspace_id: WS, read_until: T(85), changed_at: T(85) })).patch).toEqual({})
    step(w, msg('read_state', 'UPDATE', { profile_id: ME, workspace_id: WS, read_until: T(85), changed_at: T(85) }))
    expect(w.data.readState.readUntil).toBe(Z(85))
  })

  test('a note you write for someone else is not in your inbox', () => {
    const w = open()
    const note: AnyChange = {
      table: 'inbox',
      op: 'insert',
      key: { id: 'n-o' },
      fields: { id: 'n-o', workspace_id: WS, recipient_id: 'p-bob', type: 'assigned', issue_id: I1 },
      guess: { actor_id: ME, at: T(90) },
    }
    expect(step(w, { from: 'local', change: note }).patch).toEqual({})
  })
})

describe('people and teams that arrive later', () => {
  test('rows that point at someone new wait for their profile, asked for once', () => {
    const w = open()
    const id = 'I9-000000000000'
    const r = step(
      w,
      msg('issues', 'INSERT', issueRow(id, { assignee_id: 'p-cy', changed_at: T(50) })),
      msg('workspace_members', 'INSERT', { workspace_id: WS, profile_id: 'p-cy', role: 'member', joined_at: T(50), removed_at: null, changed_at: T(50) }),
      msg('comments', 'INSERT', commentRow('c-9', id, 'p-cy', 51)),
    )
    expect(r.fetch).toEqual([{ table: 'profiles', key: { id: 'p-cy' } }])
    expect(w.data.issues[id].assignee).toBe('p-cy')
    expect(w.data.members['p-cy']).toBeDefined()
    step(w, { from: 'fetch', table: 'profiles', rows: [profile('p-cy', 'cy')], keys: [{ id: 'p-cy' }] })
    expect(w.data.issues[id].assignee).toBe('cy')
    expect(w.data.comments[id][0].author).toBe('cy')
    expect(w.data.members.cy).toEqual({ role: 'member', removedAt: null })
    expect(w.data.members['p-cy']).toBeUndefined()
    expect(w.state.waiting).toEqual({})
  })

  test('someone who couldn\'t be fetched is asked for again by the next row', () => {
    const w = open()
    const ask = (id: string, s: number) => step(w, msg('issues', 'INSERT', issueRow(id, { assignee_id: 'p-zz', changed_at: T(s) }))).fetch
    expect(ask('IA-000000000000', 50)).toEqual([{ table: 'profiles', key: { id: 'p-zz' } }])
    expect(ask('IB-000000000000', 51)).toEqual([])
    step(w, { from: 'fetch', table: 'profiles', rows: [], keys: [{ id: 'p-zz' }] })
    expect(ask('IC-000000000000', 52)).toEqual([{ table: 'profiles', key: { id: 'p-zz' } }])
  })
})

describe('comments', () => {
  test('two comments at the same moment are ordered by id', () => {
    const w = open()
    step(w, msg('comments', 'INSERT', commentRow('c-b', I2, ME, 60)), msg('comments', 'INSERT', commentRow('c-a', I2, ME, 60)))
    expect(w.data.comments[I2].map((c) => c.id)).toEqual(['c-a', 'c-b'])
  })

  test('a comment that moves to another issue leaves the first one', () => {
    const w = open()
    step(w, msg('comments', 'UPDATE', { id: 'c-1', issue_id: I2, changed_at: T(61) }))
    expect(w.data.comments[I1].map((c) => c.id)).toEqual(['c-2'])
    expect(w.data.comments[I2].map((c) => c.id)).toEqual(['c-1'])
  })

  test('the comments of a deleted issue don\'t come back with an older copy', () => {
    const w = open()
    step(w, msg('issues', 'DELETE', { id: I1 }))
    step(w, { from: 'fetch', table: 'comments', rows: [commentRow('c-1', I1, 'p-bob', 3)] })
    step(w, msg('issues', 'INSERT', issueRow(I1, { changed_at: T(40) })))
    expect(w.data.issues[I1]).toBeDefined()
    expect(w.data.comments[I1]).toBeUndefined()
  })
})

describe('your own changes, edge cases', () => {
  test('an edit to something a teammate deletes goes with it', () => {
    const w = open()
    step(w, { from: 'local', change: titleChange({ title: 'Mine' }) })
    step(w, { from: 'local', change: { table: 'labels', op: 'update', key: { id: 'l-bug' }, fields: { name: 'Bugz' } } })
    step(w, { from: 'local', change: { table: 'views', op: 'update', key: { id: 'v-1' }, fields: { name: 'X' } } })
    const r = step(w, msg('issues', 'DELETE', { id: I1 }), msg('labels', 'DELETE', { id: 'l-bug' }), msg('views', 'DELETE', { id: 'v-1' }))
    expect(w.data.issues[I1]).toBeUndefined()
    expect(w.data.labels['l-bug']).toBeUndefined()
    expect(w.data.views['v-1']).toBeUndefined()
    expect(r.fetch).toEqual([])
  })

  test('a failed insert takes the edits made on top of it too', () => {
    const w = open()
    const insert: AnyChange = { table: 'comments', op: 'insert', key: { id: 'c-new' }, fields: { id: 'c-new', workspace_id: WS, issue_id: I1, body: 'hi' }, guess: { author_id: ME, created_at: T(99), edited_at: null } }
    const edit: AnyChange = { table: 'comments', op: 'update', key: { id: 'c-new' }, fields: { body: 'hello' } }
    step(w, { from: 'local', change: insert }, { from: 'local', change: edit })
    expect(w.data.comments[I1].find((c) => c.id === 'c-new')?.body).toBe('hello')
    step(w, { from: 'settled', change: insert, ok: false })
    expect(w.data.comments[I1].map((c) => c.id)).toEqual(['c-1', 'c-2'])
    expect(w.state.local).toEqual({})
  })

  test('the same value sent twice stays pending until the last write is back', () => {
    const w = open()
    step(w, { from: 'local', change: titleChange({ title: 'A' }) }, { from: 'local', change: titleChange({ title: 'B' }) }, { from: 'local', change: titleChange({ title: 'A' }) })
    step(w, { from: 'settled', change: titleChange({ title: 'A' }), ok: true, row: issueRow(I1, { title: 'A', changed_at: T(51) }) })
    expect(w.data.issues[I1].title).toBe('A')
    expect(pendingFields(w.state, 'issues', { id: I1 })).toEqual(['title'])
    step(w, { from: 'settled', change: titleChange({ title: 'B' }), ok: true, row: issueRow(I1, { title: 'B', changed_at: T(52) }) })
    expect(w.data.issues[I1].title).toBe('A')
    step(w, { from: 'settled', change: titleChange({ title: 'A' }), ok: true, row: issueRow(I1, { title: 'A', changed_at: T(53) }) })
    expect(w.data.issues[I1].title).toBe('A')
    expect(pendingFields(w.state, 'issues', { id: I1 })).toEqual([])
  })

  test('a delete hides the row until it is confirmed, and a failed one brings it back', () => {
    const w = open()
    const del: AnyChange = { table: 'issues', op: 'delete', key: { id: I1 } }
    step(w, { from: 'local', change: del })
    expect(w.data.issues[I1]).toBeUndefined()
    expect(pendingDelete(w.state, 'issues', { id: I1 })).toBe(true)
    step(w, { from: 'settled', change: del, ok: false })
    expect(w.data.comments[I1]).toHaveLength(2)
    expect(pendingDelete(w.state, 'issues', { id: I1 })).toBe(false)
    step(w, { from: 'local', change: del }, { from: 'settled', change: del, ok: true, row: issueRow(I1) })
    expect(w.data.issues[I1]).toBeUndefined()
    expect(step(w, { from: 'fetch', table: 'issues', rows: [issueRow(I1)] }).patch).toEqual({})
  })
})

const pullRow = (issue: string, id: string, more: Partial<Row<'issue_pull_requests'>> = {}): Row<'issue_pull_requests'> => ({
  workspace_id: WS,
  issue_id: issue,
  pull_request_id: id,
  repo: 'acme/web',
  number: 12,
  title: 'Fix login',
  url: 'https://github.com/acme/web/pull/12',
  state: 'open',
  author_id: 'p-bob',
  github_updated_at: T(30),
  created_at: T(30),
  changed_at: T(30),
  ...more,
})

describe('pull requests', () => {
  test('they show on their issue, by repository and number, with the author by login', () => {
    const w = open()
    const before = w.data
    const r = step(w, {
      from: 'fetch',
      table: 'issue_pull_requests',
      rows: [pullRow(I1, '900', { repo: 'acme/web', number: 30 }), pullRow(I1, '800', { repo: 'acme/api', number: 40 }), pullRow(I1, '700', { number: 5 })],
    })
    expect(Object.keys(r.patch)).toEqual(['pullRequests'])
    expect(w.data.pullRequests[I1].map((p) => `${p.repo}#${p.number}`)).toEqual(['acme/api#40', 'acme/web#5', 'acme/web#30'])
    expect(w.data.pullRequests[I1][0]).toEqual({
      id: '800',
      repo: 'acme/api',
      number: 40,
      title: 'Fix login',
      url: 'https://github.com/acme/web/pull/12',
      state: 'open',
      author: 'bob',
      updatedAt: Z(30),
    })
    expect(w.data.pullRequests[I2]).toBeUndefined()
    expect(w.data.issues).toBe(before.issues)
  })

  test('a merge changes its state live, and one taken off the issue goes', () => {
    const w = open()
    step(w, { from: 'fetch', table: 'issue_pull_requests', rows: [pullRow(I1, '900'), pullRow(I1, '901', { number: 13 })] })
    const other = w.data.pullRequests[I1][1]
    step(w, msg('issue_pull_requests', 'UPDATE', { issue_id: I1, pull_request_id: '900', state: 'merged', changed_at: T(31) }))
    expect(w.data.pullRequests[I1].map((p) => p.state)).toEqual(['merged', 'open'])
    expect(w.data.pullRequests[I1][1]).toBe(other)
    step(w, msg('issue_pull_requests', 'DELETE', { issue_id: I1, pull_request_id: '900' }))
    expect(w.data.pullRequests[I1].map((p) => p.number)).toEqual([13])
    step(w, { from: 'deletions', rows: [deletion('issue_pull_requests', { issue_id: I1, pull_request_id: '901' }, 40)] })
    expect(w.data.pullRequests[I1]).toBeUndefined()
  })

  test('a deleted issue takes its pull requests along, and an archived one keeps them', () => {
    const w = open()
    step(w, { from: 'fetch', table: 'issue_pull_requests', rows: [pullRow(I1, '900'), pullRow(I2, '900')] })
    step(w, msg('issues', 'UPDATE', { id: I2, archived_at: T(40), archived_by: ME, changed_at: T(40) }))
    expect(w.data.archive[I2]).toBeDefined()
    expect(w.data.pullRequests[I2]).toHaveLength(1)
    step(w, msg('issues', 'DELETE', { id: I1 }))
    expect(w.data.pullRequests[I1]).toBeUndefined()
    expect(step(w, { from: 'fetch', table: 'issue_pull_requests', rows: [pullRow(I1, '900')] }).patch).toEqual({})
  })
})

describe('the same inputs twice', () => {
  test('applying them again changes nothing', () => {
    let seed = 12345
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const pick = <X,>(xs: X[]) => xs[Math.floor(rnd() * xs.length)]
    const issues = [I1, I2, 'I3-000000000000']
    const event = (s: number): Incoming => {
      const k = Math.floor(rnd() * 6)
      if (k === 0) return { from: 'fetch', table: 'issues', rows: [issueRow(pick(issues), { title: `t${s}`, changed_at: T(s) })] }
      if (k === 1) return { from: 'fetch', table: 'issue_labels', rows: [{ workspace_id: WS, issue_id: pick(issues), label_id: pick(['l-bug', 'l-ui']), changed_at: T(s) }] }
      if (k === 2) return { from: 'fetch', table: 'comments', rows: [{ ...commentRow(pick(['c-1', 'c-2', 'c-3']), pick(issues), ME, 3), body: `b${s}`, changed_at: T(s) }] }
      if (k === 3) return { from: 'deletions', rows: [deletion('issues', { id: pick(issues) }, s)] }
      if (k === 4) return { from: 'deletions', rows: [deletion('issue_labels', { issue_id: pick(issues), label_id: pick(['l-bug', 'l-ui']) }, s)] }
      return { from: 'deletions', rows: [deletion('comments', { id: pick(['c-1', 'c-2', 'c-3']) }, s)] }
    }
    for (let trial = 0; trial < 300; trial++) {
      const events = Array.from({ length: 2 + Math.floor(rnd() * 7) }, (_, n) => event(100 + n))
      const w = open()
      for (const e of events) step(w, e)
      expect(applyRows(w.state, w.data, events, w.ctx).patch).toEqual({})
    }
  })
})
