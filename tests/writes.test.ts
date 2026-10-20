import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { emptyLive, pendingFields, type Incoming } from '@/backend/apply'
import { chipState } from '@/backend/status'
import { attach, context, detach, flush, IN_FLIGHT, pending, stopWrites, writesStatus } from '@/backend/writes'
import { MESSAGES } from '@/backend/writes/problems'
import type { Request } from '@/backend/writes/send'
import {
  archiveIssues,
  createComment,
  createIssue,
  createLabel,
  createProject,
  createStatus,
  createView,
  deleteComment,
  deleteIssue,
  deleteProject,
  deleteTeam,
  markRead,
  moveIssueToTeam,
  moveProject,
  moveStatus,
  setChecklistItem,
  updateComment,
  updateIssue,
  updateProject,
  updateStatus,
} from '@/data/actions'
import { EMPTY, useData } from '@/data/store'
import { drain, FakeTarget, person, profileIdOf, projectStatusIdOf, seed, statusIdOf, teamIdOf, WS, type World } from './support/fakeBackend'
import { TICK_REFUSED } from './support/fakeDb'

let w: World
let warn: ReturnType<typeof spyOn>
let error: ReturnType<typeof spyOn>
beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
  error = spyOn(console, 'error').mockImplementation(() => {})
  w = seed({ me: 'ana', people: ['bob', 'cy'], teams: [{ key: 'ENG', name: 'Engineering', members: ['ana'] }, { key: 'DES', name: 'Design' }] })
})
afterEach(() => {
  stopWrites()
  warn.mockRestore()
  error.mockRestore()
})

const issue = (id: string) => useData.getState().issues[id]
const fieldsOf = (r: Request) => (r.kind === 'update' ? r.fields : r.kind === 'insert' ? r.rows : r.kind)
const saved = async (title = 'An issue', more: Partial<Parameters<typeof createIssue>[0]> = {}) => {
  const i = createIssue({ team: 'ENG', title, ...more })
  await w.settle()
  return i
}
const nothingLeft = (id: string) => expect(pendingFields(w.target.live, 'issues', { id })).toEqual([])
const heard = (row: Record<string, unknown>) => w.target.apply([{ from: 'message', message: { table: 'issues', op: 'UPDATE', row: { workspace_id: WS, ...row } } }])

describe('changes to one row', () => {
  test('two in one moment go as one request; more while one is on its way go as one more, with the last values', async () => {
    const i = await saved()
    const sent = w.since()
    updateIssue(i.id, { title: 'a' })
    updateIssue(i.id, { priority: 2 })
    await w.settle()
    expect(sent('issues').map(fieldsOf)).toEqual([{ title: 'a', priority: 2 }])

    const more = w.since()
    w.db.hold()
    updateIssue(i.id, { title: 'b' })
    await drain()
    updateIssue(i.id, { title: 'c' })
    updateIssue(i.id, { title: 'cd' })
    updateIssue(i.id, { priority: 3 })
    await w.settle()
    expect(more('issues').map(fieldsOf)).toEqual([{ title: 'b' }, { title: 'cd', priority: 3 }])
    expect(issue(i.id)).toMatchObject({ title: 'cd', priority: 3 })
    nothingLeft(i.id)
    expect(pending()).toBe(0)
  })

  test('only the columns that changed are sent', async () => {
    const i = await saved('Same')
    const sent = w.since()
    updateIssue(i.id, { statusId: statusIdOf('in_progress'), title: 'Same' })
    await w.settle()
    // the status, and its category for older versions (it changed too)
    expect(sent('issues').map(fieldsOf)).toEqual([{ status: 'in_progress', status_id: statusIdOf('in_progress') }])
  })
})

