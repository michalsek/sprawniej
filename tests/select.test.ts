import { describe, expect, test } from 'bun:test'
import { generateKeyBetween } from 'fractional-indexing'
import { projectStatusIdOf, sampleData, sampleProjectStatuses, statusIdOf } from './fixtures/sample'
import { childIndex, compareIssues, dueForArchive, myTeamKeys, groupIssues, inTab, isUnread, monthsBefore, nestChildren, projectColumns, projectCountsIndex, progressOf, progressPercent, issuesIn } from '@/data/select'
import { findByRef, issueRef } from '@/data/store'
import { matcher, treeOf, type MatchContext } from '@/data/filterTree'
import { DEFAULT_DISPLAY } from '@/data/displays'
import type { Filters, Issue, Project, Status } from '@/model/schema'
import { issueFieldsSchema } from '@/model/schema'

const data = sampleData()
const issues = Object.values(data.issues)
const ctx = { people: data.people, projects: data.projects }

describe('sample data', () => {
  test('every issue fits the issue schema', () => {
    for (const i of issues) expect(issueFieldsSchema.safeParse(i).success).toBe(true)
  })
  test('numbers count up per team', () => {
    expect(issues.filter((i) => i.team === 'DES').map((i) => i.number)).toEqual([1, 2, 3])
  })
})

describe('refs', () => {
  test('ENG-1 round trip, any case', () => {
    const first = issues[0]
    expect(issueRef(first)).toBe('ENG-1')
    expect(findByRef(data.issues, 'eng-1')?.id).toBe(first.id)
    expect(findByRef(data.issues, 'ENG-999')).toBeUndefined()
    expect(findByRef(data.issues, 'nonsense')).toBeUndefined()
    expect(findByRef(data.issues, 'ENGINEERS-1')).toBeUndefined()
    expect(findByRef(data.issues, 'ENG-01')?.id).toBe(first.id)
  })
  test('an old number finds the issue that moved, unless an issue has that number now', () => {
    const [a, b] = issues.filter((i) => i.team === 'ENG')
    const moved = { ...a, team: 'DES', number: 99, formerRefs: [issueRef(a), issueRef(b)] }
    const now = { ...data.issues, [a.id]: moved }
    expect(findByRef(now, issueRef(a))?.id).toBe(a.id)
    expect(findByRef(now, issueRef(b))?.id).toBe(b.id)
    expect(findByRef(now, 'DES-99')?.id).toBe(a.id)
    // the next version of the issues gets its own lookup
    const gone = { ...now }
    delete gone[b.id]
    expect(findByRef(gone, issueRef(b))?.id).toBe(a.id)
  })
})

test('a priority this version doesn’t know sorts last', () => {
  const [a, b] = issues
  const odd = { ...a, priority: 7 as Issue['priority'] }
  const sorted = [odd, { ...b, priority: 4 as Issue['priority'] }].sort(compareIssues('priority'))
  expect(sorted.map((i) => i.id)).toEqual([b.id, a.id])
})

/** one issue against stored filters */
const matches = (issue: Issue, f: Filters, c?: MatchContext) => matcher(treeOf(f), c)(issue)

describe('filters and tabs', () => {
  test('empty filters match everything', () => {
    expect(issues.every((i) => matches(i, {}))).toBe(true)
  })
  test('subscribers: anyone following the issue (made it, assigned, commented, subscribed), unless they unsubscribed', () => {
    const one = issues.find((i) => i.assignee && i.createdBy !== i.assignee)!
    const follow = { comments: { [one.id]: [{ id: 'c', issue: one.id, author: 'zed', createdAt: 'x', body: 'hi' }] }, people: { ...data.people, zed: { login: 'zed', githubId: 9, name: 'Zed', avatarUrl: '' } } }
    expect(matches(one, { subscribers: [one.assignee!] }, follow)).toBe(true)
    expect(matches(one, { subscribers: [one.createdBy] }, follow)).toBe(true)
    expect(matches(one, { subscribers: ['zed'] }, follow)).toBe(true)
    expect(matches({ ...one, subscribers: ['ghost'] }, { subscribers: ['ghost'] }, follow)).toBe(false) // not in the workspace
    expect(matches({ ...one, unsubscribed: ['zed'] }, { subscribers: ['zed'] }, follow)).toBe(false)
    expect(matches(one, { subscribers: ['nobody'] }, follow)).toBe(false)
  })
  test('Active is Todo, In Progress and In Review only', () => {
    const active = issues.filter((i) => inTab(i, 'active'))
    expect(new Set(active.map((i) => i.status))).toEqual(new Set(['todo', 'in_progress', 'in_review']))
  })
})

