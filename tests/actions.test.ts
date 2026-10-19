import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { stopWrites } from '@/backend/writes'
import {
  archiveIssues,
  createIssue,
  createLabel,
  createProject,
  createView,
  deleteProject,
  followerChanges,
  followNumber,
  issueColumns,
  labelChanges,
  moveIssueToTeam,
  nextNumber,
  noteRows,
  restoreIssue,
  setFollowers,
  updateIssue,
  updateView,
  viewsWithout,
} from '@/data/actions'
import { DEFAULT_DISPLAY } from '@/data/displays'
import { useData } from '@/data/store'
import { Registry } from '@/backend/registry'
import { profileIdOf, seed, teamIdOf, type World } from './support/fakeBackend'

let w: World
let warn: ReturnType<typeof spyOn>
beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
  w = seed({ me: 'ana', people: ['bob'], teams: [{ key: 'ENG', name: 'Engineering', members: ['ana'] }, { key: 'DES', name: 'Design' }] })
})
afterEach(() => {
  stopWrites()
  warn.mockRestore()
})

const state = () => useData.getState()
/** a pretend address bar for followNumber */
function addressBar(hash: string) {
  const loc = { hash, replace: (url: string) => (loc.hash = url) }
  return loc
}

describe('views', () => {
  test('a new view keeps its filters and owner, without empty lists', async () => {
    const v = createView({ name: ' Open bugs ', emoji: '🐞', team: 'ENG', filters: { statuses: ['todo'], labels: [] }, display: DEFAULT_DISPLAY })
    expect(state().views[v.id]).toMatchObject({ name: 'Open bugs', owner: 'ana', team: 'ENG', filters: { statuses: ['todo'] } })
    await w.settle()
    expect(w.db.get('views', { id: v.id })).toMatchObject({ team_id: teamIdOf('ENG'), owner_id: profileIdOf('ana'), filters: { statuses: ['todo'] } })
  })

  test('an edit sends only what changed', async () => {
    const v = createView({ name: 'All', emoji: '🔍', team: null, display: DEFAULT_DISPLAY })
    await w.settle()
    const sent = w.since()
    updateView(v.id, { name: 'All', filters: { statuses: [], labels: ['l1'] } })
    await w.settle()
    expect(sent()).toEqual([{ kind: 'update', table: 'views', fields: { filters: { labels: ['l1'] } }, keys: [{ id: v.id }] }])
    expect(state().views[v.id].filters).toEqual({ labels: ['l1'] })
  })
})

test('deleting a project: its issues stay, without it, at once; one request', async () => {
  const p = createProject({ name: 'Launch', emoji: '🚀', teams: ['ENG'] })
  const i = createIssue({ team: 'ENG', title: 'Write the post', project: p.id })
  await w.settle()
  expect(state().issues[i.id].project).toBe(p.id)
  const sent = w.since()
  deleteProject(p.id)
  expect(state().projects[p.id]).toBeUndefined()
  expect(state().issues[i.id].project).toBeNull()
  await w.settle()
  expect(sent()).toEqual([{ kind: 'delete', table: 'projects', keys: [{ id: p.id }] }])
})

describe('issue numbers', () => {
  test('a guess is one more than any we know of, archived ones too', async () => {
    useData.setState({ teams: { ...state().teams, ENG: { ...state().teams.ENG, lastNumber: 4 } } })
    expect(nextNumber('ENG')).toBe(5)
    const a = createIssue({ team: 'ENG', title: 'one' })
    expect(a.number).toBe(5)
    // the second guess sees the first
    expect(createIssue({ team: 'ENG', title: 'two' }).number).toBe(6)
    await w.settle()
    archiveIssues([a.id])
    expect(nextNumber('ENG')).toBeGreaterThan(state().archive[a.id].number)
  })

  test('a teammate was quicker: the saved number shows, and the address follows it', async () => {
    w.db.numberOffset(1)
    const bar = addressBar('')
    const was = globalThis.location
    Object.assign(globalThis, { location: bar })
    try {
      const i = createIssue({ team: 'ENG', title: 'Raced' })
      expect(i.number).toBe(1)
      bar.hash = `#/issue/ENG-${i.number}`
      await w.settle()
      expect(state().issues[i.id].number).toBe(2)
      expect(bar.hash).toBe('#/issue/ENG-2')
    } finally {
      Object.assign(globalThis, { location: was })
    }
  })

  test('followNumber only moves an address that shows the guessed number', () => {
    const bar = addressBar('#/issue/eng-3/history')
    followNumber('ENG', 3, 5, bar)
    expect(bar.hash).toBe('#/issue/ENG-5/history')
    const other = addressBar('#/issue/ENG-31')
    followNumber('ENG', 3, 5, other)
    expect(other.hash).toBe('#/issue/ENG-31')
  })

  test('a move goes through the database, with a guessed number that it puts right', async () => {
    const i = createIssue({ team: 'ENG', title: 'Wanders off' })
    await w.settle()
    w.db.numberOffset(2)
    const sent = w.since()
    const moved = moveIssueToTeam(i.id, 'DES')!
    expect(moved).toMatchObject({ team: 'DES', number: 1, formerRefs: [`ENG-${i.number}`] })
    await w.settle()
    expect(sent()).toEqual([{ kind: 'call', fn: 'move_issue_to_team', args: { p_issue: i.id, p_team: teamIdOf('DES') }, key: { id: i.id } }])
    expect(state().issues[i.id]).toMatchObject({ team: 'DES', number: 3, formerRefs: [`ENG-${i.number}`] })
  })
})