describe('order', () => {
  test("an issue's labels go once the issue is saved", async () => {
    const label = createLabel('Bug')
    await w.settle()
    w.db.hold()
    const sent = w.since()
    createIssue({ team: 'ENG', title: 'With a label', labels: [label.id] })
    await drain()
    expect(sent().map((r) => r.kind === 'insert' && r.table)).toEqual(['issues'])
    await w.settle()
    expect(sent().map((r) => (r.kind === 'insert' ? r.table : r.kind))).toEqual(['issues', 'issue_labels'])
    expect(w.db.rows('issue_labels')).toHaveLength(1)
  })

  test('an edit of an issue still being made waits for it', async () => {
    w.db.hold()
    const sent = w.since()
    const i = createIssue({ team: 'ENG', title: 'New' })
    await drain()
    updateIssue(i.id, { title: 'Renamed' })
    await drain()
    expect(sent()).toHaveLength(1)
    await w.settle()
    expect(sent().map((r) => r.kind)).toEqual(['insert', 'update'])
    expect(w.db.get('issues', { id: i.id })?.title).toBe('Renamed')
  })

  test('made and deleted before it was sent: nothing is sent', async () => {
    const label = createLabel('Bug')
    await w.settle()
    const sent = w.since()
    const i = createIssue({ team: 'ENG', title: 'Oops', labels: [label.id] })
    deleteIssue(i.id)
    await w.settle()
    expect(sent()).toEqual([])
    expect(issue(i.id)).toBeUndefined()
    expect(pending()).toBe(0)
  })

  test('a label taken off and put back: two requests, in that order', async () => {
    const label = createLabel('Bug')
    const i = createIssue({ team: 'ENG', title: 'Labelled', labels: [label.id] })
    await w.settle()
    const sent = w.since()
    updateIssue(i.id, { labels: [] })
    updateIssue(i.id, { labels: [label.id] })
    await w.settle()
    expect(sent().map((r) => r.kind)).toEqual(['delete', 'insert'])
    expect(issue(i.id).labels).toEqual([label.id])
    expect(w.db.rows('issue_labels')).toHaveLength(1)
  })

  test('a move and the edits after it keep their order', async () => {
    const i = await saved()
    w.db.hold()
    const sent = w.since()
    moveIssueToTeam(i.id, 'DES')
    updateIssue(i.id, { title: 'Moved and renamed' })
    await w.settle()
    expect(sent().map((r) => r.kind)).toEqual(['call', 'update'])
    expect(w.db.get('issues', { id: i.id })).toMatchObject({ team_id: teamIdOf('DES'), title: 'Moved and renamed' })
  })
})

describe('your fields on their way', () => {
  test('survive their own echo, while a teammate’s other field shows; an older echo is ignored', async () => {
    const i = await saved('t')
    w.db.hold()
    updateIssue(i.id, { title: 'x' })
    await drain()
    heard({ id: i.id, title: 'x', changed_at: w.db.changedAt() })
    updateIssue(i.id, { title: 'xy' })
    expect(issue(i.id).title).toBe('xy')
    heard({ id: i.id, status: 'in_review', changed_at: w.db.changedAt() })
    expect(issue(i.id)).toMatchObject({ title: 'xy', status: 'in_review' })
    w.db.release(1)
    await drain()
    expect(issue(i.id).title).toBe('xy')
    await w.settle()
    expect(issue(i.id).title).toBe('xy')
    heard({ id: i.id, title: 'old', changed_at: '2026-10-19T11:00:00.000000+00:00' })
    expect(issue(i.id).title).toBe('xy')
    nothingLeft(i.id)
  })
})

describe('trying again', () => {
  const chip = () => chipState({ online: true, channelsUp: true, signedIn: true, failing: false }, writesStatus())

  test('no answer: tried again after 1 s and 2 s, the value stays on screen, and the chip says so', async () => {
    const i = await saved()
    w.db.failNext('network', 2)
    const sent = w.since()
    updateIssue(i.id, { title: 'r' })
    expect(chip()).toBe('saving')
    await drain()
    expect(sent()).toHaveLength(1)
    expect(chip()).toBe('error')
    expect(issue(i.id).title).toBe('r')
    await w.clock.advance(900)
    expect(sent()).toHaveLength(1)
    await w.clock.advance(200)
    expect(sent()).toHaveLength(2)
    await w.clock.advance(2_100)
    expect(sent()).toHaveLength(3)
    expect(sent().map(fieldsOf)).toEqual([{ title: 'r' }, { title: 'r' }, { title: 'r' }])
    expect(issue(i.id).title).toBe('r')
    expect(chip()).toBe('saved')
  })

  test('back online: tried again at once', async () => {
    const i = await saved()
    w.db.failNext('network')
    const sent = w.since()
    updateIssue(i.id, { title: 'r' })
    await drain()
    w.page.retry?.()
    await drain()
    expect(sent()).toHaveLength(2)
    expect(pending()).toBe(0)
  })

  test('the answer was lost but the issue landed: the try again finds it, and there is one', async () => {
    w.db.failNext('lostResponse')
    const i = createIssue({ team: 'ENG', title: 'Lost answer' })
    await drain()
    expect(writesStatus().waiting).toBe(true)
    await w.clock.advance(1_200)
    expect(w.db.rows('issues').filter((r) => r.title === 'Lost answer')).toHaveLength(1)
    expect(pending()).toBe(0)
    expect(issue(i.id).number).toBe(w.db.get('issues', { id: i.id })?.number as number)
    expect(w.told).toEqual([])
  })
})

