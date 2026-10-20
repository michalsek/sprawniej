import { describe, expect, test } from 'bun:test'
import { AT_CREATION_MS, historySignature, issueEvents, mergeFetched, type EventRow, type HistoryContext } from '@/data/history'
import type { ArchivedIssue, Issue } from '@/model/schema'

const START = Date.parse('2026-10-01T10:00:00.000Z')
const at = (minute: number) => new Date(START + minute * 60_000).toISOString()
const row = (id: number, minute: number, actor: string | null, changes: unknown): EventRow => ({ id, actorId: actor, at: at(minute), changes })
const logins: Record<string, string> = { pa: 'ana', pb: 'bob', pg: '~gina' }
const login = (id: string) => logins[id]
const ctx: HistoryContext = { login, createdBy: 'ana', createdAt: at(0) }
const kinds = (rows: EventRow[], c: HistoryContext = ctx) => issueEvents(rows, c).map((e) => e.change.kind)

describe('issue history', () => {
  test('a change that came through a pull request says which one; a link elsewhere is left out', () => {
    const pr = { repo: 'acme/web', number: 12, url: 'https://github.com/acme/web/pull/12' }
    const [line] = issueEvents([row(1, 1, 'pb', { status: ['in_progress', 'in_review'], via: { pullRequest: pr } })], ctx)
    expect(line).toEqual({ id: 1, at: at(1), by: 'bob', change: { kind: 'status', from: { category: 'in_progress' }, to: { category: 'in_review' } }, via: pr })
    const elsewhere = { pullRequest: { ...pr, url: 'https://evil.example/pull/12' } }
    expect(issueEvents([row(1, 1, 'pb', { status: ['todo', 'done'], via: elsewhere })], ctx)[0].via).toBeUndefined()
    // folded into the same person's change a moment before, it keeps the pull request
    const folded = issueEvents([row(1, 1, 'pb', { status: ['todo', 'in_progress'] }), row(2, 1.5, 'pb', { status: ['in_progress', 'in_review'], via: { pullRequest: pr } })], ctx)
    expect(folded).toEqual([{ id: 1, at: at(1.5), by: 'bob', change: { kind: 'status', from: { category: 'todo' }, to: { category: 'in_review' } }, via: pr }])
  })

  test('statuses: the status and, when the category changed, the category; older events have only the category', () => {
    const change = (changes: unknown) => issueEvents([row(1, 1, 'pa', changes)], ctx)[0]?.change
    expect(change({ status: ['todo', 'in_progress'], statusId: ['s-todo', 's-testing'] })).toEqual({ kind: 'status', from: { id: 's-todo', category: 'todo' }, to: { id: 's-testing', category: 'in_progress' } })
    expect(change({ statusId: ['s-testing', 's-progress'] })).toEqual({ kind: 'status', from: { id: 's-testing' }, to: { id: 's-progress' } })
    expect(change({ status: ['todo', 'done'] })).toEqual({ kind: 'status', from: { category: 'todo' }, to: { category: 'done' } })
    // something unreadable is left out
    expect(change({ statusId: [1, 2] })).toBeUndefined()
  })

  test('status moves fold by status: there and back within a category leaves nothing', () => {
    const lines = (rows: EventRow[]) => issueEvents(rows, ctx).map((e) => e.change)
    expect(lines([row(1, 1, 'pa', { statusId: ['s-progress', 's-testing'] }), row(2, 1.5, 'pa', { statusId: ['s-testing', 's-progress'] })])).toEqual([])
    expect(lines([row(1, 1, 'pa', { status: ['todo', 'in_progress'], statusId: ['s-todo', 's-progress'] }), row(2, 1.5, 'pa', { statusId: ['s-progress', 's-testing'] })])).toEqual([
      { kind: 'status', from: { id: 's-todo', category: 'todo' }, to: { id: 's-testing' } },
    ])
    // an old line (only the category) and a new one compare by category
    expect(lines([row(1, 1, 'pa', { status: ['todo', 'done'] }), row(2, 1.5, 'pa', { status: ['done', 'todo'], statusId: ['s-done', 's-todo'] })])).toEqual([])
  })

  test('one line per field, in the order the page shows them, whatever order they were stored in', () => {
    expect(kinds([row(1, 5, 'pa', { status: ['todo', 'done'], title: ['A', 'B'], team: ['ENG-3', 'DES-7'] })])).toEqual(['team', 'title', 'status'])
  })

  test('the same person changing a field twice in a row reads as one change', () => {
    const folded = issueEvents([row(1, 1, 'pa', { status: ['todo', 'in_progress'] }), row(2, 2, 'pa', { status: ['in_progress', 'done'] })], ctx)
    expect(folded).toEqual([{ id: 1, at: at(2), by: 'ana', change: { kind: 'status', from: { category: 'todo' }, to: { category: 'done' } } }])
    const apart = issueEvents([row(1, 1, 'pa', { status: ['todo', 'in_progress'] }), row(2, 4, 'pa', { status: ['in_progress', 'done'] })], ctx)
    expect(apart).toHaveLength(2)
  })

  test('typing a title over a few saves is one rename', () => {
    const events = issueEvents([row(1, 1, 'pa', { title: ['A', 'Ab'] }), row(2, 6, 'pa', { title: ['Ab', 'Abc'] }), row(3, 14, 'pa', { title: ['Abc', 'Abcd'] })], ctx)
    expect(events.map((e) => e.change)).toEqual([{ kind: 'title', from: 'A', to: 'Abcd' }])
  })

  test('there and back again leaves nothing; someone else in between keeps every line', () => {
    expect(kinds([row(1, 1, 'pa', { status: ['todo', 'done'] }), row(2, 1.5, 'pa', { status: ['done', 'todo'] })])).toEqual([])
    const kept = issueEvents(
      [row(1, 1, 'pa', { status: ['todo', 'done'] }), row(2, 1.2, 'pb', { priority: [0, 1] }), row(3, 1.5, 'pa', { status: ['done', 'todo'] })],
      ctx,
    )
    expect(kept.map((e) => [e.by, e.change.kind])).toEqual([
      ['ana', 'status'],
      ['bob', 'priority'],
      ['ana', 'status'],
    ])
  })

  test('labels on and off again leave nothing; two labels one after the other are one line', () => {
    expect(kinds([row(1, 5, 'pa', { labels: { added: ['L1'] } }), row(2, 6, 'pa', { labels: { removed: ['L1'] } })])).toEqual([])
    const two = issueEvents([row(1, 5, 'pa', { labels: { added: ['L1'] } }), row(2, 6, 'pa', { labels: { added: ['L2'] } })], ctx)
    expect(two.map((e) => e.change)).toEqual([{ kind: 'labels', added: ['L1', 'L2'], removed: [] }])
  })

  test('moves between teams', () => {
    expect(issueEvents([row(1, 5, 'pa', { team: ['ENG-3', 'DES-7'] })], ctx)[0].change).toEqual({ kind: 'team', from: 'ENG-3', to: 'DES-7' })
    expect(issueEvents([row(1, 5, 'pa', { team: [null, 'DES-7'] })], ctx)[0].change).toEqual({ kind: 'team', from: null, to: 'DES-7' })
  })

  test('archived and restored are two lines, never folded', () => {
    expect(kinds([row(1, 5, 'pa', { archived: true }), row(2, 5.5, 'pa', { restored: true })])).toEqual(['archived', 'restored'])
    expect(kinds([row(1, 5, 'pa', { archived: true }), row(2, 5.5, 'pa', { archived: true })])).toEqual(['archived', 'archived'])
  })

  test('archived by the nightly tidy-up: nobody did it', () => {
    expect(issueEvents([row(1, 5, null, { archived: true })], ctx)).toEqual([{ id: 1, at: at(5), by: null, change: { kind: 'archived' } }])
  })

  test('guests show by their login; ids nobody knows stay as they are', () => {
    expect(issueEvents([row(1, 5, 'pb', { assignee: [null, 'pg'] })], ctx)[0]).toMatchObject({ by: 'bob', change: { kind: 'assignee', from: null, to: '~gina' } })
    const odd = issueEvents([row(1, 5, 'px', { assignee: ['py', null] })], ctx)[0]
    expect(odd).toMatchObject({ by: 'px', change: { kind: 'assignee', from: 'py', to: null } })
  })

  test('labels put on while creating the issue are part of creating it', () => {
    const soon = START + 2_000
    const r = (actor: string, ms: number, changes: unknown, id = 1): EventRow => ({ id, actorId: actor, at: new Date(ms).toISOString(), changes })
    expect(kinds([r('pa', soon, { labels: { added: ['L1'] } })])).toEqual([])
    expect(kinds([r('pa', START + AT_CREATION_MS + 1, { labels: { added: ['L1'] } })])).toEqual(['labels'])
    expect(kinds([r('pb', soon, { labels: { added: ['L1'] } })])).toEqual(['labels'])
    expect(kinds([r('pa', soon, { labels: { added: ['L1'] } }), r('pa', soon, { status: ['todo', 'done'] }, 2)])).toEqual(['status'])
    expect(issueEvents([r('pa', soon, { labels: { added: ['L1'], removed: ['L2'] } })], ctx)[0].change).toEqual({ kind: 'labels', added: [], removed: ['L2'] })
    expect(kinds([r('pa', soon, { labels: { added: ['L1'] } })], { login })).toEqual(['labels'])
  })

  test('anything it cannot read is left out', () => {
    const rows = [
      row(1, 1, 'pa', { status: ['todo', 'blocked'] }),
      row(2, 5, 'pa', { priority: [0, 9] }),
      row(3, 10, 'pa', { title: 'x' }),
      row(4, 15, 'pa', null),
      row(5, 20, 'pa', { foo: 1 }),
      row(6, 25, 'pa', { estimate: [null, '3'] }),
      row(7, 30, 'pa', { dueDate: [null, '2026-10-31'] }),
      row(8, 35, 'pa', { dueDate: [null, 'soon'] }),
      row(9, 40, 'pa', { labels: { added: [1] } }),
      row(10, 45, 'pa', [1, 2]),
    ]
    expect(issueEvents(rows, ctx).map((e) => e.change)).toEqual([
      { kind: 'estimate', from: null, to: 3 },
      { kind: 'dueDate', from: null, to: '2026-10-31' },
    ])
  })

  test('the order they were saved in decides, not their times', () => {
    const events = issueEvents([row(3, 1, 'pa', { priority: [0, 2] }), row(1, 9, 'pb', { title: ['A', 'B'] }), row(2, 5, 'pa', { status: ['todo', 'done'] })], ctx)
    expect(events.map((e) => e.id)).toEqual([1, 2, 3])
  })

  test('editing the description over a while is one line', () => {
    expect(kinds([row(1, 1, 'pa', { description: true }), row(2, 5, 'pa', { description: true }), row(3, 12, 'pa', { description: true })])).toEqual(['description'])
  })
})

