import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { emptyLive, pendingFields, type Incoming } from '@/backend/apply'
import { chipState } from '@/backend/status'
import { attach, detach, flush, pending, stopWrites, writesStatus } from '@/backend/writes'
import { MESSAGES } from '@/backend/writes/problems'
import type { Request } from '@/backend/writes/send'
import {
  archiveIssues,
  createComment,
  createIssue,
  createLabel,
  createProject,
  deleteComment,
  deleteIssue,
  deleteProject,
  deleteTeam,
  markRead,
  moveIssueToTeam,
  updateComment,
  updateIssue,
} from '@/data/actions'
import { EMPTY, useData } from '@/data/store'
import { drain, FakeTarget, person, profileIdOf, seed, teamIdOf, WS, type World } from './support/fakeBackend'

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
/** requests sent from now on */
const from = () => {
  const n = w.db.log.length
  return (table?: string) => w.db.log.slice(n).filter((r) => !table || (r.kind === 'notes' ? 'inbox' : r.kind === 'call' ? 'issues' : r.table) === table)
}
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
    const sent = from()
    updateIssue(i.id, { title: 'a' })
    updateIssue(i.id, { priority: 2 })
    await w.settle()
    expect(sent('issues').map(fieldsOf)).toEqual([{ title: 'a', priority: 2 }])

    const more = from()
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
    const sent = from()
    updateIssue(i.id, { status: 'in_progress', title: 'Same' })
    await w.settle()
    expect(sent('issues').map(fieldsOf)).toEqual([{ status: 'in_progress' }])
  })
})

describe('order', () => {
  test("an issue's labels go once the issue is saved", async () => {
    const label = createLabel('Bug')
    await w.settle()
    w.db.hold()
    const sent = from()
    createIssue({ team: 'ENG', title: 'With a label', labels: [label.id] })
    await drain()
    expect(sent().map((r) => r.kind === 'insert' && r.table)).toEqual(['issues'])
    await w.settle()
    expect(sent().map((r) => (r.kind === 'insert' ? r.table : r.kind))).toEqual(['issues', 'issue_labels'])
    expect(w.db.rows('issue_labels')).toHaveLength(1)
  })

  test('an edit of an issue still being made waits for it', async () => {
    w.db.hold()
    const sent = from()
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
    const sent = from()
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
    const sent = from()
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
    const sent = from()
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
    const sent = from()
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
    expect(chipState({ online: false, channelsUp: false, signedIn: true, failing: false }, { pending: 1, waiting: true })).toBe('offline')
  })

  test('back online: tried again at once', async () => {
    const i = await saved()
    w.db.failNext('network')
    const sent = from()
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
    expect(w.told).toEqual([MESSAGES.gone])

    const b = await saved('b')
    w.db.hold()
    updateIssue(b.id, { title: 'on its way' })
    await drain()
    w.db.t('issues').delete(b.id)
    deleteIssue(b.id)
    await w.settle()
    expect(w.told).toEqual([MESSAGES.gone])
    expect(issue(b.id)).toBeUndefined()
    expect(pending()).toBe(0)
  })

  test('a label name that is taken: the label and the issue’s use of it go, with one message', async () => {
    const i = await saved()
    w.db.failNext('23505:labels_name')
    const sent = from()
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
    const sent = from()
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
    const sent = from()
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
    const sent = from()
    expect(archiveIssues([a.id, b.id, c.id])).toBe(3)
    expect(Object.keys(useData.getState().archive).sort()).toEqual([a.id, b.id, c.id].sort())
    await w.settle()
    const archived = sent('issues')
    expect(archived).toHaveLength(1)
    expect(archived[0].kind === 'update' && archived[0].keys).toHaveLength(3)

    const note = (id: string) => ({ id, workspace_id: WS, recipient_id: profileIdOf('ana'), actor_id: profileIdOf('bob'), type: 'assigned', issue_id: a.id, comment_id: null, status: null, at: '2026-10-19T10:00:00.000Z', read_at: null, extra: {} })
    for (const n of [note('n1'), note('n2')]) w.db.put('inbox', n)
    w.target.apply([{ from: 'fetch', table: 'inbox', rows: w.db.rows('inbox') }])
    const read = from()
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
