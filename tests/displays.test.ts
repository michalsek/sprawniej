import { describe, expect, test } from 'bun:test'
import { changedDisplay, DEFAULT_DISPLAY, fieldsFor, lockedFields, PROPERTY_DEFAULTS, propertiesOf, withProperty } from '@/data/displays'
import type { Display } from '@/model/schema'

const board: Display = { ...DEFAULT_DISPLAY, layout: 'board' }

describe('what rows and cards show', () => {
  test('without choices, lists and boards look as they always did', () => {
    expect(propertiesOf(DEFAULT_DISPLAY)).toEqual({ id: true, priority: true, assignee: true, labels: true, project: false, dueDate: true, estimate: true, created: true, progress: true })
    expect(propertiesOf(board)).toEqual({ ...PROPERTY_DEFAULTS.list, created: false })
  })

  test('a stored yes or no wins over the layout’s default, for list and board alike', () => {
    const properties = { project: true, created: true, labels: false }
    expect(propertiesOf({ ...DEFAULT_DISPLAY, properties })).toMatchObject({ project: true, created: true, labels: false, id: true })
    expect(propertiesOf({ ...board, properties })).toMatchObject({ project: true, created: true, labels: false, id: true })
  })

  test('anything but a yes or no, and keys this version doesn’t know, are left out', () => {
    expect(propertiesOf({ ...DEFAULT_DISPLAY, properties: { id: 'no', milestone: true, created: null } })).toEqual(PROPERTY_DEFAULTS.list)
    // a list where an object should be (written by hand, or by something else) counts as no choices
    expect(propertiesOf({ ...DEFAULT_DISPLAY, properties: ['id'] } as unknown as Display)).toEqual(PROPERTY_DEFAULTS.list)
  })

  test('switching one keeps the other choices, a newer version’s too', () => {
    const display = { ...DEFAULT_DISPLAY, properties: { labels: false, milestone: { at: 'top' } } }
    expect(withProperty(display, 'project', true)).toEqual({ properties: { labels: false, milestone: { at: 'top' }, project: true } })
    expect(withProperty(display, 'labels', true)).toEqual({ properties: { labels: true, milestone: { at: 'top' } } })
    expect(withProperty(DEFAULT_DISPLAY, 'created', false)).toEqual({ properties: { created: false } })
  })

  test('a saved view’s display after a change keeps what a newer version added, at the top and in its choices', () => {
    const display = { ...DEFAULT_DISPLAY, future: 1, properties: { milestone: true } }
    expect(changedDisplay(display, withProperty(display, 'project', true))).toEqual({ ...DEFAULT_DISPLAY, future: 1, properties: { milestone: true, project: true } })
    expect(changedDisplay(display, { grouping: 'priority' })).toEqual({ ...display, grouping: 'priority' })
  })
})

describe('what a page locks', () => {
  test('a project’s page: no Project switch, and rows never show the project', () => {
    expect(lockedFields({ projects: ['p1'] })).toEqual(['project'])
    expect(fieldsFor({ ...DEFAULT_DISPLAY, properties: { project: true } }, ['project'])).toMatchObject({ project: false, id: true })
  })

  test('other pages lock nothing: a team, several projects, or “no project”', () => {
    for (const filters of [{}, { projects: [] }, { projects: ['p1', 'p2'] }, { projects: [null] }]) expect(lockedFields(filters)).toEqual([])
    expect(fieldsFor({ ...DEFAULT_DISPLAY, properties: { project: true } }, [])).toMatchObject({ project: true })
  })
})
