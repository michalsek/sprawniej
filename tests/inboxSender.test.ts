import { expect, test } from 'bun:test'
import { senderName } from '@/features/inbox/sender'

test('a note says who it is from: their name, else their handle', () => {
  expect(senderName({ actor: 'bob' }, { name: 'Bob Builder', login: 'bob' })).toBe('Bob Builder')
  expect(senderName({ actor: 'bob' }, { name: '', login: 'bob', handle: 'bobby' })).toBe('bobby')
})

test('someone whose profile is gone is "Someone"; a Notion page with no member behind it is Notion', () => {
  expect(senderName({ actor: '' }, undefined)).toBe('Someone')
  expect(senderName({ actor: '', from: 'notion' }, undefined)).toBe('Notion')
})
