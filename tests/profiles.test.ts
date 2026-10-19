import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_PATTERN, suggestLogin } from '@/backend/profiles'
import { friendlyDbError, UNREACHABLE } from '@/backend/problem'

describe('a handle to start from', () => {
  test('from the email', () => {
    expect(suggestLogin('ania.kowalska@example.com')).toBe('ania-kowalska')
    expect(suggestLogin('ania+work@example.com')).toBe('ania')
    expect(suggestLogin('Łukasz.Żółć@example.com')).toBe('lukasz-zolc')
    expect(suggestLogin('-_-bob__smith-@x.pl')).toBe('bob-smith')
  })

  test('from the name when there is no email', () => {
    expect(suggestLogin(null, 'Zofia Nowak')).toBe('zofia-nowak')
    expect(suggestLogin(null)).toBe('')
    expect(suggestLogin('@x.pl')).toBe('')
  })

  test('never longer than 39, never ending in a dash', () => {
    const long = suggestLogin(`${'a'.repeat(38)}.b@x.pl`)
    expect(long).toBe('a'.repeat(38))
    expect(LOGIN_PATTERN.test(suggestLogin(`${'abc.'.repeat(20)}@x.pl`))).toBe(true)
  })

  test('the pattern is the database rule', () => {
    const sql = readFileSync(join(import.meta.dir, '..', 'supabase', 'migrations', '20261019000001_tables.sql'), 'utf8')
    expect(sql).toContain(`login ~ '${LOGIN_PATTERN.source}'`)
    for (const ok of ['a', 'A1', 'ania-k', 'a'.repeat(39)]) expect(LOGIN_PATTERN.test(ok)).toBe(true)
    for (const bad of ['', '-bad', 'a_b', 'a.b', '~guest', 'a'.repeat(40)]) expect(LOGIN_PATTERN.test(bad)).toBe(false)
  })
})

describe('database problems in plain words', () => {
  test('its own words are kept', () => {
    expect(friendlyDbError({ code: '23505', message: 'Someone already uses @ania. Pick another one.' }, 'x')).toBe('Someone already uses @ania. Pick another one.')
    expect(friendlyDbError({ code: 'SP002', message: 'This invite was already used. Ask for a new one.' }, 'x')).toBe('This invite was already used. Ask for a new one.')
  })

  test('technical words are not', () => {
    expect(friendlyDbError({ code: '23505', message: 'duplicate key value violates unique constraint "teams_key"' }, 'Try again.')).toBe('Try again.')
    expect(friendlyDbError({ code: '42501', message: 'new row violates row-level security policy for table "teams"' }, 'x')).toBe("You aren't allowed to do that here.")
    expect(friendlyDbError({ code: '08000', message: 'boom' }, 'Try again.')).toBe('Try again.')
  })

  test('no connection', () => {
    expect(friendlyDbError(new TypeError('Failed to fetch'), 'x')).toBe(UNREACHABLE)
    expect(friendlyDbError({ message: 'TypeError: Failed to fetch' }, 'x')).toBe(UNREACHABLE)
  })
})