describe('grouping', () => {
  test('status groups follow Linear order and include empty ones', () => {
    const groups = groupIssues(issues, DEFAULT_DISPLAY, ctx, 'all')
    expect(groups.map((g) => g.key)).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate'])
    expect(groups.find((g) => g.key === 'duplicate')!.issues).toEqual([])
  })
  test('showCompleted off hides closed groups and issues', () => {
    const groups = groupIssues(issues, { ...DEFAULT_DISPLAY, showCompleted: false }, ctx, 'all')
    expect(groups.map((g) => g.key)).toEqual(['backlog', 'todo', 'in_progress', 'in_review'])
  })
  test('priority groups: urgent first, no priority last', () => {
    const groups = groupIssues(issues, { ...DEFAULT_DISPLAY, grouping: 'priority' }, ctx)
    expect(groups.map((g) => g.value)).toEqual([1, 2, 3, 4, 0])
  })
  test('assignee groups end with No assignee', () => {
    const groups = groupIssues(issues, { ...DEFAULT_DISPLAY, grouping: 'assignee' }, ctx)
    expect(groups.at(-1)!.title).toBe('No assignee')
    expect(groups.reduce((n, g) => n + g.issues.length, 0)).toBe(issues.length)
  })
  test('a board gets every status; the ones the tab leaves out are empty and marked outside', () => {
    const active = issues.filter((i) => inTab(i, 'active'))
    const groups = groupIssues(active, DEFAULT_DISPLAY, ctx, 'active', true)
    expect(groups.map((g) => g.key)).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate'])
    expect(groups.filter((g) => g.outside).map((g) => g.key)).toEqual(['backlog', 'done', 'canceled', 'duplicate'])
    expect(groups.filter((g) => g.outside).every((g) => g.issues.length === 0)).toBe(true)
    const off = groupIssues(issues, { ...DEFAULT_DISPLAY, showCompleted: false }, ctx, 'all', true)
    expect(off.filter((g) => g.outside).map((g) => g.key)).toEqual(['done', 'canceled', 'duplicate'])
  })
  test('a board grouped by person offers everyone, by project only open projects of the team', () => {
    const one = issues.filter((i) => i.assignee).slice(0, 1)
    const people = groupIssues(one, { ...DEFAULT_DISPLAY, grouping: 'assignee' }, ctx, 'all', true)
    expect(people.length).toBe(Object.keys(data.people).length + 1)
    const projects = groupIssues([], { ...DEFAULT_DISPLAY, grouping: 'project' }, { ...ctx, team: 'ENG' }, 'all', true)
    const open = Object.values(data.projects).filter((p) => !['completed', 'canceled'].includes(p.status) && (!p.teams.length || p.teams.includes('ENG')))
    expect(projects.length).toBe(open.length + 1)
  })
  test('by the workspace’s statuses: one group each, in its order; a hidden one only while issues here have it', () => {
    const statuses = {
      ...data.statuses,
      testing: { id: 'testing', kind: 'issue' as const, category: 'in_progress', name: 'Testing', color: '#bb87fc', position: 'a1', hidden: false },
      parked: { id: 'parked', kind: 'issue' as const, category: 'todo', name: 'Parked', color: '#95a2b3', position: 'a1', hidden: true },
    }
    const withStatuses = { ...ctx, statuses }
    const keys = (gs: { key: string }[]) => gs.map((g) => g.key)
    const groups = groupIssues(issues, DEFAULT_DISPLAY, withStatuses, 'all')
    expect(keys(groups)).toEqual(['backlog', 'todo', 'in_progress', 'testing', 'in_review', 'done', 'canceled', 'duplicate'].map((k) => (k === 'testing' ? k : statusIdOf(k))))
    expect(groups.find((g) => g.key === 'testing')).toMatchObject({ title: 'Testing', value: 'testing', issues: [] })
    // an issue in the hidden status brings its group; one whose status isn't known goes with its category's default
    const parked = { ...issues[4], status: 'todo' as const, statusId: 'parked' }
    const unknown = { ...issues[7], status: 'todo' as const, statusId: 'not-here-yet' }
    const now = groupIssues([parked, unknown], DEFAULT_DISPLAY, withStatuses, 'all')
    expect(keys(now)).toContain('parked')
    expect(now.find((g) => g.key === 'parked')!.issues.map((i) => i.id)).toEqual([parked.id])
    expect(now.find((g) => g.key === statusIdOf('todo'))!.issues.map((i) => i.id)).toEqual([unknown.id])
    // a board on Active: statuses of the other categories are places to drop, marked outside
    const board = groupIssues(issues.filter((i) => inTab(i, 'active')), DEFAULT_DISPLAY, withStatuses, 'active', true)
    expect(board.filter((g) => !g.outside).map((g) => g.title)).toEqual(['Todo', 'In Progress', 'Testing', 'In Review'])
    expect(board.filter((g) => g.outside).map((g) => g.title)).toEqual(['Backlog', 'Done', 'Canceled', 'Duplicate'])
  })
  test('the Status filter reads the workspace’s statuses: a refinement narrows its own category', () => {
    const follow = { comments: {}, people: data.people, statuses: { ...data.statuses, testing: { id: 'testing', kind: 'issue' as const, category: 'in_progress', name: 'Testing', color: '#bb87fc', position: 'a1', hidden: false } } }
    const inProgress = issues.filter((i) => i.status === 'in_progress')
    const testing = { ...inProgress[0], statusId: 'testing' }
    expect(matches(testing, { statuses: ['in_progress'] }, follow)).toBe(true)
    expect(matches(testing, { statuses: ['in_progress'], statusIds: [statusIdOf('in_progress')] }, follow)).toBe(false)
    expect(matches(inProgress[1], { statuses: ['in_progress'], statusIds: [statusIdOf('in_progress')] }, follow)).toBe(true)
  })
  test('manual order uses plain string order of sortOrder', () => {
    const a = issues[0]
    const moved: Issue = { ...issues[5], status: a.status, sortOrder: generateKeyBetween(null, a.sortOrder) }
    const groups = groupIssues([a, moved], DEFAULT_DISPLAY, ctx)
    expect(groups.find((g) => g.key === a.status)!.issues.map((i) => i.id)).toEqual([moved.id, a.id])
  })
})