test('a label with a name that is taken is the one already there, and nothing is sent (E5)', async () => {
  const bug = createLabel('Bug')
  await w.settle()
  const sent = w.since()
  expect(createLabel(' bug ').id).toBe(bug.id)
  await w.settle()
  expect(sent()).toEqual([])
  expect(Object.keys(state().labels)).toEqual([bug.id])
})

test('an issue made as Done is finished at once (E23)', async () => {
  const i = createIssue({ team: 'ENG', title: 'Already done', status: 'done' })
  expect(state().issues[i.id].completedAt).toBeTruthy()
  await w.settle()
  expect(state().issues[i.id].completedAt).toBeTruthy()
})

test('labels and followers: only the rows that change are sent', async () => {
  const a = createLabel('A')
  const b = createLabel('B')
  const c = createLabel('C')
  const i = createIssue({ team: 'ENG', title: 'Tagged', labels: [a.id, b.id] })
  await w.settle()
  const sent = w.since()
  updateIssue(i.id, { labels: [b.id, c.id, c.id] })
  await w.settle()
  expect(sent().map((r) => [r.kind, r.kind === 'insert' ? r.rows.map((x) => x.label_id) : r.kind === 'delete' ? r.keys.map((k) => k.label_id) : null])).toEqual([
    ['insert', [c.id]],
    ['delete', [a.id]],
  ])
  expect(state().issues[i.id].labels.sort()).toEqual([b.id, c.id].sort())
  // labels don't count as an edit of the issue itself
  expect(sent().some((r) => r.kind === 'update')).toBe(false)

  const follow = w.since()
  setFollowers(i.id, ['ana', 'bob'])
  await w.settle()
  expect(follow()).toEqual([{ kind: 'insert', table: 'issue_followers', rows: [{ workspace_id: 'ws-1', issue_id: i.id, profile_id: profileIdOf('bob'), following: true }] }])
  const unfollow = w.since()
  setFollowers(i.id, ['bob'])
  await w.settle()
  expect(unfollow()).toEqual([{ kind: 'insert', table: 'issue_followers', rows: [{ workspace_id: 'ws-1', issue_id: i.id, profile_id: profileIdOf('ana'), following: false }] }])
  expect(state().issues[i.id]).toMatchObject({ subscribers: ['bob'], unsubscribed: ['ana'] })
})

test('archiving takes sub-issues along, restoring brings them back; one request each way', async () => {
  const parent = createIssue({ team: 'ENG', title: 'Parent' })
  const child = createIssue({ team: 'ENG', title: 'Child', parent: parent.id })
  await w.settle()
  const sent = w.since()
  expect(archiveIssues([parent.id])).toBe(2)
  expect(Object.keys(state().archive).sort()).toEqual([parent.id, child.id].sort())
  expect(state().issues[parent.id]).toBeUndefined()
  await w.settle()
  expect(state().archive[parent.id]).toMatchObject({ archivedBy: 'ana' })
  expect(restoreIssue(parent.id)).toMatchObject({ title: 'Parent', number: parent.number })
  expect(state().issues[child.id]).toMatchObject({ title: 'Child', parent: parent.id, number: child.number })
  expect(state().archive).toEqual({})
  await w.settle()
  expect(sent().map((r) => r.kind === 'update' && [r.fields.archived_at === null ? 'restore' : 'archive', r.keys.length])).toEqual([
    ['archive', 2],
    ['restore', 2],
  ])
  expect(w.db.get('issues', { id: child.id })?.archived_at).toBeNull()
})

