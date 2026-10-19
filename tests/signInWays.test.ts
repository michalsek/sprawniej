import { describe, expect, test } from 'bun:test'
import { signInWays, type IdentityIn } from '@/backend/auth'
import { passwordProblem } from '@/features/settings/password'

const EMAIL: IdentityIn = { identity_id: 'i-email', provider: 'email', identity_data: { email: 'ana@x.test' } }
const GITHUB: IdentityIn = { identity_id: 'i-gh', provider: 'github', identity_data: { user_name: 'octocat' } }
const on = { github: true, google: false }
const off = { github: false, google: false }

describe('ways to sign in', () => {
  test('an email-only account: change the password; add GitHub, or not yet', () => {
    const [password, github] = signInWays({ email: 'ana@x.test', identities: [EMAIL], passwordSet: false }, on)
    expect(password).toEqual({ kind: 'password', on: true, detail: 'ana@x.test', action: 'change-password' })
    expect(github).toEqual({ kind: 'github', on: false, detail: '', action: 'add' })
    const [, githubOff] = signInWays({ email: 'ana@x.test', identities: [EMAIL], passwordSet: false }, off)
    expect(githubOff).toMatchObject({ action: null, why: "Signing in with GitHub isn't switched on yet." })
  })

  test('a GitHub-only account: set a password; GitHub is its only way', () => {
    const [password, github] = signInWays({ email: 'ana@x.test', identities: [GITHUB], passwordSet: false }, on)
    expect(password.action).toBe('set-password')
    expect(github).toEqual({ kind: 'github', on: true, detail: '@octocat', action: null, why: "It's your only way to sign in.", identityId: 'i-gh' })
  })

  test('a GitHub account that set a password: change it; GitHub still stays (one identity)', () => {
    const [password, github] = signInWays({ email: 'ana@x.test', identities: [GITHUB], passwordSet: true }, on)
    expect(password.action).toBe('change-password')
    expect(github.action).toBeNull()
  })

  test('email and GitHub: GitHub can go, the email never is offered', () => {
    const ways = signInWays({ email: 'ana@x.test', identities: [EMAIL, GITHUB], passwordSet: false }, on)
    expect(ways.map((w) => [w.kind, w.action])).toEqual([
      ['password', 'change-password'],
      ['github', 'remove'],
    ])
  })

  test('no email: no password', () => {
    const [password] = signInWays({ email: null, identities: [GITHUB], passwordSet: false }, on)
    expect(password).toMatchObject({ action: null, why: "Your account has no email address, so a password can't be added." })
  })

  test('Google shows only once it is switched on', () => {
    expect(signInWays({ email: 'a@x.test', identities: [EMAIL], passwordSet: false }, on).map((w) => w.kind)).toEqual(['password', 'github'])
    expect(signInWays({ email: 'a@x.test', identities: [EMAIL], passwordSet: false }, { github: true, google: true }).map((w) => w.kind)).toEqual([
      'password',
      'github',
      'google',
    ])
  })
})

describe('a new password', () => {
  test('long enough, typed the same twice', () => {
    expect(passwordProblem('short', 'short')).toBe('Pick a longer password: at least 8 characters.')
    expect(passwordProblem('long enough', 'long enougH')).toBe("The two passwords don't match.")
    expect(passwordProblem('long enough', 'long enough')).toBeUndefined()
  })
})
