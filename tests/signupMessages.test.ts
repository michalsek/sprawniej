import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { friendlyAuthError, SIGNUP_REFUSALS } from '@/backend/auth'

// Why a new account isn't let in comes from the database (private.let_in) as the error's message, and the app shows
// only the sentences it knows. Each one in the SQL has a marker comment ("-- @message signup") on the line above it.
// Only the newest definition of let_in counts: a sentence it no longer says needn't stay in the app.

const dir = join(import.meta.dir, '..', 'supabase', 'migrations')
const DEFINES = /^create (?:or replace )?function private\.let_in\(/m
const newest = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(dir, f), 'utf8'))
  .findLast((text) => DEFINES.test(text))
/** the newest let_in, from its first line to the end of its body */
const sql = newest ? newest.slice(newest.search(DEFINES)).split(/^end \$\$;/m)[0] : ''

/** the SQL string on the line after each marker, with '' read as ' */
function marked(): string[] {
  const lines = sql.split('\n')
  return lines.flatMap((line, n) => {
    if (line.trim() !== '-- @message signup') return []
    const m = (lines[n + 1] ?? '').match(/'((?:[^']|'')*)'/)
    return m ? [m[1].replaceAll("''", "'")] : []
  })
}

describe('sign-up refusals', () => {
  test('the app knows every sentence the database says', () => {
    expect(new Set(marked())).toEqual(new Set(SIGNUP_REFUSALS))
  })

  test('are shown as they are; other messages are not', () => {
    for (const m of SIGNUP_REFUSALS) expect(friendlyAuthError({ name: 'AuthApiError', status: 403, code: 'unknown', message: m })).toBe(m)
    expect(friendlyAuthError({ status: 403, code: 'unknown', message: 'Error running hook URI: pg-functions://…' })).toBe(
      'Something went wrong while signing in. Try again in a moment.',
    )
  })
})