describe('undone', () => {
  test('a new label the rules refuse goes away, and says so once', async () => {
    w.db.failNext('42501')
    const label = createLabel('Nope')
    expect(useData.getState().labels[label.id]).toBeDefined()
    await w.settle()
    expect(useData.getState().labels[label.id]).toBeUndefined()
    expect(w.told).toEqual([MESSAGES.refused])
  })

  test("someone else's comment: the edit and the delete come back", async () => {
    const i = await saved()
    useData.setState({ me: person('bob') })
    const c = createComment(i.id, 'mine')!
    await w.settle()
    useData.setState({ me: person('ana') })
    updateComment(i.id, c.id, 'yours now')
    expect(useData.getState().comments[i.id][0].body).toBe('yours now')
    await w.settle()
    expect(useData.getState().comments[i.id][0].body).toBe('mine')
    deleteComment(i.id, c.id)
    expect(useData.getState().comments[i.id]).toBeUndefined()
    await w.settle()
    expect(useData.getState().comments[i.id].map((x) => x.body)).toEqual(['mine'])
    expect(w.told).toEqual([MESSAGES.comment])
  })

  test('a refused team delete brings the team and everything in it back', async () => {
    useData.setState({ members: { ...useData.getState().members, ana: { role: 'admin', removedAt: null } } })
    w.db.get('workspace_members', { workspace_id: WS, profile_id: profileIdOf('ana') })!.role = 'member'
    const i = createIssue({ team: 'DES', title: 'In design' })
    await w.settle()
    expect(deleteTeam('DES')).toBe(true)
    expect(useData.getState().teams.DES).toBeUndefined()
    expect(issue(i.id)).toBeUndefined()
    await w.settle()
    expect(useData.getState().teams.DES).toBeDefined()
    expect(issue(i.id)).toBeDefined()
    expect(w.told).toEqual([MESSAGES.deleteTeam])
  })

  test('deleted meanwhile: said, unless you deleted it yourself', async () => {
    const a = await saved('a')
    w.db.t('issues').delete(a.id)
    updateIssue(a.id, { title: 'too late' })
    await w.settle()
    expect(w.told).toEqual([MESSAGES.goneIssue])

    const b = await saved('b')
    w.db.hold()
    updateIssue(b.id, { title: 'on its way' })
    await drain()
    w.db.t('issues').delete(b.id)
    deleteIssue(b.id)
    await w.settle()
    expect(w.told).toEqual([MESSAGES.goneIssue])
    expect(issue(b.id)).toBeUndefined()
    expect(pending()).toBe(0)
  })

  test('a label name that is taken: the label and the issue’s use of it go, with one message', async () => {
    const i = await saved()
    w.db.failNext('23505:labels_name')
    const sent = w.since()
    const label = createLabel('Taken')
    updateIssue(i.id, { labels: [label.id] })
    expect(issue(i.id).labels).toEqual([label.id])
    await w.settle()
    expect(issue(i.id).labels).toEqual([])
    expect(sent('issue_labels')).toEqual([])
    expect(w.told).toEqual([MESSAGES.labelName])
  })
})

describe('inbox notes', () => {
  test('go once what they are about is saved, without asking for rows back', async () => {
    w.db.hold()
    const sent = w.since()
    createIssue({ team: 'ENG', title: 'For bob', assignee: 'bob' })
    await drain()
    expect(sent().map((r) => r.kind)).toEqual(['insert'])
    await w.settle()
    expect(sent().map((r) => r.kind)).toEqual(['insert', 'notes'])
    expect(w.db.notesFor('bob').map((n) => n.type)).toEqual(['assigned'])
  })

  test("none for an edit that isn't saved", async () => {
    const i = await saved()
    useData.setState({ me: person('bob') })
    const c = createComment(i.id, 'hi')!
    await w.settle()
    useData.setState({ me: person('ana') })
    const sent = w.since()
    updateComment(i.id, c.id, 'hi @cy')
    await w.settle()
    expect(sent('inbox')).toEqual([])
    expect(w.db.notesFor('cy')).toEqual([])
  })
})

describe('many rows in one request', () => {
  test('archiving three issues, marking two notes read', async () => {
    const a = await saved('a')
    const b = await saved('b')
    const c = await saved('c')
    const sent = w.since()
    expect(archiveIssues([a.id, b.id, c.id])).toBe(3)
    expect(Object.keys(useData.getState().archive).sort()).toEqual([a.id, b.id, c.id].sort())
    await w.settle()
    const archived = sent('issues')
    expect(archived).toHaveLength(1)
    expect(archived[0].kind === 'update' && archived[0].keys).toHaveLength(3)

    const note = (id: string) => ({ id, workspace_id: WS, recipient_id: profileIdOf('ana'), actor_id: profileIdOf('bob'), type: 'assigned', issue_id: a.id, comment_id: null, status: null, at: '2026-10-19T10:00:00.000Z', read_at: null, extra: {} })
    for (const n of [note('n1'), note('n2')]) w.db.put('inbox', n)
    w.target.apply([{ from: 'fetch', table: 'inbox', rows: w.db.rows('inbox') }])
    const read = w.since()
    markRead(['n1', 'n2'])
    await w.settle()
    expect(read('inbox')).toHaveLength(1)
    expect(useData.getState().inbox.every((n) => n.readAt)).toBe(true)
  })
})

