/**
 * Who may change whose role, remove whom, and leave: the same rules the database keeps (guard_members and
 * keep_an_owner in supabase/migrations/20261019000003_triggers.sql), so Settings only offers what will work.
 * Pure, so it's tested (tests/roles.test.ts, which also checks the messages match the database's).
 */
import type { Role } from '@/backend/workspaces'

export const ROLES: readonly Role[] = ['owner', 'admin', 'member']

export const ROLE_NAMES: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export const MSG = {
  notAdmin: 'Only admins and owners can change roles or remove people.',
  /** the database's own words (guard_members) */
  owners: 'Only an owner can change who owns the workspace.',
  ownRole: "You can't change your own role.",
  /** keep_an_owner */
  lastOwner: 'A workspace needs at least one owner. Make someone else an owner first.',
  removeSelf: "You can't remove yourself. Leave the workspace instead.",
  onlyOwnerLeaving: "You're the only owner. Make someone else an owner first, then you can leave.",
}

export interface Who {
  login: string
  role: Role
}

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
