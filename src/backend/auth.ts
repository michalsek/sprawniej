/**
 * Signing in: with an email and a password, or with GitHub. The database client keeps the sign-in in this browser
 * and renews it by itself; this follows what it says and puts it in words people understand.
 *
 * GitHub sign-in leaves the page and comes back to it (authRedirectUrl) with ?code, which the client turns into a
 * sign-in when it starts. The #route you were on is kept in sessionStorage meanwhile and put back first thing.
 */
import type { AuthChangeEvent, Session as AuthSession, User } from '@supabase/supabase-js'
import { create } from 'zustand'
import { authRedirectUrl } from '@/config'
import { useSession } from '@/session'
import { stopCaching } from './cacheStore'
import { backendConfig, getClient, requireClient } from './client'
import { isUnreachable, UNREACHABLE } from './problem'

export interface AuthUser {
  id: string
  email: string | null
  name: string
  avatarUrl: string
}

export interface AuthState {
  /** the client has started (and finished a sign-in that just came back from GitHub) */
  ready: boolean
  user: AuthUser | null
  /** the sign-in ended without "Sign out" in this browser (expired, or ended elsewhere): "Please sign in again" */
  lost: boolean
  /** a GitHub sign-in that came back without finishing, in plain words */
  urlProblem?: string
}

export const useAuth = create<AuthState>()(() => ({ ready: false, user: null, lost: false }))

/** the #route to come back to after GitHub */
export const RETURN_KEY = 'sprawniej:return-to'
/** set just before "Sign out", so the sign-out other tabs hear about is told apart from one that just happened */
const SIGNING_OUT = 'sprawniej:signing-out'

/** a problem with signing in, ready to show */
export class AuthProblem extends Error {}

const GITHUB_UNFINISHED = "Signing in with GitHub didn't finish. Try again, or use your email."
const GITHUB_OFF = "Signing in with GitHub isn't switched on yet. Use your email and a password for now."
const ERROR_PARAMS = ['error', 'error_code', 'error_description']

/**
 * Before anything else starts: puts back the #route kept before leaving for GitHub, and takes a failed sign-in's
 * ?error off the address (the client would otherwise trip over it). ?code stays for the client. Returns what to say
 * about a sign-in that didn't finish.
 */
export function takeReturnedUrl(
  loc: Pick<Location, 'pathname' | 'search' | 'hash'>,
  store: Pick<Storage, 'getItem' | 'removeItem'>,
  replace: (url: string) => void,
): string | undefined {
  const params = new URLSearchParams(loc.search)
  const hashParams = /^#[^/]/.test(loc.hash) ? new URLSearchParams(loc.hash.slice(1)) : null
  const failed = ERROR_PARAMS.some((p) => params.has(p) || hashParams?.has(p))
  const saved = store.getItem(RETURN_KEY)
  if (saved === null && !failed) return undefined
  store.removeItem(RETURN_KEY)
  // a failed sign-in's leftovers mean nothing to the client: it would try them and fail again
  if (failed) for (const p of [...ERROR_PARAMS, 'code', 'sb_flow_id']) params.delete(p)
  const blank = loc.hash === '' || loc.hash === '#' || loc.hash === '#/' || !!hashParams
  const hash = blank ? (saved?.startsWith('#/') ? saved : '#/') : loc.hash
  const search = params.toString()
  replace(`${loc.pathname}${search ? `?${search}` : ''}${hash}`)
  return failed ? GITHUB_UNFINISHED : undefined
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password don't match. Check them and try again.",
  user_already_exists: "There's already an account with this email. Sign in instead.",
  email_exists: "There's already an account with this email. Sign in instead.",
  weak_password: 'Pick a longer password: at least 8 characters.',
  email_address_invalid: "That email address doesn't look right.",
  validation_failed: "That email address doesn't look right.",
  email_not_confirmed: 'Open the link we emailed you first, then sign in.',
  over_request_rate_limit: 'Too many tries in a short time. Wait a minute and try again.',
  over_email_send_rate_limit: 'Too many tries in a short time. Wait a minute and try again.',
  signup_disabled: "New accounts can't be created right now. Ask whoever looks after Sprawniej.",
}

/** what to say when signing in or up fails */
export function friendlyAuthError(e: unknown): string {
  if (e instanceof AuthProblem) return e.message
  const err = (e ?? {}) as { name?: unknown; code?: unknown; status?: unknown }
  if (typeof err.code === 'string' && MESSAGES[err.code]) return MESSAGES[err.code]
  if (isUnreachable(e) || err.status === 0) return UNREACHABLE
  return 'Something went wrong while signing in. Try again in a moment.'
}

const toUser = (u: User | null | undefined): AuthUser | null =>
  u
    ? {
        id: u.id,
        email: u.email ?? null,
        name: String(u.user_metadata?.full_name ?? u.user_metadata?.name ?? ''),
        avatarUrl: String(u.user_metadata?.avatar_url ?? ''),
      }
    : null

/** this tab is signing out on purpose and reloads by itself */
let leaving = false
/** the last person signed in here, also while `lost` (so signing in as someone else starts over) */
let lastUserId: string | null = null
let started = false