describe('sub-issues', () => {
  test('children sit right under their parent', () => {
    const inReview = issues.filter((i) => i.status === 'in_review')
    const rows = nestChildren(inReview)
    const parentAt = rows.findIndex((r) => r.issue.id === 'sample-01')
    expect(rows[parentAt + 1]).toEqual({ issue: data.issues['sample-02'], depth: 1 })
  })
  test('a parent loop does not hang or drop issues', () => {
    const a: Issue = { ...issues[0], id: 'a', parent: 'b' }
    const b: Issue = { ...issues[1], id: 'b', parent: 'a' }
    expect(nestChildren([a, b]).length).toBe(2)
  })
  test('counter counts done children', () => {
    expect(childIndex(data.issues).get('sample-01')).toEqual({ done: 1, total: 4 })
    expect(childIndex(data.issues).get('sample-02')).toBeUndefined()
  })
  test('counters are built once per version of the issues', () => {
    expect(childIndex(data.issues)).toBe(childIndex(data.issues))
    expect(childIndex({ ...data.issues })).not.toBe(childIndex(data.issues))
  })
  test('project progress leaves canceled out', () => {
    const p = progressOf(projectCountsIndex(data.issues, {}).get('p-insights')!)
    expect(p.total).toBe(6)
    expect(p.done).toBe(1)
  })
})

