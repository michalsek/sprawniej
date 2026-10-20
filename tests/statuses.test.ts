import { describe, expect, test } from 'bun:test'
import { canHide, CATEGORY_STATUSES, defaultStatus, issueStatuses, matchesStatus, pickedStatusIds, pickStatus, PROJECT_CATEGORY_STATUSES, statusesOf, statusFilter, statusNamed, statusOfIssue, statusOfProject } from '@/data/statuses'
import type { Status } from '@/model/schema'
import { paintColor } from '@/model/status'
import { sampleStatuses, statusIdOf } from './fixtures/sample'

const s = (id: string, category: string, name: string, position = 'a0', more: Partial<Status> = {}): Status => ({ id, kind: 'issue', category, name, color: '#bb87fc', position, hidden: false, ...more })
const by = (...list: Status[]) => Object.fromEntries(list.map((x) => [x.id, x]))

/** the seven, plus Testing after In Progress, a hidden Released after Done, and a project status */
const statuses = {
  ...sampleStatuses(),
  ...by(s('testing', 'in_progress', 'Testing', 'a1'), s('released', 'done', 'Released', 'a1', { hidden: true }), s('p-planned', 'planned', 'Planned', 'a0', { kind: 'project' })),
}
const ids = (list: Status[]) => list.map((x) => x.id)

describe('the order statuses show in', () => {
  test('category order, then position, then id; one kind at a time', () => {
    expect(ids(statusesOf(statuses, 'issue'))).toEqual([
      statusIdOf('backlog'),
      statusIdOf('todo'),
      statusIdOf('in_progress'),
      'testing',
      statusIdOf('in_review'),
      statusIdOf('done'),
      'released',
      statusIdOf('canceled'),
      statusIdOf('duplicate'),
    ])
    expect(ids(statusesOf(statuses, 'project'))).toEqual(['p-planned'])
    // positions compare byte by byte, and the same position falls back to the id
    const tie = by(s('b-second', 'todo', 'B', 'a0'), s('a-first', 'todo', 'A', 'a0'), s('upper', 'todo', 'U', 'Zz'))
    expect(ids(statusesOf(tie, 'issue'))).toEqual(['upper', 'a-first', 'b-second'])
  })

  test('without the workspace’s statuses, one made up per category, the id being the category', () => {
    expect(ids(issueStatuses({}))).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'duplicate'])
  })
})

describe('the default status of a category', () => {
  test('the first shown one', () => {
    expect(defaultStatus(statuses, 'issue', 'in_progress')?.id).toBe(statusIdOf('in_progress'))
    const hidden = { ...statuses, [statusIdOf('done')]: { ...statuses[statusIdOf('done')], hidden: true }, released: { ...statuses.released, hidden: false } }
    expect(defaultStatus(hidden, 'issue', 'done')?.id).toBe('released')
    expect(defaultStatus({}, 'issue', 'done')).toBeUndefined()
  })

  test('an issue shows its own status; one not known yet shows its category’s default, or the category itself', () => {
    expect(statusOfIssue({ status: 'in_progress', statusId: 'testing' }, statuses).name).toBe('Testing')
    // a hidden status still shows on the issues that have it
    expect(statusOfIssue({ status: 'done', statusId: 'released' }, statuses).name).toBe('Released')
    expect(statusOfIssue({ status: 'in_progress', statusId: 'not-here-yet' }, statuses).id).toBe(statusIdOf('in_progress'))
    // a status of another category than the issue's (a guess on its way) doesn't count
    expect(statusOfIssue({ status: 'todo', statusId: 'testing' }, statuses).id).toBe(statusIdOf('todo'))
    expect(statusOfIssue({ status: 'todo', statusId: '' }, {})).toBe(CATEGORY_STATUSES[1])
  })

  test('a project shows its own status; one of another group (a guess on its way, or an issue status) doesn’t count', () => {
    expect(statusOfProject({ status: 'planned', statusId: 'p-planned' }, statuses).id).toBe('p-planned')
    expect(statusOfProject({ status: 'paused', statusId: 'p-planned' }, statuses)).toBe(PROJECT_CATEGORY_STATUSES[3])
    expect(statusOfProject({ status: 'planned', statusId: statusIdOf('todo') }, statuses).id).toBe('p-planned')
  })

  test('picking: a status, or a category (its default), or nothing that is either', () => {
    expect(pickStatus('testing', statuses)).toEqual({ statusId: 'testing', status: 'in_progress' })
    expect(pickStatus('done', statuses)).toEqual({ statusId: statusIdOf('done'), status: 'done' })
    expect(pickStatus('done', {})).toEqual({ status: 'done' })
    expect(pickStatus('p-planned', statuses)).toBeUndefined()
    expect(pickStatus('nonsense', statuses)).toBeUndefined()
  })
})