/** everyone's state back to empty, then a fresh start on the sign-in screen */
function startOver() {
  if (leaving) return
  leaving = true
  // nothing of the last person may be kept again while the page goes
  stopCaching()
  useSession.getState().signOut()
  location.hash = '#/'
  location.reload()
}

const deliberate = () => Date.now() - Number(localStorage.getItem(SIGNING_OUT) ?? 0) < 10_000

function setUser(user: AuthUser | null, more: Partial<AuthState> = {}) {
  if (user) lastUserId = user.id
  useAuth.setState({ user, ...more })
}

function onAuthEvent(event: AuthChangeEvent, session: AuthSession | null) {
  const user = toUser(session?.user)
  const was = useAuth.getState()
  switch (event) {
    case 'SIGNED_IN':
      if (!user) break
      // someone else signed in (here, or in another tab): nothing of the last person's may stay on screen
      if (lastUserId && lastUserId !== user.id) return startOver()
      localStorage.removeItem(SIGNING_OUT)
      setUser(user, { lost: false, urlProblem: undefined })
      break
    case 'SIGNED_OUT':
      if (leaving) return
      // "Sign out" in another tab: the client tells every tab, and the mark says it was on purpose
      if (deliberate()) return startOver()
      setUser(null, { lost: was.user !== null || was.lost })
      break
    case 'TOKEN_REFRESHED':
    case 'USER_UPDATED':
      if (user) setUser(user)
      break
    // the first state comes from getSession() in startAuth; the rest (password recovery, MFA) isn't used yet
    default:
      break
  }
}

/** once at start, if the app is set up: follows the sign-in from then on */
export function startAuth(urlProblem?: string): void {
  if (started) return
  started = true
  const db = getClient()
  if (!db) return
  if (urlProblem) useAuth.setState({ urlProblem })
  if (!deliberate()) localStorage.removeItem(SIGNING_OUT)
  const cameBack = new URL(location.href).searchParams.has('code')
  // the client's own calls must not be awaited inside its callback (they wait for each other), so work comes after it
  db.auth.onAuthStateChange((event, session) => {
    setTimeout(() => onAuthEvent(event, session), 0)
  })
  const settle = (signedIn: AuthUser | null) => {
    setUser(signedIn, { ready: true })
    // the client takes ?code off once it turned it into a sign-in; one still there didn't work (or wasn't for us)
    const url = new URL(location.href)
    if (!url.searchParams.has('code')) return
    url.searchParams.delete('code')
    url.searchParams.delete('sb_flow_id')
    history.replaceState(history.state, '', url.toString())
    if (cameBack && !signedIn) useAuth.setState({ urlProblem: GITHUB_UNFINISHED })
  }
  db.auth.getSession().then(
    ({ data }) => settle(toUser(data.session?.user)),
    // the stored sign-in can't be read: start signed out
    () => settle(null),
  )
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new AuthProblem(friendlyAuthError(error))
}

/** 'check-email' when new accounts have to open an emailed link first */
export async function signUpWithPassword(email: string, password: string): Promise<'signed-in' | 'check-email'> {
  const { data, error } = await requireClient().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirectUrl() } })
  if (error) throw new AuthProblem(friendlyAuthError(error))
  return data.session ? 'signed-in' : 'check-email'
}

let github: Promise<'on' | 'off' | 'unknown'> | undefined

/** whoever looks after Sprawniej has switched GitHub sign-in on ('unknown': Sprawniej can't be reached to ask) */
export function githubAvailable(): Promise<'on' | 'off' | 'unknown'> {
  const config = backendConfig()
  if (!config) return Promise.resolve('off')
  github ??= fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.key } })
    .then((r) => (r.ok ? (r.json() as Promise<{ external?: Record<string, unknown> }>) : Promise.reject(new Error(String(r.status)))))
    .then((s) => (s.external?.github === true ? 'on' : 'off'))
    .catch(() => {
      github = undefined // not known: ask again next time
      return 'unknown'
    })
  return github
}

/** leaves for GitHub and comes back signed in */
export async function signInWithGitHub(): Promise<void> {
  const available = await githubAvailable()
  if (available !== 'on') throw new AuthProblem(available === 'off' ? GITHUB_OFF : UNREACHABLE)
  sessionStorage.setItem(RETURN_KEY, location.hash || '#/')
  const { error } = await requireClient().auth.signInWithOAuth({ provider: 'github', options: { redirectTo: authRedirectUrl() } })
  if (error) {
    sessionStorage.removeItem(RETURN_KEY)
    throw new AuthProblem(friendlyAuthError(error))
  }
}

/**
 * Signs out in this browser only (other devices stay signed in). The mark goes first: the client tells the other
 * tabs as it signs out, and they read the mark to know it was on purpose (then they start over too).
 */
export async function signOutLocally(): Promise<void> {
  leaving = true
  // nothing of the last person may be kept again while the page goes
  stopCaching()
  localStorage.setItem(SIGNING_OUT, String(Date.now()))
  const db = getClient()
  // the sign-in is forgotten here even when Sprawniej can't be reached (it only fails to end it there too)
  if (db) await db.auth.signOut({ scope: 'local' }).catch(() => {})
  useAuth.setState({ user: null, lost: false })
}