describe('project counts', () => {
  const mk = (id: string, status: string, project: string | null = 'p') => ({ ...issues[0], id, status, project }) as Issue
  const record = (list: Issue[]) => Object.fromEntries(list.map((i) => [i.id, i]))

  test('each category counts on its own; canceled and duplicate ones are left out of progress, not of the issues', () => {
    const active = record([mk('a', 'done'), mk('b', 'done'), mk('c', 'in_progress'), mk('d', 'todo'), mk('e', 'canceled'), mk('f', 'duplicate'), mk('g', 'backlog', null)])
    const c = projectCountsIndex(active, {}).get('p')!
    expect(c).toMatchObject({ done: 2, in_progress: 1, todo: 1, canceled: 1, duplicate: 1, backlog: 0, archived: 0 })
    expect(progressOf(c)).toEqual({ done: 2, total: 4, canceled: 2 })
    expect(issuesIn(c)).toBe(6)
    // an issue without a project counts nowhere
    expect(projectCountsIndex(active, {}).size).toBe(1)
  })

  test('archived issues count too, once, and a category this app does not know counts as Backlog', () => {
    const active = record([mk('a', 'done'), mk('b', 'someday')])
    const archive = record([mk('a', 'done'), mk('x', 'done'), mk('y', 'done'), mk('z', 'canceled')])
    const c = projectCountsIndex(active, archive).get('p')!
    expect(c).toMatchObject({ done: 3, backlog: 1, canceled: 1, archived: 2 })
    expect(progressOf(c)).toEqual({ done: 3, total: 4, canceled: 1 })
  })

  test('built once per version of the issues and the archive', () => {
    const archive = {}
    expect(projectCountsIndex(data.issues, archive)).toBe(projectCountsIndex(data.issues, archive))
    expect(projectCountsIndex(data.issues, {})).not.toBe(projectCountsIndex(data.issues, archive))
    expect(projectCountsIndex({ ...data.issues }, archive)).not.toBe(projectCountsIndex(data.issues, archive))
  })

  test('percent rounds down, but never to 0% once something is done or 100% before everything is', () => {
    expect(progressPercent(0, 0)).toBe(0)
    expect(progressPercent(0, 5)).toBe(0)
    expect(progressPercent(1, 200)).toBe(1)
    expect(progressPercent(199, 200)).toBe(99)
    expect(progressPercent(8, 12)).toBe(66)
    expect(progressPercent(1, 2)).toBe(50)
    expect(progressPercent(12, 12)).toBe(100)
  })
})

describe('due dates', () => {
  test('ordering by due date: soonest first, none last', () => {
    const [a, b, c] = issues.slice(0, 3)
    const list = [{ ...a, dueDate: null }, { ...b, dueDate: '2026-12-01' }, { ...c, dueDate: '2026-11-01' }]
    const groups = groupIssues(list, { ...DEFAULT_DISPLAY, grouping: 'none', ordering: 'due' }, ctx)
    expect(groups[0].issues.map((i) => i.id)).toEqual([c.id, b.id, a.id])
  })
})

