import { describe, expect, test } from 'bun:test'
import { afterKey, planFetch, sinceMark, tooLongAgo } from '@/backend/load'

describe('asking for rows by key', () => {
  test('single keys: one group per table', () => {
    expect(planFetch([
      { table: 'issues', key: { id: 'a' } },
      { table: 'profiles', key: { id: 'p' } },
      { table: 'issues', key: { id: 'b' } },
      { table: 'issues', key: { id: 'a' } },
    ])).toEqual([
      { table: 'issues', eq: {}, inCol: 'id', values: ['a', 'b'] },
      { table: 'profiles', eq: {}, inCol: 'id', values: ['p'] },
    ])
  })

  test('two key columns: grouped by the first', () => {
    expect(planFetch([
      { table: 'issue_labels', key: { issue_id: 'i1', label_id: 'l1' } },
      { table: 'issue_labels', key: { issue_id: 'i2', label_id: 'l1' } },
      { table: 'issue_labels', key: { issue_id: 'i1', label_id: 'l2' } },
    ])).toEqual([
      { table: 'issue_labels', eq: { issue_id: 'i1' }, inCol: 'label_id', values: ['l1', 'l2'] },
      { table: 'issue_labels', eq: { issue_id: 'i2' }, inCol: 'label_id', values: ['l1'] },
    ])
  })

  test('at most 100 values a request', () => {
    const groups = planFetch(Array.from({ length: 250 }, (_, n) => ({ table: 'comments' as const, key: { id: `c${n}` } })))
    expect(groups.map((g) => g.values.length)).toEqual([100, 100, 50])
    expect(groups[2].values[0]).toBe('c200')
  })
})

describe('reading page after page', () => {
  test('continues after the last key', () => {
    expect(afterKey('issues', { id: '01JX', title: 'x' })).toBe('id.gt.01JX')
    expect(afterKey('team_members', { team_id: 't1', profile_id: 'p9' })).toBe('team_id.gt.t1,and(team_id.eq.t1,profile_id.gt.p9)')
  })
})

describe('where catching up starts', () => {
  test('ten seconds before the mark, to the microsecond', () => {
    expect(sinceMark('2026-10-19T12:28:00.816096+00:00')).toBe('2026-10-19T12:27:50.816096Z')
    expect(sinceMark('2026-10-19T14:28:05.000001+02:00', 5)).toBe('2026-10-19T12:28:00.000001Z')
    expect(sinceMark('2026-10-19T00:00:03.5Z')).toBe('2026-10-18T23:59:53.500000Z')
  })

  test('an unreadable mark is kept as it is', () => {
    expect(sinceMark('soon')).toBe('soon')
  })

  test('deletions are kept 45 days, so last up to date further back, the workspace is read again', () => {
    const now = Date.parse('2026-12-01T00:00:00Z')
    expect(tooLongAgo(Date.parse('2026-11-30T00:00:00Z'), now)).toBe(false)
    expect(tooLongAgo(Date.parse('2026-10-17T23:59:59.999Z'), now)).toBe(true)
    expect(tooLongAgo(Date.parse('2026-10-18T00:00:00.001Z'), now)).toBe(false)
  })
})