describe('what the database empties by itself', () => {
  test("a deleted project's issues show without it at once, until the database's copy agrees", async () => {
    const p = createProject({ name: 'Launch', emoji: '🚀', teams: ['ENG'] })
    const i = createIssue({ team: 'ENG', title: 'Post', project: p.id })
    await w.settle()
    w.db.messages()
    deleteProject(p.id)
    expect(issue(i.id).project).toBeNull()
    await w.settle()
    expect(pendingFields(w.target.live, 'issues', { id: i.id })).toEqual(['project_id'])
    w.echo()
    await w.clock.advance(300)
    nothingLeft(i.id)
    expect(issue(i.id).project).toBeNull()
  })

  test('without an echo it is taken as done after 10 s', async () => {
    const p = createProject({ name: 'Launch', emoji: '🚀' })
    const i = createIssue({ team: 'ENG', title: 'Post', project: p.id })
    await w.settle()
    deleteProject(p.id)
    await w.settle()
    await w.clock.advance(9_000)
    expect(pendingFields(w.target.live, 'issues', { id: i.id })).toEqual(['project_id'])
    await w.clock.advance(1_500)
    nothingLeft(i.id)
  })
})

describe('flush', () => {
  test('0 once everything is saved; offline, what is left after one more try', async () => {
    const i = await saved()
    updateIssue(i.id, { title: 'f' })
    expect(await flush()).toBe(0)
    w.db.failNext('network', 10)
    updateIssue(i.id, { title: 'g' })
    expect(await flush()).toBe(1)
    expect(issue(i.id).title).toBe('g')
  })
})

describe('the workspace read again from the start', () => {
  test('what was still unsaved shows on the new copy, and an answer that came meanwhile is kept', async () => {
    const i = await saved('one')
    w.db.hold()
    updateIssue(i.id, { title: 'd1' })
    await drain()
    updateIssue(i.id, { title: 'd2' })
    detach()
    // read again: the store starts over
    useData.setState({ ...EMPTY, me: person('ana') })
    const again = new FakeTarget(w.registry)
    again.live = emptyLive()
    again.apply([...w.db.tables.keys()].map((table): Incoming => ({ from: 'fetch', table, rows: w.db.rows(table) })))
    expect(issue(i.id).title).toBe('one')
    w.db.release(1)
    await drain()
    attach(again)
    expect(issue(i.id).title).toBe('d2')
    await w.settle()
    expect(issue(i.id).title).toBe('d2')
    expect(pendingFields(again.live, 'issues', { id: i.id })).toEqual([])
    expect(w.db.get('issues', { id: i.id })?.title).toBe('d2')
  })
})

test('closing the tab asks only while something is waiting', async () => {
  const i = await saved()
  w.page.guards.length = 0
  updateIssue(i.id, { title: 'q' })
  updateIssue(i.id, { priority: 1 })
  expect(w.page.guards).toEqual([true])
  await w.settle()
  expect(w.page.guards).toEqual([true, false])
})

describe('a request that may have landed', () => {
  test('never shares a request with new rows: two inserts while the first one’s answer was lost both save', async () => {
    w.db.failNext('lostResponse')
    const a = createIssue({ team: 'ENG', title: 'A, answer lost' })
    await drain()
    expect(writesStatus().waiting).toBe(true)
    const b = createIssue({ team: 'ENG', title: 'B, new' })
    await drain()
    const sent = w.since()
    await w.clock.advance(1_200)
    await w.settle()
    expect(w.db.rows('issues').map((r) => r.title).sort()).toEqual(['A, answer lost', 'B, new'])
    expect(issue(a.id)).toBeDefined()
    expect(issue(b.id)).toBeDefined()
    expect(pending()).toBe(0)
    expect(w.told).toEqual([])
    // A tried again on its own (it may be there already), B on its own
    expect(sent('issues').every((r) => r.kind !== 'insert' || r.rows.length === 1)).toBe(true)
  })
})

describe('while the workspace is read again', () => {
  test('changes still queue, and show on the new copy once it is in', async () => {
    const i = await saved('before')
    detach()
    expect(context()).not.toBeNull()
    updateIssue(i.id, { estimate: 5 })
    await w.settle()
    expect(w.db.get('issues', { id: i.id })?.estimate).toBe(5)
    useData.setState({ ...EMPTY, me: person('ana') })
    const again = new FakeTarget(w.registry)
    again.apply([...w.db.tables.keys()].map((table): Incoming => ({ from: 'fetch', table, rows: w.db.rows(table) })))
    attach(again)
    expect(issue(i.id).estimate).toBe(5)
  })

  test('a change made while detached and not answered yet shows on the new copy', async () => {
    const i = await saved('before')
    detach()
    w.db.hold()
    updateIssue(i.id, { title: 'made meanwhile' })
    await drain()
    useData.setState({ ...EMPTY, me: person('ana') })
    const again = new FakeTarget(w.registry)
    again.apply([...w.db.tables.keys()].map((table): Incoming => ({ from: 'fetch', table, rows: w.db.rows(table) })))
    attach(again)
    expect(issue(i.id).title).toBe('made meanwhile')
    await w.settle()
    expect(w.db.get('issues', { id: i.id })?.title).toBe('made meanwhile')
    expect(pendingFields(again.live, 'issues', { id: i.id })).toEqual([])
  })
})

