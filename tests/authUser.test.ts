import { describe, expect, test } from 'bun:test'
import { older, type AuthUser } from '@/backend/auth'

const you = (id: string, updatedAt?: string): AuthUser => ({ id, email: null, name: '', avatarUrl: '', updatedAt })

describe('an older copy of you never replaces a newer one', () => {
  test('the same person, changed since: kept out', () => {
    expect(older(you('u1', '2026-10-20T10:00:00Z'), you('u1', '2026-10-20T10:05:00Z'))).toBe(true)
  })

  test('someone else replaces whatever was there', () => {
    expect(older(you('u2', '2026-10-20T10:00:00Z'), you('u1', '2026-10-20T10:05:00Z'))).toBe(false)
  })

  test('a copy that does not say when it changed replaces it', () => {
    expect(older(you('u1'), you('u1', '2026-10-20T10:05:00Z'))).toBe(false)
  })
})
