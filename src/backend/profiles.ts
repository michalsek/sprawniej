/**
 * Your profile: the name and @handle teammates see. Signing in finds it (or, for a GitHub sign-in, makes it from
 * your GitHub login); otherwise you pick a handle when you start (PickLogin), and you can change it later (setHandle).
 */
import type { Person } from '@/model/schema'
import { plain } from '@/lib/plain'
import { requireClient } from './client'
import { friendlyDbError } from './problem'
import { rowToPerson } from './rows'
import type { Row } from './tables'

/** the same rule as private.valid_login (supabase/migrations/20261019000001_tables.sql) */
export { LOGIN_PATTERN } from '@/model/schema'

export interface MyProfile {
  id: string
  person: Person
}

/** null: no handle picked yet (or, after a GitHub sign-up, no sign-up code given yet: SP004) */
export async function ensureProfile(): Promise<MyProfile | null> {
  const { data, error } = await requireClient().rpc('ensure_profile').maybeSingle()
  if (error?.code === 'SP004') return null
  if (error) throw error
  return data ? { id: data.id, person: rowToPerson(data) } : null
}

/** picking a name failed: the message can be shown as it is; `code` is the database's (SP004: a sign-up code is needed) */
export class ProfileProblem extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

/** throws a ProfileProblem */
export async function createProfile(login: string, name: string): Promise<MyProfile> {
  const { data, error } = await requireClient().rpc('create_profile', { p_login: login.trim(), p_name: name.trim() }).maybeSingle()
  // picked already (in another tab, say): that one it is
  if (error?.code === 'SP001') {
    // can't read it now: say what went wrong with picking instead
    const mine = await ensureProfile().catch(() => null)
    if (mine) return mine
  }
  // the database words a taken handle (23505) and one that isn't a handle (22023) for people already
  if (error || !data) throw new ProfileProblem(friendlyDbError(error, "We couldn't save your name. Try again in a moment."), error?.code)
  return { id: data.id, person: rowToPerson(data) }
}

/**
 * Changes your @handle (Settings › Your account) and gives back your profile's row (backend.setHandle shows it at
 * once). Throws a ProfileProblem worded to show (taken, not a handle).
 */
export async function setHandle(handle: string): Promise<Row<'profiles'>> {
  const { data, error } = await requireClient().rpc('set_handle', { p_handle: handle }).maybeSingle()
  if (error || !data) throw new ProfileProblem(friendlyDbError(error, "We couldn't change your handle. Try again in a moment."), error?.code)
  return data
}

/** a handle to start from: "ania.kowalska+work@x.pl" → "ania-kowalska" */
export function suggestLogin(email: string | null, name?: string): string {
  const from = email?.split('@')[0].split('+')[0] || name || ''
  return plain(from)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 39)
    .replace(/-+$/, '')
}
