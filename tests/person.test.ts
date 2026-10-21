import { expect, test } from 'bun:test'
import { personColor, sameName } from '@/lib/person'
import { plainName } from '@/lib/plain'
import { ratio } from './support/colour'

test('names that probably match', () => {
  expect(sameName('Darek Smith', { login: 'darekk', name: 'Darek Smith' })).toBe(true)
  expect(sameName('Łukasz Bąk', { login: 'lb', name: 'Lukasz Bak' })).toBe(true)
  expect(sameName('Darek', { login: 'darek' })).toBe(true)
  expect(sameName('Darek Smith', { login: 'darekk', name: null })).toBe(false)
  expect(sameName('Darek', { login: 'dk', handle: 'darek' })).toBe(true)
  expect(sameName('Darek', { login: 'darek', handle: 'dk' })).toBe(false)
})

test('a name made comparable: no accents, no case, letters and digits only', () => {
  expect(plainName('Łukasz B.')).toBe('lukaszb')
})

test('white initials read on every colour a person can get', () => {
  const colours = new Set(Array.from({ length: 5000 }, (_, i) => personColor(`person${i}`)))
  expect(colours.size).toBe(360)
  expect(Math.min(...[...colours].map((c) => ratio('#ffffff', c)))).toBeGreaterThanOrEqual(4.5)
})