describe('archiving finished issues', () => {
  const done = { ...issues[0], status: 'done', completedAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z' } as Issue
  test('a day the month doesn’t have becomes its last', () => {
    expect(monthsBefore('2026-08-31T12:00:00.000Z', 6)).toBe('2026-02-28T12:00:00.000Z')
    expect(monthsBefore('2028-08-31T12:00:00.000Z', 6)).toBe('2028-02-29T12:00:00.000Z')
    expect(monthsBefore(Date.parse('2026-10-07T00:00:00.000Z'), 13)).toBe('2025-09-07T00:00:00.000Z')
  })
  test('finished and untouched for that long', () => {
    expect(dueForArchive(done, 6, '2026-08-01T00:00:00.000Z')).toBe(true)
    expect(dueForArchive(done, 6, '2026-07-01T00:00:00.000Z')).toBe(false)
    // 0 months: the team never archives by itself
    expect(dueForArchive(done, 0, '2030-01-01T00:00:00.000Z')).toBe(false)
    // changed after it was finished: counted from the change
    expect(dueForArchive({ ...done, updatedAt: '2026-05-01T00:00:00.000Z' }, 6, '2026-08-01T00:00:00.000Z')).toBe(false)
    // not finished
    expect(dueForArchive({ ...done, status: 'todo', completedAt: null }, 6, '2030-01-01T00:00:00.000Z')).toBe(false)
  })
})

describe('inbox', () => {
  test('a note read one by one stays read, even when it is newer than "read until"', () => {
    const n = { id: 'n1', at: '2026-10-19T12:00:00.000Z' }
    const r = { readUntil: '2026-10-01T00:00:00.000Z' }
    expect(isUnread(n, r)).toBe(true)
    expect(isUnread({ ...n, readAt: '2026-10-19T12:05:00.000Z' }, r)).toBe(false)
    expect(isUnread({ ...n, readAt: null }, r)).toBe(true)
  })
})

test('your teams, oldest first, whatever order they were loaded in', () => {
  const team = (key: string, createdAt: string, members: string[]) => ({ key, name: key, emoji: '', members, createdAt })
  const teams = {
    WEB: team('WEB', '2026-10-03T00:00:00.000Z', ['ana']),
    OPS: team('OPS', '2026-10-01T00:00:00.000Z', ['bob']),
    ENG: team('ENG', '2026-10-02T00:00:00.000Z', ['ana']),
    APP: team('APP', '2026-10-02T00:00:00.000Z', ['ana']),
  }
  const ana = { login: 'ana', githubId: 0, name: 'Ana', avatarUrl: '' }
  expect(myTeamKeys({ teams, me: ana })).toEqual(['APP', 'ENG', 'WEB'])
  expect(myTeamKeys({ teams, me: null })).toEqual(['OPS', 'APP', 'ENG', 'WEB'])
})

describe('the project board', () => {
  const st = (id: string, category: string, position: string, hidden = false): Status => ({ id, kind: 'project', category, name: id, color: '#bb87fc', position, hidden })
  const statuses = {
    ...sampleProjectStatuses(),
    building: st('building', 'in_progress', 'a1'),
    'on-hold': st('on-hold', 'paused', 'a1', true),
    shelved: st('shelved', 'completed', 'a1', true),
  }
  const p = (id: string, status: Project['status'], statusId: string, sortOrder: string | null = null): Project =>
    ({ id, name: id, emoji: '', description: '', status, statusId, sortOrder, lead: null, teams: [], targetDate: null, createdAt: '2026-01-01T00:00:00.000Z' })

  test('a column per shown status in their order, then hidden ones that still have projects; inside, by place, then by name', () => {
    const columns = projectColumns(
      [
        p('second', 'planned', projectStatusIdOf('planned'), 'a1'),
        p('first', 'planned', projectStatusIdOf('planned'), 'a0'),
        p('Zed (older version)', 'planned', projectStatusIdOf('planned')),
        p('Alpha (older version)', 'planned', projectStatusIdOf('planned')),
        p('waiting', 'paused', 'on-hold', 'a0'),
        p('not known yet', 'in_progress', 'st-from-a-newer-copy', 'a0'),
        p('built', 'in_progress', 'building', 'a0'),
      ],
      statuses,
    )
    expect(columns.map((c) => [c.status.id, c.projects.map((x) => x.id)])).toEqual([
      [projectStatusIdOf('backlog'), []],
      [projectStatusIdOf('planned'), ['first', 'second', 'Alpha (older version)', 'Zed (older version)']],
      [projectStatusIdOf('in_progress'), ['not known yet']],
      ['building', ['built']],
      [projectStatusIdOf('paused'), []],
      [projectStatusIdOf('completed'), []],
      [projectStatusIdOf('canceled'), []],
      ['on-hold', ['waiting']],
    ])
  })
})
