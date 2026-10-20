import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { stopWrites } from '@/backend/writes'
import { createComment, createIssue, deleteComment, setFollowers, subscribe, deleteInboxItems, markAllRead, markRead, updateComment, updateIssue } from '@/data/actions'
import { linkReferences, mentionedLogins, newMentions } from '@/data/mentions'
import { followLists, followers, issueNotes } from '@/data/notify'
import { isUnread } from '@/data/select'
import { useData } from '@/data/store'
import type { Issue, Person } from '@/model/schema'
import { person, profileIdOf, seed, WS, type World } from './support/fakeBackend'

const people = { ana: person('ana'), bob: person('bob'), cy: person('cy') }

let w: World
beforeEach(() => {
  w = seed({ me: 'ana', people: ['bob', 'cy'], teams: [{ key: 'ENG', name: 'Engineering', members: ['ana'] }] })
})
afterEach(() => stopWrites())

describe('people from Linear who haven’t joined', () => {
  test('follow and can be assigned, but get no inbox notes', () => {
    const guest: Person = { login: '~jan', githubId: 0, name: 'Jan', avatarUrl: '' }
    const all = { ...people, '~jan': guest }
    const issue = { id: 'i', team: 'ENG', number: 1, title: 't', description: '', status: 'todo', statusId: 's-todo', priority: 0, assignee: '~jan', labels: [], project: null, parent: null, sortOrder: 'a0', createdBy: 'ana', createdAt: 'x', updatedAt: 'x', completedAt: null } as Issue
    expect(followers(issue, [], all)).toContain('~jan')
    expect(issueNotes(null, issue, 'bob', all)).toEqual([]) // assigned, but has no inbox
  })
})

describe('mentions', () => {
  test('only people in the workspace, not in code or e-mail addresses', () => {
    expect(mentionedLogins('hi @bob and @nobody, mail me@cy.dev, `@cy` and\n```\n@cy\n```', people)).toEqual(['bob'])
  })
  test('new mentions are the ones that were not there before', () => {
    expect(newMentions('@bob', '@bob @cy', people)).toEqual(['cy'])
  })
  test('by the handle someone has now, case aside; a handle they moved off is plain text', () => {
    const renamed = { ...people, bob: { ...people.bob, handle: 'robert' } }
    expect(mentionedLogins('hi @Robert', renamed)).toEqual(['bob'])
    expect(mentionedLogins('hi @bob', renamed)).toEqual([])
    expect(mentionedLogins('hi @BOB and @Cy', people)).toEqual(['bob', 'cy'])
    expect(newMentions('@bob', '@robert', renamed)).toEqual(['bob'])
    expect(newMentions('@robert', '@ROBERT thanks', renamed)).toEqual([])
  })
  test('someone may take a handle another person moved off', () => {
    const swapped = { ...people, bob: { ...people.bob, handle: 'robert' }, cy: { ...people.cy, handle: 'bob' } }
    expect(mentionedLogins('@bob', swapped)).toEqual(['cy'])
  })
})

