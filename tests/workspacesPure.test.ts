import { describe, expect, test } from 'bun:test'
import { expiresText, InviteError, inviteProblem, isExpired, toInviteInfo } from '@/backend/workspaces'

describe('what the join page reads', () => {
  test('people, an inviter, no workspace id for those not in it', () => {
    const info = toInviteInfo({
      workspace_id: null,
      workspace_name: 'Acme',
      invited_by_name: 'Ana Nowak',
      invited_by_login: 'ana',
      invited_by_avatar: 'https://x.test/a.png',
      for_login: null,
      for_name: 'Jan Kowalski',
      role: 'admin',
      state: 'open',
      people: [{ name: 'Ana Nowak', avatarUrl: 'https://x.test/a.png' }, { name: 'Bob' }, 'nonsense'],
    })
    expect(info).toEqual({
      workspaceId: null,
      workspaceName: 'Acme',
      invitedBy: { name: 'Ana Nowak', login: 'ana', avatarUrl: 'https://x.test/a.png' },
      forName: 'Jan Kowalski',
      role: 'admin',
      state: 'open',
      people: [
        { name: 'Ana Nowak', avatarUrl: 'https://x.test/a.png' },
        { name: 'Bob', avatarUrl: '' },
      ],
    })
  })

  test('an inviter who is gone, a member, something unknown', () => {
    const info = toInviteInfo({ workspace_id: 'ws', workspace_name: 'Acme', invited_by_name: null, invited_by_login: null, role: 'member', state: 'member', people: null })
    expect(info).toMatchObject({ workspaceId: 'ws', invitedBy: null, forName: null, state: 'member', people: [] })
    expect(toInviteInfo({ state: 'later' }).state).toBe('used')
  })
})

describe('what went wrong with joining', () => {
  test('each kind', () => {
    expect(inviteProblem({ code: 'SP002', message: 'x' }).kind).toBe('used')
    expect(inviteProblem({ code: 'SP003', message: 'x' }).kind).toBe('expired')
    expect(inviteProblem({ code: 'P0002', message: 'x' }).kind).toBe('unknown')
    const offline = inviteProblem(new TypeError('Failed to fetch'))
    expect(offline.kind).toBe('network')
    expect(offline.message).toBe("Can't reach Sprawniej. Check your internet connection and try again.")
    const name = inviteProblem({ code: '42501', message: 'Pick your name first.' })
    expect(name).toBeInstanceOf(InviteError)
    expect([name.kind, name.message]).toEqual(['other', 'Pick your name first.'])
    expect(inviteProblem({ code: 'XX000', message: 'relation "x" does not exist' }).message).toBe("We couldn't add you to the workspace. Try again in a moment.")
  })
})

describe('when a link stops working', () => {
  const now = new Date(2026, 9, 19, 12, 0).getTime()
  const at = (days: number, hours = 0) => new Date(2026, 9, 19 + days, 12 + hours).toISOString()
  test('today, tomorrow, in days, gone', () => {
    expect(expiresText(at(0, 6), now)).toBe('expires today')
    expect(expiresText(at(1), now)).toBe('expires tomorrow')
    expect(expiresText(at(3), now)).toBe('expires in 3 days')
    expect(expiresText(at(14), now)).toBe('expires in 14 days')
    expect(expiresText(at(0, -1), now)).toBe('expired')
    expect(isExpired({ expiresAt: at(0, -1) }, now)).toBe(true)
    expect(isExpired({ expiresAt: at(1) }, now)).toBe(false)
  })
})