describe('a refused team delete', () => {
  /** the screen thinks ana is an admin; the database knows better */
  const staleAdmin = () => {
    useData.setState({ members: { ...useData.getState().members, ana: { role: 'admin', removedAt: null } } })
    w.db.get('workspace_members', { workspace_id: WS, profile_id: profileIdOf('ana') })!.role = 'member'
  }

  test('leaves the views as they were: their changes go only once the team is deleted', async () => {
    const v = createView({ name: 'Both', emoji: '👀', team: null, filters: { teams: ['DES', 'ENG'] }, display: { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true } })
    await w.settle()
    staleAdmin()
    const sent = w.since()
    expect(deleteTeam('DES')).toBe(true)
    expect(useData.getState().views[v.id].filters).toEqual({ teams: ['ENG'] })
    expect(pending()).toBeGreaterThan(1)
    await w.settle()
    expect(sent('views')).toEqual([])
    expect(w.db.get('views', { id: v.id })?.filters).toEqual({ teams: ['DES', 'ENG'] })
    expect(useData.getState().views[v.id].filters).toEqual({ teams: ['DES', 'ENG'] })
    expect(w.told).toEqual([MESSAGES.deleteTeam])
  })

  test('a "deleted meanwhile" about its issues is news again', async () => {
    const i = createIssue({ team: 'DES', title: 'In design' })
    await w.settle()
    staleAdmin()
    deleteTeam('DES')
    await w.settle()
    // a teammate deletes it now, and ana edits it
    w.db.t('issues').delete(i.id)
    updateIssue(i.id, { title: 'too late' })
    await w.settle()
    expect(w.told).toEqual([MESSAGES.deleteTeam, MESSAGES.goneIssue])
  })
})

describe('the queue, more', () => {
  test('notes that fail together are each sent again on their own', async () => {
    w.db.hold('answers')
    createIssue({ team: 'ENG', title: 'For bob', assignee: 'bob' })
    createIssue({ team: 'ENG', title: 'For cy', assignee: 'cy' })
    await drain()
    w.db.failNext('42501')
    const sent = w.since()
    await w.settle()
    expect(sent('inbox').map((r) => (r.kind === 'notes' ? r.rows.length : 0))).toEqual([2, 1, 1])
    expect(w.db.notesFor('bob')).toHaveLength(1)
    expect(w.db.notesFor('cy')).toHaveLength(1)
  })

  test(`at most ${IN_FLIGHT} requests on their way at once`, async () => {
    const ids: string[] = []
    for (let n = 0; n < 8; n++) ids.push((await saved(`n${n}`)).id)
    w.db.hold()
    const sent = w.since()
    ids.forEach((id, n) => updateIssue(id, { title: `t${n}`, priority: (n % 4) as 0 }))
    await drain()
    expect(sent()).toHaveLength(IN_FLIGHT)
    await w.settle()
    expect(sent()).toHaveLength(8)
    expect(pending()).toBe(0)
  })

  test('a delete takes the place of an edit still waiting', async () => {
    const i = await saved()
    w.db.hold()
    const sent = w.since()
    updateIssue(i.id, { title: 'on its way' })
    await drain()
    updateIssue(i.id, { priority: 2 })
    deleteIssue(i.id)
    await w.settle()
    expect(sent().map((r) => [r.kind, fieldsOf(r)])).toEqual([
      ['update', { title: 'on its way' }],
      ['delete', 'delete'],
    ])
    expect(w.db.get('issues', { id: i.id })).toBeUndefined()
  })

  test('archived right after being made: the archiving goes as its own update', async () => {
    const sent = w.since()
    const i = createIssue({ team: 'ENG', title: 'Made and put away' })
    archiveIssues([i.id])
    await w.settle()
    const [made, archived] = sent()
    expect([made.kind, archived.kind]).toEqual(['insert', 'update'])
    expect(made.kind === 'insert' && Object.keys(made.rows[0])).not.toContain('archived_at')
    expect(w.db.get('issues', { id: i.id })?.archived_at).toBeTruthy()
  })

  test('flush gives up at its limit; stop() answers a flush that waits', async () => {
    const i = await saved()
    w.db.hold()
    updateIssue(i.id, { title: 'held' })
    const limited = flush(500)
    await w.clock.advance(600)
    expect(await limited).toBe(1)
    const waiting = flush(60_000)
    stopWrites()
    expect(await waiting).toBe(1)
    w.db.release()
  })

  test('the sign-in ran out: tried again; something unexpected: undone and said', async () => {
    const i = await saved()
    w.db.failNext('auth')
    updateIssue(i.id, { title: 'after signing in' })
    await drain()
    expect(writesStatus().waiting).toBe(true)
    await w.clock.advance(1_200)
    expect(w.db.get('issues', { id: i.id })?.title).toBe('after signing in')
    w.db.failNext('bug')
    updateIssue(i.id, { title: 'never' })
    await w.settle()
    expect(issue(i.id).title).toBe('after signing in')
    expect(w.told).toEqual([MESSAGES.bug])
    expect(error).toHaveBeenCalled()
  })
})

