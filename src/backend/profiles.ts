/**
 * Your profile: the name and @handle teammates see. Signing in finds it (or, for a GitHub sign-in, makes it from
 * your GitHub login); otherwise you pick a handle once (PickLogin).
 */
import type { Person } from '@/model/schema'
import { plain } from '@/lib/plain'
import { requireClient } from './client'
import { friendlyDbError } from './problem'
import { rowToPerson } from './rows'

/** the same rule as private.valid_login (supabase/migrations/20261019000001_tables.sql) */
export { LOGIN_PATTERN } from '@/model/schema'

export interface MyProfile {
  id: string
  person: Person
}

/** null: no handle picked yet */
export async function ensureProfile(): Promise<MyProfile | null> {
  const { data, error } = await requireClient().rpc('ensure_profile').maybeSingle()
  if (error) throw error
  return data ? { id: data.id, person: rowToPerson(data) } : null
}

/** throws an Error whose message can be shown as it is */
export async function createProfile(login: string, name: string): Promise<MyProfile> {
  const { data, error } = await requireClient().rpc('create_profile', { p_login: login.trim(), p_name: name.trim() }).maybeSingle()
  // picked already (in another tab, say): that one it is
  if (error?.code === 'SP001') {
    // can't read it now: say what went wrong with picking instead
    const mine = await ensureProfile().catch(() => null)
    if (mine) return mine
  }
  // the database words a taken handle (23505) and one that isn't a handle (22023) for people already
  if (error || !data) throw new Error(friendlyDbError(error, "We couldn't save your name. Try again in a moment."))
  return { id: data.id, person: rowToPerson(data) }
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
