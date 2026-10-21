import { expect, test } from 'bun:test'
import { arrowMove } from '@/lib/arrows'

test('← and → move to the previous or next option, round at the ends; Home and End to the first and last', () => {
  expect(arrowMove('ArrowRight', 0, 3)).toBe(1)
  expect(arrowMove('ArrowRight', 2, 3)).toBe(0)
  expect(arrowMove('ArrowLeft', 0, 3)).toBe(2)
  expect(arrowMove('Home', 2, 3)).toBe(0)
  expect(arrowMove('End', 0, 3)).toBe(2)
})

test('↑ and ↓ stay with the issue list, and other keys do nothing', () => {
  expect(arrowMove('ArrowDown', 0, 3)).toBeNull()
  expect(arrowMove('ArrowUp', 1, 3)).toBeNull()
  expect(arrowMove('Enter', 0, 3)).toBeNull()
})