describe('statuses', () => {
  const statuses = () => useData.getState().statuses

  test('a new issue starts in Todo’s default, or the default of the category asked for, or the status picked', async () => {
    expect(await saved('Plain')).toMatchObject({ status: 'todo', statusId: statusIdOf('todo') })
    const backlog = await saved('Later', { status: 'backlog' })
    expect(issue(backlog.id)).toMatchObject({ status: 'backlog', statusId: statusIdOf('backlog') })
    const sent = w.since()
    const done = await saved('Finished', { statusId: statusIdOf('done') })
    expect(issue(done.id)).toMatchObject({ status: 'done', statusId: statusIdOf('done') })
    expect(issue(done.id).completedAt).not.toBeNull()
    expect(sent('issues').map(fieldsOf)).toEqual([[expect.objectContaining({ status: 'done', status_id: statusIdOf('done') })]])
  })

  test('picking another status of the same category sends only the status; across categories, the category too', async () => {
    const testing = createStatus('issue', 'in_progress', 'Testing')!
    const released = createStatus('issue', 'done', 'Released')!
    await w.settle()
    const i = await saved('Moves')
    const sent = w.since()
    updateIssue(i.id, { statusId: testing.id })
    await w.settle()
    updateIssue(i.id, { statusId: statusIdOf('in_progress') })
    await w.settle()
    updateIssue(i.id, { statusId: statusIdOf('done') })
    await w.settle()
    const finished = issue(i.id).completedAt
    updateIssue(i.id, { statusId: released.id })
    // shown at once, completed_at kept: Done to Released, both done
    expect(issue(i.id)).toMatchObject({ status: 'done', statusId: released.id, completedAt: finished })
    await w.settle()
    expect(sent('issues').map(fieldsOf)).toEqual([
      { status: 'in_progress', status_id: testing.id },
      { status_id: statusIdOf('in_progress') },
      { status: 'done', status_id: statusIdOf('done') },
      { status_id: released.id },
    ])
    expect(issue(i.id)).toMatchObject({ status: 'done', statusId: released.id, completedAt: finished })
  })

  test('a category alone means its default; the category the issue has already changes nothing', async () => {
    const testing = createStatus('issue', 'in_progress', 'Testing')!
    await w.settle()
    const i = await saved('Category', { statusId: testing.id })
    const sent = w.since()
    updateIssue(i.id, { status: 'in_progress' })
    await w.settle()
    expect(sent('issues')).toEqual([])
    updateIssue(i.id, { status: 'in_review' })
    await w.settle()
    expect(sent('issues').map(fieldsOf)).toEqual([{ status: 'in_review', status_id: statusIdOf('in_review') }])
  })

  test('followers hear about a move within a category, with the status named', async () => {
    const testing = createStatus('issue', 'in_progress', 'Testing')!
    const i = await saved('Followed', { assignee: 'bob', status: 'in_progress' })
    updateIssue(i.id, { statusId: testing.id })
    await w.settle()
    expect(w.db.notesFor('bob').filter((n) => n.type === 'status')).toEqual([expect.objectContaining({ status: 'in_progress', status_id: testing.id })])
  })

  test('an issue moved into a status just made waits until the status is saved', async () => {
    const i = await saved('Waits')
    const sent = w.since()
    w.db.hold()
    const blocked = createStatus('issue', 'todo', 'Blocked')!
    updateIssue(i.id, { statusId: blocked.id })
    await drain()
    expect(sent().map((r) => (r.kind === 'insert' || r.kind === 'update' ? r.table : r.kind))).toEqual(['statuses'])
    await w.settle()
    expect(sent().map((r) => (r.kind === 'insert' || r.kind === 'update' ? r.table : r.kind))).toEqual(['statuses', 'issues'])
    expect(w.db.get('issues', { id: i.id })).toMatchObject({ status: 'todo', status_id: blocked.id })
  })

  test('add, rename, recolour, reorder and hide: only what changed is sent', async () => {
    const sent = w.since()
    const a = createStatus('issue', 'in_progress', ' Testing ')!
    expect(a).toMatchObject({ name: 'Testing', category: 'in_progress', color: '#f2c94c', hidden: false })
    const b = createStatus('issue', 'in_progress', 'Design review')!
    expect(a.position > statuses()[statusIdOf('in_progress')].position && b.position > a.position).toBe(true)
    await w.settle()
    updateStatus(a.id, { name: 'QA', color: '#BB87FC' })
    updateStatus(a.id, { name: 'QA', color: 'purple' })
    moveStatus(b.id, { prev: null, next: statusIdOf('in_progress') })
    updateStatus(a.id, { hidden: true })
    await w.settle()
    expect(sent('statuses').map(fieldsOf)).toEqual([
      [expect.objectContaining({ name: 'Testing', kind: 'issue', category: 'in_progress' }), expect.objectContaining({ name: 'Design review' })],
      { name: 'QA', color: '#bb87fc', hidden: true },
      { position: statuses()[b.id].position },
    ])
    expect(statuses()[b.id].position < statuses()[statusIdOf('in_progress')].position).toBe(true)
    expect(statuses()[a.id]).toMatchObject({ name: 'QA', hidden: true })
  })

  test('refused here: a taken name, an empty one, a category the kind lacks, hiding the last shown one', async () => {
    const sent = w.since()
    expect(createStatus('issue', 'todo', 'in progress')?.id).toBe(statusIdOf('in_progress'))
    expect(createStatus('issue', 'todo', '  ')).toBeUndefined()
    expect(createStatus('issue', 'planned', 'Planned')).toBeUndefined()
    updateStatus(statusIdOf('todo'), { name: 'Done' })
    updateStatus(statusIdOf('todo'), { hidden: true })
    await w.settle()
    expect(sent()).toEqual([])
  })

  test('refused by the database: a name a teammate took meanwhile, the last shown one hidden meanwhile', async () => {
    w.db.put('statuses', { id: 'teammates-qa', workspace_id: WS, kind: 'issue', category: 'in_review', name: 'QA', color: '#bb87fc', position: 'a1', hidden: false })
    const mine = createStatus('issue', 'in_progress', 'QA')!
    await w.settle()
    expect(statuses()[mine.id]).toBeUndefined()
    expect(w.told).toContain(MESSAGES.statusName)

    const second = createStatus('issue', 'canceled', 'Not now')!
    await w.settle()
    // a teammate hid the other one meanwhile
    w.db.put('statuses', { ...w.db.get('statuses', { id: statusIdOf('canceled') }), hidden: true })
    updateStatus(second.id, { hidden: true })
    await w.settle()
    expect(statuses()[second.id].hidden).toBe(false)
    expect(w.told).toContain("Each group needs at least one status that isn't hidden. Add or show another one first.")
  })
})

