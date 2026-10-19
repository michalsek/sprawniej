import { describe, expect, test } from 'bun:test'
import { generateKeyBetween } from 'fractional-indexing'
import { changedOnly, groupPatch, keyBetween, neighbours } from '@/data/ordering'
import { sampleData } from './fixtures/sample'

const issue = Object.values(sampleData().issues)[0]

describe('dropping an issue', () => {
  test('lands between its neighbours', () => {
    const a = generateKeyBetween(null, null)
    const b = generateKeyBetween(a, null)
    const k = keyBetween(a, b)
    expect(a < k && k < b).toBe(true)
    expect(keyBetween(null, a) < a).toBe(true)
    expect(keyBetween(b, null) > b).toBe(true)
  })
  test('neighbours with the same key do not break it', () => {
    const a = generateKeyBetween(null, null)
    expect(keyBetween(a, a) > a).toBe(true)
  })
  test('many drops in the same spot keep working', () => {
    let lo = generateKeyBetween(null, null)
    const hi = generateKeyBetween(lo, null)
    for (let i = 0; i < 200; i++) {
      const k = keyBetween(lo, hi)
      expect(lo < k && k < hi).toBe(true)
      lo = k
    }
  })
  test('the group it lands in sets the property', () => {
    expect(groupPatch('status', 'done')).toEqual({ status: 'done' })
    expect(groupPatch('priority', 1)).toEqual({ priority: 1 })
    expect(groupPatch('assignee', null)).toEqual({ assignee: null })
    expect(groupPatch('project', 'p1')).toEqual({ project: 'p1' })
    expect(groupPatch('none', null)).toEqual({})
  })
  test('only real changes are kept', () => {
    expect(changedOnly(issue, { status: issue.status, priority: issue.priority === 1 ? 2 : 1 })).toEqual({ priority: issue.priority === 1 ? 2 : 1 })
  })
  test('neighbours skip rows at another level', () => {
    // P has children c1, c2; X is top-level; moved M dropped right after c2
    const level = (id: string) => (id.startsWith('c') ? 'P' : null)
    expect(neighbours(['P', 'c1', 'c2', 'M', 'X'], 'M', level)).toEqual({ prev: 'P', next: 'X' })
    expect(neighbours(['M', 'P'], 'M', level)).toEqual({ prev: null, next: 'P' })
    expect(neighbours(['P', 'c1', 'c2'], 'c1', level)).toEqual({ prev: null, next: 'c2' })
  })
})