describe('notes', () => {
  const base: Issue = {
    id: 'i1', team: 'ENG', number: 1, title: 't', description: '', status: 'todo', statusId: 's-todo', priority: 0, assignee: null, labels: [],
    project: null, parent: null, sortOrder: 'a0', createdBy: 'bob', createdAt: '', updatedAt: '',
  }
  test('assigning someone tells them, assigning yourself tells nobody', () => {
    expect(issueNotes(base, { ...base, assignee: 'cy' }, 'ana', people)).toEqual([{ to: 'cy', type: 'assigned' }])
    expect(issueNotes(base, { ...base, assignee: 'ana' }, 'ana', people)).toEqual([])
  })
  test('a status change tells the followers once, never the person who made it', () => {
    expect(issueNotes({ ...base, assignee: 'bob' }, { ...base, assignee: 'bob', status: 'done', statusId: 's-done' }, 'ana', people)).toEqual([{ to: 'bob', type: 'status', status: 'done', statusId: 's-done' }])
    expect(issueNotes(base, { ...base, status: 'in_progress', statusId: 's-progress' }, 'ana', people)).toEqual([{ to: 'bob', type: 'status', status: 'in_progress', statusId: 's-progress' }])
    expect(issueNotes(base, { ...base, status: 'in_progress', statusId: 's-progress' }, 'bob', people)).toEqual([])
  })
  test('a move to another status of the same category is a status change too, naming the status', () => {
    expect(issueNotes(base, { ...base, statusId: 's-ready' }, 'ana', people)).toEqual([{ to: 'bob', type: 'status', status: 'todo', statusId: 's-ready' }])
    // a status not known yet: only the category (the database takes the issue's own)
    expect(issueNotes(base, { ...base, status: 'done', statusId: '' }, 'ana', people)).toEqual([{ to: 'bob', type: 'status', status: 'done' }])
  })
  test('followers: creator, assignee, commenters and mentioned people, plus subscribers, minus unsubscribed', () => {
    const c = { id: 'c1', issue: 'i1', author: 'cy', createdAt: '', body: 'ask @ana' }
    expect(followers(base, [c], people).sort()).toEqual(['ana', 'bob', 'cy'])
    expect(followers({ ...base, unsubscribed: ['bob'], subscribers: ['nobody'] }, [], people)).toEqual([])
    expect(followers({ ...base, subscribers: ['cy'] }, [], people).sort()).toEqual(['bob', 'cy'])
  })
  test('followLists keeps the lists short', () => {
    expect(followLists(base, [], people, ['bob'])).toEqual({ subscribers: [], unsubscribed: [] })
    expect(followLists(base, [], people, ['cy'])).toEqual({ subscribers: ['cy'], unsubscribed: ['bob'] })
  })
  test('moving to a new assignee tells them once (assigned), not twice', () => {
    const notes = issueNotes(base, { ...base, assignee: 'cy', status: 'in_progress', statusId: 's-progress' }, 'ana', people)
    expect(notes).toEqual([{ to: 'cy', type: 'assigned' }, { to: 'bob', type: 'status', status: 'in_progress', statusId: 's-progress' }])
  })
})