describe('checklist ticks', () => {
  const tick = (id: string, index: number, text: string) => setChecklistItem(id, { index, text, checked: true, before: issue(id).description })
  const stored = (id: string) => w.db.get('issues', { id })?.description

  test('a tick waits behind an edit of its issue still on its way, and goes on its own', async () => {
    const i = await saved('Ticks', { description: '- [ ] a\n- [ ] b' })
    w.db.hold()
    const sent = w.since()
    updateIssue(i.id, { description: '- [ ] a\n- [ ] b\n- [ ] c' })
    tick(i.id, 0, 'a')
    await w.settle()
    expect(sent().map((r) => r.kind)).toEqual(['update', 'call'])
    expect(stored(i.id)).toBe('- [x] a\n- [ ] b\n- [ ] c')
    nothingLeft(i.id)
  })

  test("a teammate's tick that landed first stays, and shows with yours", async () => {
    const i = await saved('Ticks', { description: '- [ ] a\n- [ ] b' })
    // saved, but not heard here yet
    w.db.put('issues', { ...w.db.get('issues', { id: i.id }), description: '- [ ] a\n- [x] b' })
    tick(i.id, 0, 'a')
    await w.settle()
    expect(stored(i.id)).toBe('- [x] a\n- [x] b')
    expect(issue(i.id).description).toBe('- [x] a\n- [x] b')
  })

  test('an item a teammate just reworded: the tick is undone, and the reason told once', async () => {
    const i = await saved('Ticks', { description: '- [ ] milk' })
    w.db.put('issues', { ...w.db.get('issues', { id: i.id }), description: '- [ ] oat milk' })
    tick(i.id, 0, 'milk')
    expect(issue(i.id).description).toBe('- [x] milk')
    await w.settle()
    expect(issue(i.id).description).toBe('- [ ] milk')
    expect(stored(i.id)).toBe('- [ ] oat milk')
    expect(w.told).toEqual([TICK_REFUSED])
    nothingLeft(i.id)
  })
})

