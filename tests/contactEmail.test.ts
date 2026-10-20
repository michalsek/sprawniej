import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emailError } from '@/backend/profiles'
import { changeProblem, EMAIL_PATTERN, EMAIL_PROBLEMS, emailProblem, MAX_CONTACT_EMAILS, MAX_EMAIL_LENGTH, signInEmailToOffer } from '@/model/contactEmail'

const sql = readFileSync(join(import.meta.dir, '..', 'supabase', 'migrations', '20261021190000_contact_emails.sql'), 'utf8')

/** the line right after "-- @<marker>" */
function after(marker: string): string {
  const lines = sql.split('\n')
  const n = lines.findIndex((l) => l.trim() === `-- @${marker}`)
  expect(n).toBeGreaterThanOrEqual(0)
  return lines[n + 1].trim()
}

const list = (...emails: string[]) => emails.map((email) => ({ email }))
/** exactly `n` characters, still the shape of an email */
const ofLength = (n: number) => `${'a'.repeat(n - 6)}@x.com`

describe('contact email rules', () => {
  test('the same as the database', () => {
    expect(after('regex email')).toContain(`email ~ '${EMAIL_PATTERN.source}'`)
    expect(after('max contact-emails')).toBe(String(MAX_CONTACT_EMAILS))
    expect(sql).toContain(`length(email) <= ${MAX_EMAIL_LENGTH}`)
    expect(sql).toContain(`'${EMAIL_PROBLEMS.full}'`)
  })

  test('the shape of an email', () => {
    for (const ok of ['ana@firma.pl', 'Ana.K+work@mail.firma.co.uk', '  ana@firma.pl  ', 'a@b.c']) expect(emailProblem(ok, [])).toBeNull()
    for (const bad of ['', 'ana', 'ana@', '@firma.pl', 'ana@firma', 'ana firma@x.pl', 'a@b@x.pl', 'ana@x..pl', 'ana@.x.pl', 'ana@x.pl.'])
      expect(emailProblem(bad, [])).toBe(EMAIL_PROBLEMS.shape)
  })

  test('up to 254 characters', () => {
    expect(emailProblem(ofLength(MAX_EMAIL_LENGTH), [])).toBeNull()
    expect(emailProblem(ofLength(MAX_EMAIL_LENGTH + 1), [])).toBe(EMAIL_PROBLEMS.long)
  })

  test('the same email twice, case and spaces aside', () => {
    expect(emailProblem(' ANA@Firma.pl ', list('ana@firma.pl'))).toBe(EMAIL_PROBLEMS.taken)
  })

  test('up to 5', () => {
    const four = list('a@x.pl', 'b@x.pl', 'c@x.pl', 'd@x.pl')
    expect(emailProblem('e@x.pl', four)).toBeNull()
    expect(emailProblem('f@x.pl', [...four, { email: 'e@x.pl' }])).toBe(EMAIL_PROBLEMS.full)
  })

  test('changing one: only the others count, and a full list is fine', () => {
    const five = ['a@x.pl', 'b@x.pl', 'c@x.pl', 'd@x.pl', 'e@x.pl'].map((email, i) => ({ id: String(i), email }))
    expect(changeProblem('0', 'A@X.pl', five)).toBeNull()
    expect(changeProblem('0', 'f@x.pl', five)).toBeNull()
    expect(changeProblem('0', 'B@x.pl', five)).toBe(EMAIL_PROBLEMS.taken)
    expect(changeProblem('0', 'nope', five)).toBe(EMAIL_PROBLEMS.shape)
  })
})

describe('offering the sign-in email', () => {
  test('only one that could be added as it is', () => {
    expect(signInEmailToOffer('ana@firma.pl', [])).toBe('ana@firma.pl')
    expect(signInEmailToOffer(null, [])).toBeNull()
    expect(signInEmailToOffer('', [])).toBeNull()
    // already in the list (case aside), or no room left
    expect(signInEmailToOffer('Ana@Firma.pl', list('ana@firma.pl'))).toBeNull()
    expect(signInEmailToOffer('f@x.pl', list('a@x.pl', 'b@x.pl', 'c@x.pl', 'd@x.pl', 'e@x.pl'))).toBeNull()
  })
})

describe('database refusals in plain words', () => {
  test('a duplicate and a bad shape get our words; the limit keeps its own', () => {
    expect(emailError({ code: '23505', message: 'duplicate key value violates unique constraint "profile_emails_email"' }, 'x')).toBe(EMAIL_PROBLEMS.taken)
    expect(emailError({ code: '23514', message: 'new row for relation "profile_emails" violates check constraint "profile_emails_email_check"' }, 'x')).toBe(
      EMAIL_PROBLEMS.shape,
    )
    expect(emailError({ code: '23514', message: EMAIL_PROBLEMS.full }, 'x')).toBe(EMAIL_PROBLEMS.full)
  })
})
