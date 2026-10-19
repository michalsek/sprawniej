import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canLeave, choicesFor, MSG, ruleFor, type Who } from '@/data/roles'
import { isAdmin, ownerCount, roleOf } from '@/data/select'

const owner: Who = { login: 'ana', role: 'owner' }
const admin: Who = { login: 'bob', role: 'admin' }
const member: Who = { login: 'cy', role: 'member' }
const otherOwner: Who = { login: 'dee', role: 'owner' }
const otherAdmin: Who = { login: 'eve', role: 'admin' }

describe('who may change whose role (the table in the plan, row by row)', () => {
  test('a member: nothing, with the reason', () => {
    for (const target of [owner, admin, member]) {
      expect(choicesFor(member, target, 1)).toEqual({ roles: [target.role], canRemove: false, why: 'Only admins and owners can change roles.' })
    }
    expect(choicesFor(null, member, 1).roles).toEqual(['member'])
  })

  test('an admin: not themselves, not owners; admins and members both ways, and removing them', () => {
    expect(choicesFor(admin, admin, 1)).toEqual({ roles: ['admin'], canRemove: false, why: "You can't change your own role." })
    expect(choicesFor(admin, owner, 1)).toEqual({ roles: ['owner'], canRemove: false, why: 'Only an owner can change an owner.' })
    expect(choicesFor(admin, otherAdmin, 1)).toEqual({ roles: ['admin', 'member'], canRemove: true })
    expect(choicesFor(admin, member, 1)).toEqual({ roles: ['admin', 'member'], canRemove: true })
  })

  test('an owner: everything for others; for themselves only while another owner stays', () => {
    expect(choicesFor(owner, owner, 2)).toEqual({ roles: ['owner', 'admin', 'member'], canRemove: false })
    expect(choicesFor(owner, owner, 1)).toEqual({ roles: ['owner'], canRemove: false, why: "You're the only owner." })
    expect(choicesFor(owner, otherOwner, 2)).toEqual({ roles: ['owner', 'admin', 'member'], canRemove: true })
    expect(choicesFor(owner, admin, 1)).toEqual({ roles: ['owner', 'admin', 'member'], canRemove: true })
    expect(choicesFor(owner, member, 1)).toEqual({ roles: ['owner', 'admin', 'member'], canRemove: true })
  })
})

describe('the reasons, in the order the database checks', () => {
  test('ruleFor', () => {
    expect(ruleFor(member, admin, 'member', 1)).toBe(MSG.notAdmin)
    expect(ruleFor(admin, member, 'owner', 1)).toBe(MSG.owners)
    expect(ruleFor(admin, owner, 'removed', 1)).toBe(MSG.owners)
    expect(ruleFor(admin, admin, 'member', 1)).toBe(MSG.ownRole)
    expect(ruleFor(admin, admin, 'removed', 1)).toBe(MSG.removeSelf)
    expect(ruleFor(owner, owner, 'admin', 1)).toBe(MSG.lastOwner)
    expect(ruleFor(owner, owner, 'admin', 2)).toBeNull()
    expect(ruleFor(owner, member, 'owner', 1)).toBeNull()
    expect(ruleFor(admin, member, 'removed', 1)).toBeNull()
  })

  test('leaving: only the last owner can not', () => {
    expect(canLeave(owner, 1)).toEqual({ ok: false, why: MSG.onlyOwnerLeaving })
    expect(canLeave(owner, 2)).toEqual({ ok: true })
    expect(canLeave(admin, 1)).toEqual({ ok: true })
    expect(canLeave(member, 1)).toEqual({ ok: true })
    expect(canLeave(null, 1).ok).toBe(false)
  })

  test("the messages are the database's own", () => {
    const sql = readFileSync(join(import.meta.dir, '..', 'supabase', 'migrations', '20261019000003_triggers.sql'), 'utf8')
    for (const m of [MSG.owners, MSG.ownRole, MSG.lastOwner]) expect(sql).toContain(`'${m.replaceAll("'", "''")}'`)
  })
})

describe('your role from the store', () => {
  const me = { login: 'ana', githubId: 0, name: 'Ana', avatarUrl: '' }
  test('roleOf, isAdmin, ownerCount', () => {
    const members = { ana: { role: 'admin' as const, removedAt: null }, bob: { role: 'owner' as const, removedAt: null }, cy: { role: 'owner' as const, removedAt: 'x' } }
    expect(roleOf({ me, members })).toBe('admin')
    expect(isAdmin({ me, members })).toBe(true)
    expect(ownerCount({ members })).toBe(1)
    expect(roleOf({ me, members: { ana: { role: 'owner', removedAt: 'x' } } })).toBeNull()
    expect(isAdmin({ me: null, members })).toBe(false)
    expect(isAdmin({ me, members: { ana: { role: 'member', removedAt: null } } })).toBe(false)
  })
})
