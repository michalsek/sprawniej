import { expect, test } from 'bun:test'
import { senderName } from '@/features/inbox/sender'

test('a note says who it is from: their name, else their handle', () => {
  expect(senderName({ actor: 'bob' }, { name: 'Bob Builder' })).toBe('Bob Builder')
  expect(senderName({ actor: 'bob' }, { name: '' })).toBe('bob')
})

test('someone whose profile is gone is "Someone"; a Notion page with no member behind it is Notion', () => {
  expect(senderName({ actor: '' }, undefined)).toBe('Someone')
  expect(senderName({ actor: '', from: 'notion' }, undefined)).toBe('Notion')
})
