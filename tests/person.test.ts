import { expect, test } from 'bun:test'
import { sameName } from '@/lib/person'
import { plainName } from '@/lib/plain'

test('names that probably match', () => {
  expect(sameName('Darek Smith', { login: 'darekk', name: 'Darek Smith' })).toBe(true)
  expect(sameName('Łukasz Bąk', { login: 'lb', name: 'Lukasz Bak' })).toBe(true)
  expect(sameName('Darek', { login: 'darek' })).toBe(true)
  expect(sameName('Darek Smith', { login: 'darekk', name: null })).toBe(false)
})

test('a name made comparable: no accents, no case, letters and digits only', () => {
  expect(plainName('Łukasz B.')).toBe('lukaszb')
})
