/**
 * Your profile: the name and @handle teammates see. Signing in finds it (or, for a GitHub sign-in, makes it from
 * your GitHub login); otherwise you pick a handle when you start (PickLogin), and you can change it later (setHandle).
 */
import type { Person } from '@/model/schema'
import { EMAIL_PROBLEMS, type ContactEmail } from '@/model/contactEmail'
import { plain } from '@/lib/plain'
import { requireClient } from './client'
import { friendlyDbError, ownWords } from './problem'
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
 * Changes your @handle (Settings › Profile) and gives back your profile's row (backend.setHandle shows it at
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

// ---------- your contact emails ----------
// Awaited calls, like invite links: the list is yours alone (profile_emails), read when the screen opens. The one you
// show is copied onto your profile by the database, and reaches teammates with it.

/** the database's refusal in words to show (each function below throws an Error with them) */
export function emailError(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown }
  if (e.code === '23505') return EMAIL_PROBLEMS.taken
  // the limit says it in words (friendlyDbError keeps those); the shape and length checks don't
  if (e.code === '23514' && !ownWords(typeof e.message === 'string' ? e.message : undefined)) return EMAIL_PROBLEMS.shape
  return friendlyDbError(error, fallback)
}

const GONE = "That email isn't in your list any more."

/** oldest first */
export async function listMyEmails(): Promise<ContactEmail[]> {
  const { data, error } = await requireClient().from('profile_emails').select('id, email, visible, created_at').order('created_at')
  if (error) throw new Error(emailError(error, "We couldn't read your emails. Try again in a moment."))
  return data.map((r) => ({ id: r.id, email: r.email, visible: r.visible, createdAt: r.created_at }))
}

/** a new email, not shown to anyone yet; returns its id */
export async function addMyEmail(email: string): Promise<string> {
  // profile_id is yours: the database fills it in (and refuses it from here)
  const { data, error } = await requireClient().from('profile_emails').insert({ email: email.trim() }).select('id').single()
  if (error) throw new Error(emailError(error, "We couldn't add the email. Try again in a moment."))
  return data.id
}

export async function changeMyEmail(id: string, email: string): Promise<void> {
  const { data, error } = await requireClient().from('profile_emails').update({ email: email.trim() }).eq('id', id).select('id')
  if (error) throw new Error(emailError(error, "We couldn't change the email. Try again in a moment."))
  if (!data.length) throw new Error(GONE)
}

export async function removeMyEmail(id: string): Promise<void> {
  const { data, error } = await requireClient().from('profile_emails').delete().eq('id', id).select('id')
  if (error) throw new Error(emailError(error, "We couldn't remove the email. Try again in a moment."))
  if (!data.length) throw new Error(GONE)
}

/** the email teammates see; null shows none */
export async function showMyEmail(id: string | null): Promise<void> {
  const { error } = await requireClient().rpc('show_email', id ? { p_email: id } : {})
  if (error) throw new Error(emailError(error, "We couldn't change which email teammates see. Try again in a moment."))
}