describe('when the history has something new', () => {
  const issue: Issue = {
    id: 'i1', team: 'ENG', number: 3, title: 'Charts', description: 'Old', status: 'todo', statusId: 's-todo', priority: 0, assignee: null, labels: ['a', 'b'],
    project: null, parent: null, sortOrder: 'a0', createdBy: 'ana', createdAt: at(0), updatedAt: at(0),
  }
  const sig = historySignature(issue)

  test('every saved change of the issue moves "last changed"; labels and archiving count on their own', () => {
    // as the database sends them: a new title, a move, a restore, even a new place in the list come with a new time
    expect(historySignature({ ...issue, title: 'New', updatedAt: at(1) })).not.toBe(sig)
    expect(historySignature({ ...issue, sortOrder: 'b0', updatedAt: at(2) })).not.toBe(sig)
    expect(historySignature({ ...issue, labels: ['a'] })).not.toBe(sig)
    const archived: ArchivedIssue = { ...issue, archivedAt: at(5), archivedBy: 'ana', comments: [] }
    expect(historySignature(archived)).not.toBe(sig)
  })

  test('not for following, nor for the order of labels', () => {
    expect(historySignature({ ...issue, subscribers: ['bob'], unsubscribed: ['cy'] })).toBe(sig)
    expect(historySignature({ ...issue, labels: ['b', 'a'] })).toBe(sig)
  })
})

describe('events read in several goes', () => {
  const e = (id: number) => row(id, id, 'pa', { description: true })

  test('each event once, oldest first, whatever order the answers came in', () => {
    const first = mergeFetched(undefined, [e(1), e(2)], { sig: 's1', asked: 1 })
    const next = mergeFetched(first, [e(3), e(2)], { sig: 's2', asked: 2 })
    expect(next).toEqual({ rows: [e(1), e(2), e(3)], sig: 's2', asked: 2 })
  })

  test('an older ask answered last adds its events but keeps the newer signature', () => {
    const newer = mergeFetched(undefined, [e(1), e(3)], { sig: 'new', asked: 5 })
    expect(mergeFetched(newer, [e(2)], { sig: 'old', asked: 4 })).toEqual({ rows: [e(1), e(2), e(3)], sig: 'new', asked: 5 })
  })

  test('read from the start: what was read before goes (a person linked meanwhile has new events)', () => {
    const before = mergeFetched(undefined, [e(1), e(2)], { sig: 's', asked: 1 })
    expect(mergeFetched(before, [e(2)], { sig: 's', asked: 2 }, true).rows).toEqual([e(2)])
  })
})