describe('project statuses and places', () => {
  const project = (id: string) => useData.getState().projects[id]
  const made = async (name: string, statusId?: string) => {
    const p = createProject({ name, emoji: '📦', ...(statusId && { statusId }) })
    await w.settle()
    return p
  }

  test('a new project goes to the bottom of its column, sending its status and not the category', async () => {
    const sent = w.since()
    const first = await made('First')
    const second = await made('Second')
    const started = await made('Started', projectStatusIdOf('in_progress'))
    const rows = sent('projects').map(fieldsOf).flat() as Record<string, unknown>[]
    expect(rows.map((r) => [r.name, r.status_id, 'status' in r])).toEqual([
      ['First', projectStatusIdOf('planned'), false],
      ['Second', projectStatusIdOf('planned'), false],
      ['Started', projectStatusIdOf('in_progress'), false],
    ])
    expect(project(second.id).sortOrder! > project(first.id).sortOrder!).toBe(true)
    expect(project(started.id)).toMatchObject({ status: 'in_progress', statusId: projectStatusIdOf('in_progress') })
  })

  test('picking a status sends only status_id; the category shows at once', async () => {
    const building = createStatus('project', 'in_progress', 'Building')!
    const p = await made('Launch')
    const sent = w.since()
    updateProject(p.id, { statusId: building.id })
    expect(project(p.id)).toMatchObject({ status: 'in_progress', statusId: building.id })
    updateProject(p.id, { statusId: building.id })
    await w.settle()
    expect(sent('projects').map(fieldsOf)).toEqual([{ status_id: building.id }])
  })

  test('a drop within a column sends only the place; into another column, the status too', async () => {
    const a = await made('A')
    const b = await made('B')
    const waiting = await made('Waiting', projectStatusIdOf('paused'))
    const sent = w.since()
    moveProject(b.id, { place: { prev: null, next: a.id } })
    await w.settle()
    expect(sent('projects').map(fieldsOf)).toEqual([{ sort_order: project(b.id).sortOrder }])
    expect(project(b.id).sortOrder! < project(a.id).sortOrder!).toBe(true)
    moveProject(a.id, { statusId: projectStatusIdOf('paused'), place: { prev: waiting.id, next: null } })
    await w.settle()
    expect(Object.keys(sent('projects').map(fieldsOf)[1] as object).sort()).toEqual(['sort_order', 'status_id'])
    expect(project(a.id)).toMatchObject({ status: 'paused', statusId: projectStatusIdOf('paused') })
  })

  /** projects an older version made: a category, no place (the database gave them Planned's default status) */
  const older = (...names: string[]) => {
    for (const name of names) {
      const row = { id: name, workspace_id: WS, name, emoji: '', description: '', status: 'planned', status_id: projectStatusIdOf('planned'), sort_order: null, lead_id: null, target_date: null, linear_id: null, created_at: '2026-01-01T00:00:00.000Z', extra: {} }
      w.db.put('projects', row)
      w.target.apply([{ from: 'message', message: { table: 'projects', op: 'INSERT', row: w.db.get('projects', { id: name })! } }])
    }
  }

  test('a drop next to projects an older version made gives them places first, so it lands where it was let go', async () => {
    const mine = await made('Mine')
    older('Old one', 'Old two')
    const sent = w.since()
    moveProject(mine.id, { place: { prev: 'Old one', next: 'Old two' } })
    await w.settle()
    expect(sent('projects').map(fieldsOf).flat().map((f) => Object.keys(f as object))).toEqual([['sort_order'], ['sort_order'], ['sort_order']])
    const order = ['Old one', mine.id, 'Old two'].map((id) => project(id).sortOrder!)
    expect([...order].sort()).toEqual(order)
  })

  test('a new project goes below the ones an older version made, which get places in the same save', async () => {
    older('Old one')
    const sent = w.since()
    const p = await made('New')
    expect(sent('projects').length).toBe(2)
    expect(project('Old one').sortOrder! < project(p.id).sortOrder!).toBe(true)
  })

  test('nothing moves into a hidden status; within the hidden status a project has, it may', async () => {
    const hold = createStatus('project', 'paused', 'On hold')!
    const there = await made('There', hold.id)
    const other = await made('Other', hold.id)
    updateStatus(hold.id, { hidden: true })
    const p = await made('Elsewhere')
    const sent = w.since()
    moveProject(p.id, { statusId: hold.id, place: { prev: null, next: null } })
    updateProject(p.id, { statusId: hold.id })
    await w.settle()
    expect(sent('projects')).toEqual([])
    moveProject(other.id, { place: { prev: null, next: there.id } })
    await w.settle()
    expect(sent('projects').map(fieldsOf)).toEqual([{ sort_order: project(other.id).sortOrder }])
    expect(project(other.id).statusId).toBe(hold.id)
  })

  test('while the workspace’s statuses aren’t known, only the category goes', async () => {
    useData.setState({ statuses: {} })
    const sent = w.since()
    const p = await made('Early')
    updateProject(p.id, { statusId: 'paused' })
    await w.settle()
    expect(sent('projects').map(fieldsOf)).toEqual([[expect.objectContaining({ name: 'Early', status: 'planned' })], { status: 'paused' }])
    expect(sent('projects').map(fieldsOf).flat().some((r) => 'status_id' in (r as object))).toBe(false)
  })
})