test('an issue’s fields as columns', () => {
  const r = new Registry()
  r.learnProfile('p-bob', 'bob')
  expect(issueColumns({ title: 't', assignee: 'bob', project: null, parent: 'i9', dueDate: null, sortOrder: 'a1', duplicateOf: undefined }, { registry: r })).toEqual({
    title: 't',
    assignee_id: 'p-bob',
    project_id: null,
    parent_id: 'i9',
    due_date: null,
    sort_order: 'a1',
  })
  // someone nobody knows is left out, not saved as no one
  expect(issueColumns({ assignee: 'nobody' }, { registry: r })).toEqual({})
  expect(issueColumns({ assignee: null }, { registry: r })).toEqual({ assignee_id: null })
})

describe('the rows behind an issue', () => {
  const ctx = () => {
    const r = new Registry()
    for (const l of ['ana', 'bob', 'cy']) r.learnProfile(`p-${l}`, l)
    return { workspaceId: 'w', registry: r }
  }

  test('labelChanges: only what was added and taken away', () => {
    expect(labelChanges('i', ['a', 'b'], ['b', 'c'], ctx())).toEqual([
      { table: 'issue_labels', key: { issue_id: 'i', label_id: 'c' }, op: 'insert', fields: { workspace_id: 'w', issue_id: 'i', label_id: 'c' } },
      { table: 'issue_labels', key: { issue_id: 'i', label_id: 'a' }, op: 'delete' },
    ])
    expect(labelChanges('i', ['a'], ['a'], ctx())).toEqual([])
  })

  test('followerChanges: a new one is added, one turned round is changed, one left out is removed', () => {
    const issue = { id: 'i', subscribers: ['bob', 'ana'], unsubscribed: ['cy'] }
    const out = followerChanges(issue, new Map([['bob', false], ['cy', false], ['dee', true]]), ctx())
    expect(out).toEqual([
      { table: 'issue_followers', key: { issue_id: 'i', profile_id: 'p-bob' }, op: 'update', fields: { following: false } },
      { table: 'issue_followers', key: { issue_id: 'i', profile_id: 'p-ana' }, op: 'delete' },
    ])
    expect(warn).toHaveBeenCalled() // dee is nobody we know: left out
  })

  test('noteRows: one row per note, people we do not know are left out', () => {
    const rows = noteRows('i', [{ to: 'bob', type: 'mentioned', comment: 'c1' }, { to: 'nobody', type: 'assigned' }, { to: 'cy', type: 'status', status: 'done' }], ctx())
    expect(rows.map(({ id: _id, ...r }) => r)).toEqual([
      { workspace_id: 'w', recipient_id: 'p-bob', type: 'mentioned', issue_id: 'i', comment_id: 'c1', status: null },
      { workspace_id: 'w', recipient_id: 'p-cy', type: 'status', issue_id: 'i', comment_id: null, status: 'done' },
    ])
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
  })

  test('viewsWithout: the id comes out where others are left; a view about only it, or being deleted, stays', () => {
    const view = (id: string, teams: string[]) => ({ id, name: id, emoji: '', description: '', owner: 'ana', team: null, filters: { teams, statuses: ['todo'] }, display: DEFAULT_DISPLAY, createdAt: '' }) as never
    const views = { a: view('a', ['ENG', 'DES']), b: view('b', ['DES']), c: view('c', ['DES', 'OPS']) }
    expect(viewsWithout(views, 'teams', 'DES', new Set(['c']))).toEqual([{ table: 'views', key: { id: 'a' }, op: 'update', fields: { filters: { teams: ['ENG'], statuses: ['todo'] } } }])
  })
})

test('deleting a label or a project changes views only once it is deleted', async () => {
  const label = createLabel('Gone')
  const keep = createLabel('Kept')
  const v = createView({ name: 'Mixed', emoji: '🧪', team: null, filters: { labels: [label.id, keep.id] }, display: DEFAULT_DISPLAY })
  await w.settle()
  w.db.failNext('42501')
  const { deleteLabel } = await import('@/data/actions')
  const sent = w.since()
  deleteLabel(label.id)
  expect(state().views[v.id].filters).toEqual({ labels: [keep.id] })
  await w.settle()
  expect(sent().map((r) => r.kind !== 'notes' && r.kind !== 'call' && r.table)).toEqual(['labels'])
  expect(state().views[v.id].filters).toEqual({ labels: [label.id, keep.id] })
  expect(state().labels[label.id]).toBeDefined()
})
