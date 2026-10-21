import { expect, test } from 'bun:test'
import { arrowMove } from '@/lib/arrows'

test('arrows move to the next or previous option, round at the ends; Home and End to the first and last', () => {
  expect(arrowMove('ArrowRight', 0, 3)).toBe(1)
  expect(arrowMove('ArrowDown', 2, 3)).toBe(0)
  expect(arrowMove('ArrowLeft', 0, 3)).toBe(2)
  expect(arrowMove('ArrowUp', 1, 3)).toBe(0)
  expect(arrowMove('Home', 2, 3)).toBe(0)
  expect(arrowMove('End', 0, 3)).toBe(2)
  expect(arrowMove('Enter', 0, 3)).toBeNull()
})
