import { afterEach, describe, expect, test } from 'bun:test'
import type { InviteInfo } from '@/backend/workspaces'
import { inviteMessage, inviteUrl, joinStage, peopleLine, readInvitePath } from '@/features/onboarding/invite'

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2'

describe('reading an invite link', () => {
  test('a token, in any case, with or without a slash at the end', () => {
    expect(readInvitePath(`/join/${TOKEN}`)).toEqual({ token: TOKEN })
    expect(readInvitePath(`/join/${TOKEN.toUpperCase()}`)).toEqual({ token: TOKEN })
    expect(readInvitePath(`/join/${TOKEN}/`)).toEqual({ token: TOKEN })
  })

  test('spaces around it and a ?query after it go', () => {
    expect(readInvitePath(`/join/%20${TOKEN}%20`)).toEqual({ token: TOKEN })
    expect(readInvitePath(`/join/${TOKEN}?utm=x`)).toEqual({ token: TOKEN })
    expect(readInvitePath(`/join/${TOKEN}/?utm=x`)).toEqual({ token: TOKEN })
  })

  test('the older links say so; any other /join/ is a link that does not work; the rest is no invite', () => {
    expect(readInvitePath('/join/acme/data?ws=x')).toBe('old')
    expect(readInvitePath('/join/acme/data')).toBe('old')
    expect(readInvitePath('/team/ENG')).toBeNull()
    expect(readInvitePath('/joinery')).toBeNull()
    for (const bad of ['/join', '/join/', '/join/short', `/join/${'z'.repeat(36)}`, `/join/${'a'.repeat(130)}`, '/join/%E0%A4%A']) {
      expect(readInvitePath(bad)).toEqual({ token: null })
    }
  })
})

describe('the link to send', () => {
  const was = globalThis.location
  const at = (href: string) => {
    const u = new URL(href)
    Object.defineProperty(globalThis, 'location', { value: { hostname: u.hostname, origin: u.origin, pathname: u.pathname }, configurable: true })
  }
  afterEach(() => Object.defineProperty(globalThis, 'location', { value: was, configurable: true }))

  test('the published address works for everyone', () => {
    at('https://team.github.io/sprawniej/')
    expect(inviteUrl(TOKEN)).toEqual({ url: `https://team.github.io/sprawniej/#/join/${TOKEN}`, local: false })
  })

  test('on this computer it still gives a link, one that only works here (E8)', () => {
    at('http://localhost:5299/')
    expect(inviteUrl(TOKEN)).toEqual({ url: `http://localhost:5299/#/join/${TOKEN}`, local: true })
  })
})

describe('the ready-to-send message', () => {
  const url = `https://x.test/#/join/${TOKEN}`
  test('greets someone from Linear by their first name', () => {
    const m = inviteMessage(url, 'Acme', 'Jan Kowalski')
    expect(m.startsWith('Hi Jan! ')).toBe(true)
    expect(m).toContain(url)
    expect(m).toContain('join Acme')
    expect(m).not.toContain('—')
  })
  test('or anyone', () => {
    expect(inviteMessage(url, 'Acme').startsWith('Hi! We plan')).toBe(true)
  })
})

describe('who is here', () => {
  test('one, two, three, more, and the most invite_info shows', () => {
    expect(peopleLine([])).toBe('')
    expect(peopleLine(['Ania'])).toBe('Ania is here.')
    expect(peopleLine(['Ania', 'Tomek'])).toBe('Ania and Tomek are here.')
    expect(peopleLine(['Ania', 'Tomek', 'Ola'])).toBe('Ania, Tomek and Ola are here.')
    expect(peopleLine(['Ania', 'Tomek', 'Ola', 'Ewa', 'Jan', 'Kuba'])).toBe('Ania, Tomek and 4 others are here.')
    expect(peopleLine(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe('a, b and others are here.')
  })
})

describe('which join screen', () => {
  const info = (state: InviteInfo['state']): InviteInfo => ({ workspaceId: null, workspaceName: 'Acme', invitedBy: null, forName: null, role: 'member', state, people: [] })
  const base = { info: info('open'), failed: false, signedIn: true, profile: 'ready' as const, pressedJoin: true }

  test('in order', () => {
    expect(joinStage({ ...base, failed: true })).toBe('failed')
    expect(joinStage({ ...base, info: undefined })).toBe('loading')
    expect(joinStage({ ...base, info: null })).toBe('unknown')
    expect(joinStage({ ...base, info: info('used') })).toBe('used')
    expect(joinStage({ ...base, info: info('expired') })).toBe('expired')
    expect(joinStage({ ...base, info: info('member') })).toBe('member')
    expect(joinStage({ ...base, pressedJoin: false })).toBe('welcome')
    expect(joinStage({ ...base, signedIn: false })).toBe('account')
    expect(joinStage({ ...base, profile: 'loading' })).toBe('profile')
    expect(joinStage({ ...base, profile: 'failed' })).toBe('profile')
    expect(joinStage({ ...base, profile: 'none' })).toBe('name')
    expect(joinStage(base)).toBe('joining')
  })
})