describe('hiding and naming', () => {
  test('a category keeps a shown status', () => {
    expect(canHide(statuses.testing, statuses)).toBe(true)
    expect(canHide(statuses[statusIdOf('in_progress')], statuses)).toBe(true)
    expect(canHide(statuses[statusIdOf('done')], statuses)).toBe(false)
    expect(canHide(statuses[statusIdOf('todo')], statuses)).toBe(false)
  })

  test('names are compared without case, within a kind', () => {
    expect(statusNamed(statuses, 'issue', '  testing ')?.id).toBe('testing')
    expect(statusNamed(statuses, 'issue', 'Testing', 'testing')).toBeUndefined()
    expect(statusNamed(statuses, 'issue', 'planned')).toBeUndefined()
    expect(statusNamed(statuses, 'project', 'planned')?.id).toBe('p-planned')
  })
})

test('a status that keeps its category’s starting colour is painted in the theme’s colour; any other in its own', () => {
  expect(paintColor(statuses[statusIdOf('todo')])).toBe('var(--status-todo)')
  const shaded = (hex: string) => `color-mix(in oklab, ${hex}, var(--status-shade))`
  expect(paintColor({ ...statuses[statusIdOf('todo')], color: '#eb5757' })).toBe(shaded('#eb5757'))
  // another category's starting colour is just a colour
  expect(paintColor({ ...statuses[statusIdOf('todo')], color: '#5e6ad2' })).toBe(shaded('#5e6ad2'))
  expect(paintColor(statuses.testing)).toBe(shaded('#bb87fc'))
  // a theme colour stays as it is
  expect(paintColor({ category: 'todo', color: 'var(--status-todo)' })).toBe('var(--status-todo)')
  // project statuses too: Paused starts in the grey Canceled has
  expect(paintColor({ kind: 'project', category: 'paused', color: '#8a8f98' })).toBe('var(--status-canceled)')
})

describe('the Status filter', () => {
  const issue = (status: 'in_progress' | 'todo', statusId: string) => ({ status, statusId })

  test('categories alone: any status of them, statuses added later too', () => {
    const f = { statuses: ['in_progress' as const] }
    expect(matchesStatus(issue('in_progress', 'testing'), f, statuses)).toBe(true)
    expect(matchesStatus(issue('in_progress', statusIdOf('in_progress')), f, statuses)).toBe(true)
    expect(matchesStatus(issue('todo', statusIdOf('todo')), f, statuses)).toBe(false)
    expect(matchesStatus(issue('todo', statusIdOf('todo')), {}, statuses)).toBe(true)
  })

  test('a refinement narrows only its own category; alone it means nothing', () => {
    const f = { statuses: ['todo' as const, 'in_progress' as const], statusIds: ['testing'] }
    expect(matchesStatus(issue('in_progress', 'testing'), f, statuses)).toBe(true)
    expect(matchesStatus(issue('in_progress', statusIdOf('in_progress')), f, statuses)).toBe(false)
    expect(matchesStatus(issue('todo', statusIdOf('todo')), f, statuses)).toBe(true)
    expect(matchesStatus(issue('todo', statusIdOf('todo')), { statusIds: ['testing'] }, statuses)).toBe(true)
    // without the statuses known, only the categories count (older versions do the same)
    expect(matchesStatus(issue('in_progress', statusIdOf('in_progress')), f, {})).toBe(true)
  })

  test('picked statuses and the filter they make, both ways', () => {
    // every shown status of a category: the whole category
    expect(statusFilter([statusIdOf('in_progress'), 'testing'], statuses)).toEqual({ statuses: ['in_progress'], statusIds: undefined })
    // some of one: the category, refined
    expect(statusFilter(['testing', statusIdOf('todo')], statuses)).toEqual({ statuses: ['todo', 'in_progress'], statusIds: ['testing'] })
    // hidden ones count: the filter lists them ticked, so unticking one keeps the rest
    expect(statusFilter([statusIdOf('done'), 'released'], statuses)).toEqual({ statuses: ['done'], statusIds: undefined })
    expect(statusFilter([statusIdOf('done')], statuses)).toEqual({ statuses: ['done'], statusIds: [statusIdOf('done')] })
    expect(statusFilter(['released'], statuses)).toEqual({ statuses: ['done'], statusIds: ['released'] })
    expect(statusFilter([], statuses)).toEqual({ statuses: undefined, statusIds: undefined })

    expect(pickedStatusIds({ statuses: ['in_progress'] }, statuses)).toEqual([statusIdOf('in_progress'), 'testing'])
    expect(pickedStatusIds({ statuses: ['todo', 'in_progress'], statusIds: ['testing'] }, statuses)).toEqual([statusIdOf('todo'), 'testing'])
    expect(pickedStatusIds({ statusIds: ['testing'] }, statuses)).toEqual([])
    for (const picked of [['testing'], [statusIdOf('todo'), statusIdOf('in_progress'), 'testing'], ['released', statusIdOf('backlog')], [statusIdOf('done')]]) {
      expect(pickedStatusIds(statusFilter(picked, statuses), statuses).sort()).toEqual([...picked].sort())
    }
  })
})
