import { describe, expect, test } from 'bun:test'
import { dayName, dueTone } from '@/features/issues/format'
import { estimateItems } from '@/features/issues/pickers'
import { dayPlus, isDay } from '@/lib/days'

describe('due dates', () => {
  test('names and tones', () => {
    expect(dayName('2026-10-07', '2026-10-07')).toBe('Today')
    expect(dayName('2026-10-08', '2026-10-07')).toBe('Tomorrow')
    expect(dayName('2026-10-06', '2026-10-07')).toBe('Yesterday')
    expect(dayName('2026-11-01', '2026-10-07')).toBe('Nov 1')
    expect(dueTone('2026-10-06', '2026-10-07')).toBe('overdue')
    expect(dueTone('2026-10-09', '2026-10-07')).toBe('soon')
    expect(dueTone('2026-10-10', '2026-10-07')).toBe('later')
    // across a month end
    expect(dayName('2026-11-01', '2026-10-31')).toBe('Tomorrow')
  })
  test('an imported estimate outside the usual ones is offered', () => {
    expect(estimateItems(null).map((i) => i.value)).toEqual([null, 1, 2, 3, 5, 8])
    expect(estimateItems(21).map((i) => i.value)).toEqual([null, 1, 2, 3, 5, 8, 21])
  })
  test('plain days: only real ones, moved by the calendar', () => {
    expect(['2026-10-31', '2028-02-29'].every(isDay)).toBe(true)
    expect(['2026-02-30', '2026-13-45', '2026-1-05', '2026-10-31T00:00', 20261031].some(isDay)).toBe(false)
    expect(dayPlus('2026-10-31', 1)).toBe('2026-11-01')
    expect(dayPlus('2026-03-01', -1)).toBe('2026-02-28')
    expect(dayPlus('2026-12-31', 1)).toBe('2027-01-01')
  })
})
