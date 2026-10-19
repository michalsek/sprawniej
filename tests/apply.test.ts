import { describe, expect, test } from 'bun:test'
import { applyRows, emptyLive, pendingFields, type ApplyContext, type Incoming, type LiveState, type StoreSlice } from '@/backend/apply'
import type { AnyChange } from '@/backend/changes'
import { Registry } from '@/backend/registry'
import type { DeletionRow, Row } from '@/backend/tables'
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

/** applies more inputs on top, like the store would */
function step(w: Open, ...inputs: Incoming[]) {
  const r = applyRows(w.state, w.data, inputs, w.ctx)
  w.state = r.state
  w.data = { ...w.data, ...r.patch }
  return r
}

const msg = (table: string, op: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>): Incoming => ({ from: 'message', message: { table, op, row } })
const deletion = (table_name: string, row_key: Record<string, string>, s: number): DeletionRow => ({ id: s, workspace_id: WS, table_name, row_key, deleted_at: T(s) })
const titleChange = (fields: Record<string, unknown>): AnyChange => ({ table: 'issues', op: 'update', key: { id: I1 }, fields })

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
    expect(data.readState).toEqual({ readUntil: Z(5), read: [] })
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

  test('no GitHub account is GitHub id 0', () => {
    const w = open()
    expect(w.data.people['~jan'].githubId).toBe(0)
    step(w, msg('profiles', 'INSERT', profile('p-cy', 'cy', { github_id: null })))
    expect(w.data.people.cy.githubId).toBe(0)
  })

  test('fields without a column show on the store objects', () => {
    const { data } = open()
    expect(data.issues[I2].foo).toBe('bar')
    expect(data.labels['l-ui'].shade).toBe('dark')
  })

  test('the same rows again change nothing', () => {
    const w = open()
    expect(step(w, ...world()).patch).toEqual({})
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
  })

  test('the mark is the latest change seen', () => {
    const w = open()
    expect(step(w, msg('issues', 'UPDATE', { id: I1, title: 'A', changed_at: T(30) })).state.mark).toBe(T(30))
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
    step(w, { from: 'settled', change: titleChange({ title: 'Mine' }) })
    expect(w.data.issues[I1].title).toBe('Theirs')
    expect(pendingFields(w.state, 'issues', { id: I1 })).toEqual([])
  })

  test('a newer edit stays while an older one is confirmed', () => {
    const w = open()
    step(w, { from: 'local', change: titleChange({ title: 'A' }) }, { from: 'local', change: titleChange({ title: 'B' }) })
    step(w, { from: 'settled', change: titleChange({ title: 'A' }), row: issueRow(I1, { title: 'A', changed_at: T(51) }) })
    expect(w.data.issues[I1].title).toBe('B')
  })

  test('a failed write is undone', () => {
    const w = open()
    step(w, { from: 'local', change: titleChange({ title: 'X' }) })
    step(w, { from: 'settled', change: titleChange({ title: 'X' }) })
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
    step(w, { from: 'settled', change: titleChange({ title: 'Mine' }), row: issueRow(I1, { title: 'Mine', changed_at: T(60) }) })
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
