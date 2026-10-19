/**
 * Who may change whose role, remove whom, and leave: the same rules the database keeps (guard_members and
 * keep_an_owner in supabase/migrations/20261019000003_triggers.sql), so Settings only offers what will work.
 * Pure, so it's tested (tests/roles.test.ts, which also checks the messages match the database's).
 */
import { RULES } from '@/backend/workspaces'
import { ROLES, type Member, type Person, type Role } from '@/model/schema'

export { ROLES }

export const ROLE_NAMES: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export const MSG = {
  notAdmin: RULES.notAdmin,
  owners: RULES.owners,
  ownRole: RULES.ownRole,
  lastOwner: RULES.lastOwner,
  removeSelf: "You can't remove yourself. Leave the workspace instead.",
  onlyOwnerLeaving: "You're the only owner. Make someone else an owner first, then you can leave.",
}

export interface Who {
  login: string
  role: Role
}

/** someone in the workspace as the rules see them (null: not in it) */
export function whoIs(s: { members: Record<string, Member> }, login: string | null | undefined): Who | null {
  const m = login ? s.members[login] : undefined
  return login && m && !m.removedAt ? { login, role: m.role } : null
}

/** you, as the rules see you */
export const myWho = (s: { members: Record<string, Member>; me: Person | null }): Who | null => whoIs(s, s.me?.login)

/** null: allowed; otherwise why not, in words to show */
export function ruleFor(me: Who | null, target: Who, to: Role | 'removed', owners: number): string | null {
  if (!me || me.role === 'member') return MSG.notAdmin
  const self = me.login === target.login
  const touchesOwner = to === 'removed' ? target.role === 'owner' : to !== target.role && (to === 'owner' || target.role === 'owner')
  if (touchesOwner && me.role !== 'owner') return MSG.owners
  if (self && to === 'removed') return MSG.removeSelf
  if (self && to !== target.role && me.role !== 'owner') return MSG.ownRole
  if (target.role === 'owner' && to !== 'owner' && owners <= 1) return MSG.lastOwner
  return null
}

/** `roles` holds the current one too */
export interface Choices {
  roles: Role[]
  canRemove: boolean
  /** when there's nothing to choose */
  why?: string
}

export function choicesFor(me: Who | null, target: Who, owners: number): Choices {
  const roles = ROLES.filter((r) => r === target.role || ruleFor(me, target, r, owners) === null)
  const canRemove = ruleFor(me, target, 'removed', owners) === null
  if (roles.length > 1) return { roles, canRemove }
  const why =
    !me || me.role === 'member'
      ? 'Only admins and owners can change roles.'
      : me.login === target.login
        ? me.role === 'owner'
          ? "You're the only owner."
          : MSG.ownRole
        : target.role === 'owner'
          ? 'Only an owner can change an owner.'
          : undefined
  return { roles, canRemove, ...(why && { why }) }
}

/** only the last owner can't leave */
export function canLeave(me: Who | null, owners: number): { ok: boolean; why?: string } {
  if (!me) return { ok: false }
  if (me.role === 'owner' && owners <= 1) return { ok: false, why: MSG.onlyOwnerLeaving }
  return { ok: true }
}
