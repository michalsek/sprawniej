import { describe, expect, test } from 'bun:test'
import { linkTitle, wholeIn } from '@/features/settings/inviteText'

describe('invite links in Settings', () => {
  test('who a link is for', () => {
    expect(linkTitle({ maxUses: 1, forEmail: null }, 'Jan Kowalski')).toBe('For Jan Kowalski, from Linear')
    expect(linkTitle({ maxUses: null, forEmail: null })).toBe('Anyone with the link')
    expect(linkTitle({ maxUses: 5, forEmail: 'ana@x.test' })).toBe('Up to 5 people')
    expect(linkTitle({ maxUses: 1, forEmail: 'ana@x.test' })).toBe('For ana@x.test')
    expect(linkTitle({ maxUses: 1, forEmail: null })).toBe('For one person')
  })

  test('a typed number of people or days, only within its range', () => {
    expect(wholeIn(' 28 ', 1, 28)).toBe(28)
    expect(wholeIn('1', 1, 28)).toBe(1)
    for (const bad of ['0', '29', '', '2.5', '-3', '1e2', 'abc']) expect({ bad, n: wholeIn(bad, 1, 28) }).toEqual({ bad, n: null })
  })
})
