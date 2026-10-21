import { describe, expect, test } from 'bun:test'
import { DEFAULT_DISPLAY, PROPERTY_DEFAULTS, propertiesOf, withProperty } from '@/data/displays'
import { targetsFor } from '@/features/issues/selection'
import { DISPLAY_PROPERTIES, type Display } from '@/model/schema'

const board: Display = { ...DEFAULT_DISPLAY, layout: 'board' }

describe('what rows and cards show', () => {
  test('without choices, lists and boards look as they always did', () => {
    expect(propertiesOf(DEFAULT_DISPLAY)).toEqual({ id: true, priority: true, assignee: true, labels: true, project: false, dueDate: true, estimate: true, created: true, progress: true })
    expect(propertiesOf(board)).toEqual({ ...PROPERTY_DEFAULTS.list, created: false })
    expect(Object.keys(PROPERTY_DEFAULTS.list).sort()).toEqual([...DISPLAY_PROPERTIES].sort())
  })

  test('a stored yes or no wins over the layout’s default, for list and board alike', () => {
    const properties = { project: true, created: true, labels: false }
    expect(propertiesOf({ ...DEFAULT_DISPLAY, properties })).toMatchObject({ project: true, created: true, labels: false, id: true })
    expect(propertiesOf({ ...board, properties })).toMatchObject({ project: true, created: true, labels: false, id: true })
  })

  test('anything but a yes or no, and keys this version doesn’t know, are left out', () => {
    const odd = { ...DEFAULT_DISPLAY, properties: { id: 'no', milestone: true, created: null } } as unknown as Display
    const shown = propertiesOf(odd)
    expect(shown).toEqual(PROPERTY_DEFAULTS.list)
    expect('milestone' in shown).toBe(false)
    // a list where an object should be (written by hand, or by something else) counts as no choices
    expect(propertiesOf({ ...DEFAULT_DISPLAY, properties: ['id'] } as unknown as Display)).toEqual(PROPERTY_DEFAULTS.list)
  })

  test('switching one keeps the other choices, a newer version’s too', () => {
    const display = { ...DEFAULT_DISPLAY, properties: { labels: false, milestone: true } }
    expect(withProperty(display, 'project', true)).toEqual({ properties: { labels: false, milestone: true, project: true } })
    expect(withProperty(display, 'labels', true)).toEqual({ properties: { labels: true, milestone: true } })
    expect(withProperty(DEFAULT_DISPLAY, 'created', false)).toEqual({ properties: { created: false } })
  })
})

describe('who a change from one row is for', () => {
  test('just that issue when nothing else is picked', () => {
    expect(targetsFor('a', [])).toEqual(['a'])
    expect(targetsFor('a', ['a'])).toEqual(['a'])
  })

  test('every picked issue when this one is among several picked', () => {
    expect(targetsFor('b', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  test('only this one when others are picked but it isn’t', () => {
    expect(targetsFor('d', ['a', 'b', 'c'])).toEqual(['d'])
  })
})
