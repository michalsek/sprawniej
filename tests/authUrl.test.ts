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

  test('a sign-in that came back with an error: the error goes (with any code), a problem is told', () => {
    const r = run({ pathname: '/sprawniej/', search: '?error=access_denied&error_code=x&error_description=no&code=c&sb_flow_id=f&keep=1', hash: '#/' })
    expect(r.replaced).toBe('/sprawniej/?keep=1#/')
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
  test('a known problem', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 })).toBe("That email and password don't match. Check them and try again.")
  })

  test('no answer at all', () => {
    expect(friendlyAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe("Can't reach Sprawniej. Check your internet connection and try again.")
  })

  test('anything else, and our own problems as they are', () => {
    expect(friendlyAuthError({ code: 'unexpected_failure', status: 500 })).toBe('Something went wrong while signing in. Try again in a moment.')
    expect(friendlyAuthError(new AuthProblem('Use your email.'))).toBe('Use your email.')
  })
})
