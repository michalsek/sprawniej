import { expect, test } from 'bun:test'
import { guarded } from '@/lib/storage'

test('storage switched off: reads give nothing and writes do nothing, without throwing', () => {
  const off = guarded(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  })
  expect(off.getItem('k')).toBeNull()
  expect(() => off.setItem('k', 'v')).not.toThrow()
  expect(() => off.removeItem('k')).not.toThrow()
  expect(off.keys()).toEqual([])
})

test('a full store refuses a write quietly; the rest works as usual', () => {
  const kept = new Map<string, string>([['a', '1']])
  const store = {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    },
    removeItem: (k: string) => void kept.delete(k),
  }
  const s = guarded(() => Object.assign(Object.create(null) as Storage, store, { a: '1' }))
  expect(s.getItem('a')).toBe('1')
  expect(() => s.setItem('b', '2')).not.toThrow()
  s.removeItem('a')
  expect(kept.has('a')).toBe(false)
})
