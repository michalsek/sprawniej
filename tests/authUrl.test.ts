import { describe, expect, test } from 'bun:test'
import { AuthProblem, friendlyAuthError, RETURN_KEY, takeReturnedUrl } from '@/backend/auth'

/** a sessionStorage stand-in, and what the address was replaced with */
function run(loc: { pathname?: string; search?: string; hash?: string }, saved?: string) {
  const store = new Map<string, string>(saved === undefined ? [] : [[RETURN_KEY, saved]])
  let replaced: string | undefined
  const problem = takeReturnedUrl(
    { pathname: '/', search: '', hash: '', ...loc },
    { getItem: (k) => store.get(k) ?? null, removeItem: (k) => void store.delete(k) },
    (url) => (replaced = url),
  )
  return { problem, replaced, left: store.get(RETURN_KEY) }
}

describe('coming back from GitHub', () => {
  test('the route kept before leaving comes back, and ?code stays for the sign-in', () => {
    const r = run({ search: '?code=abc' }, '#/issue/ENG-4')
    expect(r.replaced).toBe('/?code=abc#/issue/ENG-4')
    expect(r.problem).toBeUndefined()
    expect(r.left).toBeUndefined()
  })

  test('a sign-in that came back with an error: the error goes, a problem is told', () => {
    const r = run({ pathname: '/sprawniej/', search: '?error=access_denied&error_code=x&error_description=no', hash: '#/' })
    expect(r.replaced).toBe('/sprawniej/#/')
    expect(r.problem).toBe("Signing in with GitHub didn't finish. Try again, or use your email.")
  })

  test('an error in the #part counts too, and the kept route replaces it', () => {
    const r = run({ hash: '#error=server_error&error_description=x' }, '#/my-issues')
    expect(r.replaced).toBe('/#/my-issues')
    expect(r.problem).toBeDefined()
  })

  test('an address that already has a route keeps it', () => {
    expect(run({ search: '?code=abc', hash: '#/inbox' }, '#/my-issues').replaced).toBe('/?code=abc#/inbox')
  })

  test('nothing kept and no error: the address is left alone', () => {
    expect(run({ search: '?code=abc', hash: '#/inbox' })).toEqual({ problem: undefined, replaced: undefined, left: undefined })
  })

  test('a kept route that is not a route is not put back', () => {
    expect(run({}, 'javascript:alert(1)').replaced).toBe('/#/')
  })
})

describe('sign-in problems in plain words', () => {
  const cases: [string, string][] = [
    ['invalid_credentials', "That email and password don't match. Check them and try again."],
    ['user_already_exists', "There's already an account with this email. Sign in instead."],
    ['email_exists', "There's already an account with this email. Sign in instead."],
    ['weak_password', 'Pick a longer password: at least 8 characters.'],
    ['email_address_invalid', "That email address doesn't look right."],
    ['email_not_confirmed', 'Open the link we emailed you first, then sign in.'],
    ['over_request_rate_limit', 'Too many tries in a short time. Wait a minute and try again.'],
    ['signup_disabled', "New accounts can't be created right now. Ask whoever looks after Sprawniej."],
  ]
  for (const [code, text] of cases) test(code, () => expect(friendlyAuthError({ code, message: 'whatever', status: 400 })).toBe(text))

  test('no answer at all', () => {
    expect(friendlyAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe("Can't reach Sprawniej. Check your internet connection and try again.")
    expect(friendlyAuthError(new TypeError('Failed to fetch'))).toBe("Can't reach Sprawniej. Check your internet connection and try again.")
  })

  test('anything else, and our own problems as they are', () => {
    expect(friendlyAuthError({ code: 'unexpected_failure', status: 500 })).toBe('Something went wrong while signing in. Try again in a moment.')
    expect(friendlyAuthError(undefined)).toBe('Something went wrong while signing in. Try again in a moment.')
    expect(friendlyAuthError(new AuthProblem('Use your email.'))).toBe('Use your email.')
  })
})