describe('inbox', () => {
  const types = (login: string) => w.db.notesFor(login).map((n) => n.type)

  test('a comment tells the creator, the assignee and earlier commenters, and mentions come first', async () => {
    const i = createIssue({ team: 'ENG', title: 'Bug', assignee: 'bob' })
    await w.settle()
    expect(types('bob')).toEqual(['assigned'])
    useData.setState({ me: people.cy })
    createComment(i.id, 'Seen it, @bob')
    await w.settle()
    useData.setState({ me: people.ana })
    createComment(i.id, 'Thanks')
    await w.settle()
    expect(types('cy')).toEqual(['commented'])
    expect(types('bob').sort()).toEqual(['assigned', 'commented', 'mentioned'])
    expect(types('ana')).toEqual(['commented']) // cy's comment on ana's issue
  })

  test('unsubscribing stops comment and status notes; subscribing starts them', async () => {
    const i = createIssue({ team: 'ENG', title: 'Bug', assignee: 'bob' })
    await w.settle()
    useData.setState({ me: people.bob })
    subscribe(i.id, false)
    await w.settle()
    expect(useData.getState().issues[i.id].unsubscribed).toEqual(['bob'])
    useData.setState({ me: people.cy })
    subscribe(i.id, true)
    await w.settle()
    useData.setState({ me: people.ana })
    createComment(i.id, 'Any news?')
    updateIssue(i.id, { status: 'in_progress' })
    await w.settle()
    expect(types('bob')).toEqual(['assigned'])
    expect(types('cy').sort()).toEqual(['commented', 'status'])
    const before = useData.getState().issues[i.id].updatedAt
    setFollowers(i.id, ['ana'])
    await w.settle()
    const after = useData.getState().issues[i.id]
    expect(after.updatedAt).toBe(before)
    expect(after.unsubscribed).toEqual(['bob'])
    expect(after.subscribers).toBeUndefined()
  })

  test('the same mention again within minutes: the database keeps one note', async () => {
    const i = createIssue({ team: 'ENG', title: 'Bug' })
    updateIssue(i.id, { description: 'ask @bob' })
    await w.settle()
    updateIssue(i.id, { description: 'ask' })
    await w.settle()
    updateIssue(i.id, { description: 'ask @bob' })
    await w.settle()
    // the app sends both; check_note drops the second (tests/db/comments-inbox.test.ts checks the real one)
    expect(w.db.log.filter((r) => r.kind === 'notes')).toHaveLength(2)
    expect(types('bob')).toEqual(['mentioned'])
  })

  test('editing a comment tells only newly mentioned people; deleting it takes its notes away', async () => {
    const i = createIssue({ team: 'ENG', title: 'Bug' })
    const c = createComment(i.id, 'hi @bob')!
    await w.settle()
    updateComment(i.id, c.id, 'hi @bob and @cy')
    await w.settle()
    expect(w.db.notesFor('bob')).toHaveLength(1)
    expect(w.db.notesFor('cy')).toHaveLength(1)
    expect(useData.getState().comments[i.id][0].editedAt).toBeTruthy()
    deleteComment(i.id, c.id)
    expect(useData.getState().comments[i.id]).toBeUndefined()
    await w.settle()
    expect(w.db.rows('inbox')).toHaveLength(0)
  })

  const note = (id: string, at: string) => ({ id, workspace_id: WS, recipient_id: profileIdOf('ana'), actor_id: profileIdOf('bob'), type: 'assigned', issue_id: 'x', comment_id: null, status: null, at, read_at: null, extra: {} })

  test('read marks: one at a time, all at once, and deleting read notes', async () => {
    for (const n of [note('n1', '2026-10-01T00:00:00.000Z'), note('n2', '2026-10-02T00:00:00.000Z')]) w.db.put('inbox', n)
    w.target.apply([{ from: 'fetch', table: 'inbox', rows: w.db.rows('inbox') }])
    const unread = () => useData.getState().inbox.filter((n) => isUnread(n, useData.getState().readState)).map((n) => n.id)
    markRead(['n1'])
    expect(unread()).toEqual(['n2'])
    await w.settle()
    expect(w.db.get('inbox', { id: 'n1' })?.read_at).toBeTruthy()
    deleteInboxItems(undefined, { readOnly: true })
    expect(useData.getState().inbox.map((n) => n.id)).toEqual(['n2'])
    await w.settle()
    expect(w.db.get('inbox', { id: 'n1' })).toBeUndefined()
    markAllRead()
    expect(unread()).toEqual([])
    await w.settle()
    expect(w.db.get('read_state', { profile_id: profileIdOf('ana'), workspace_id: WS })?.read_until).toBe('2026-10-02T00:00:00.000Z')
    expect(useData.getState().readState.readUntil).toBe('2026-10-02T00:00:00.000Z')
  })
})

describe('sub-issues', () => {
  test('a new sub-issue goes under its siblings, not to the top of the team', () => {
    const parent = createIssue({ team: 'ENG', title: 'Parent' })
    const other = createIssue({ team: 'ENG', title: 'Newer' })
    const a = createIssue({ team: 'ENG', title: 'A', parent: parent.id })
    const b = createIssue({ team: 'ENG', title: 'B', parent: parent.id })
    const order = Object.values(useData.getState().issues).sort((x, y) => (x.sortOrder < y.sortOrder ? -1 : 1)).map((i) => i.title)
    expect(order).toEqual([other.title, parent.title, a.title, b.title])
  })
})

describe('linkReferences', () => {
  test('links people and issues, not code or links', () => {
    const md = 'ping @bob about ENG-1 and ENG-9, `@bob ENG-1`, [ENG-1](https://x.dev) https://x.dev/@bob'
    expect(linkReferences(md, people, (r) => r === 'ENG-1')).toBe(
      'ping [@bob](#@bob) about [ENG-1](#/issue/ENG-1) and ENG-9, `@bob ENG-1`, [ENG-1](https://x.dev) https://x.dev/@bob',
    )
  })
  test('links a handle someone has now to their login, as typed; an old one stays plain', () => {
    const renamed = { ...people, bob: { ...people.bob, handle: 'robert' } }
    expect(linkReferences('@Robert and @bob', renamed, () => false)).toBe('[@Robert](#@bob) and @bob')
  })
})
