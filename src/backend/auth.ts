/**
 * Signing in: with an email and a password, or with GitHub. The database client keeps the sign-in in this browser
 * and renews it by itself; this follows what it says and puts it in words people understand.
 *
 * GitHub sign-in leaves the page and comes back to it (authRedirectUrl) with ?code, which the client turns into a
 * sign-in when it starts. The #route you were on is kept in sessionStorage meanwhile and put back first thing.
 */
import type { AuthChangeEvent, Session as AuthSession, User, UserIdentity } from '@supabase/supabase-js'
import { create } from 'zustand'
import { authRedirectUrl } from '@/config'
import { parseTheme, type ThemeChoice } from '@/lib/theme'
import { useSession } from '@/session'
import { stopCaching } from './cacheStore'
import { backendConfig, getClient, requireClient, type Db } from './client'
import { friendlyDbError, isUnreachable, UNREACHABLE } from './problem'

export interface AuthUser {
  id: string
  email: string | null
  name: string
  avatarUrl: string
  /** Light or dark, kept with the account so it follows you (src/lib/theme.ts); undefined when never picked */
  theme?: ThemeChoice
  /** when the account last changed: an older copy of you never replaces a newer one (setUser) */
  updatedAt?: string
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
  // what went wrong, when it's something we can say better (a GitHub account that belongs to someone else)
  const code = params.get('error_code') ?? hashParams?.get('error_code')
  const saved = store.getItem(RETURN_KEY)
  if (saved === null && !failed) return undefined
  store.removeItem(RETURN_KEY)
  // a failed sign-in's leftovers mean nothing to the client: it would try them and fail again
  if (failed) for (const p of [...ERROR_PARAMS, 'code', 'sb_flow_id']) params.delete(p)
  const blank = loc.hash === '' || loc.hash === '#' || loc.hash === '#/' || !!hashParams
  const hash = blank ? (saved?.startsWith('#/') ? saved : '#/') : loc.hash
  const search = params.toString()
  replace(`${loc.pathname}${search ? `?${search}` : ''}${hash}`)
  if (!failed) return undefined
  return messageFor(code) ?? GITHUB_UNFINISHED
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
  same_password: "That's the password you have now. Pick a new one.",
  identity_already_exists:
    'This GitHub account already belongs to another Sprawniej account. Sign in with GitHub to use that one, or add a different GitHub account.',
  single_identity_not_deletable: "It's your only way to sign in, so it can't be removed.",
  manual_linking_disabled: "Adding another way to sign in isn't switched on yet. Ask whoever looks after Sprawniej.",
}

/**
 * The invite link can't make an account (it was used, ended, is full or expired). The join page then asks the link
 * how it stands and says exactly why.
 */
export const INVITE_REFUSED = 'This invite link was already used or has expired. Ask for a new one.'
/** a link for several people is open, but every place is held by an account that is still being made */
export const INVITE_NO_PLACES = 'This invite link has no places left right now. Ask for a new one.'

/**
 * Why a new account wasn't let in (private.let_in, last in supabase/migrations/20261021130000_shared_invite_links.sql).
 * They come back as the error's message; a test checks this list against the SQL.
 */
export const SIGNUP_REFUSALS: ReadonlySet<string> = new Set([
  INVITE_REFUSED,
  INVITE_NO_PLACES,
  'You need a sign-up code to make an account. Ask whoever looks after Sprawniej for one.',
  "That sign-up code doesn't work. Check it and try again.",
  'That sign-up code no longer works. Ask whoever looks after Sprawniej for a new one.',
  'That sign-up code has been used up. Ask whoever looks after Sprawniej for a new one.',
])

/** our words for a code, which may come from the address bar ("constructor" isn't one of ours) */
const messageFor = (code: unknown): string | undefined => (typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined)

/** what to say when signing in or up fails */
export function friendlyAuthError(e: unknown): string {
  if (e instanceof AuthProblem) return e.message
  const err = (e ?? {}) as { name?: unknown; code?: unknown; status?: unknown; message?: unknown }
  if (typeof err.message === 'string' && SIGNUP_REFUSALS.has(err.message)) return err.message
  const known = messageFor(err.code)
  if (known) return known
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
        theme: u.user_metadata?.theme === undefined ? undefined : parseTheme(u.user_metadata.theme),
        updatedAt: u.updated_at,
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

/** a copy of the same person from before a change that already arrived (the sign-in kept in this browser, say) */
export const older = (a: AuthUser, b: AuthUser | null): boolean =>
  !!b && a.id === b.id && !!a.updatedAt && !!b.updatedAt && Date.parse(a.updatedAt) < Date.parse(b.updatedAt)

function setUser(user: AuthUser | null, more: Partial<AuthState> = {}) {
  const now = useAuth.getState().user
  // it would undo what's newer, like a light or dark you just saved
  if (user && older(user, now)) user = now
  if (user) {
    lastUserId = user.id
    // after a reload nobody is in memory: the remembered workspaces say whose they are
    useSession.getState().signedInAs(user.id)
  }
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
  // The kept sign-in's copy of you can be an hour old (a light or dark picked on another device since), and the
  // client hands it out again on every sign-in event. Renewing once keeps a fresh copy; it comes as TOKEN_REFRESHED.
  // Offline, the kept copy stays until the client renews by itself.
  const refresh = (signedIn: AuthUser | null) => {
    if (signedIn) db.auth.refreshSession().catch(() => {})
  }
  db.auth.getSession().then(
    ({ data }) => {
      const signedIn = toUser(data.session?.user)
      settle(signedIn)
      refresh(signedIn)
    },
    // the stored sign-in can't be read: start signed out
    () => settle(null),
  )
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new AuthProblem(friendlyAuthError(error))
}

/** what lets a new account in: a sign-up code, or the invite link it came from */
export interface SignUpPermit {
  code?: string
  invite?: string
}

/** 'check-email' when new accounts have to open an emailed link first */
export async function signUpWithPassword(email: string, password: string, permit: SignUpPermit): Promise<'signed-in' | 'check-email'> {
  const meta = { signup_code: permit.code?.trim() || undefined, invite: permit.invite || undefined }
  const { data, error } = await requireClient().auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: authRedirectUrl(), data: meta },
  })
  if (error) throw new AuthProblem(friendlyAuthError(error))
  return data.session ? 'signed-in' : 'check-email'
}

// ---------- sign-up codes after GitHub ----------

/** a sign-up code typed before leaving for GitHub, so the name step can fill it in when you come back */
export const CODE_KEY = 'sprawniej:signup-code'

/**
 * A new account made with GitHub has no code yet (GitHub can't carry one): it gets no name until it gives one. True
 * while that's still to do.
 */
export async function signupCodeNeeded(): Promise<boolean> {
  const { data, error } = await requireClient().rpc('signup_code_needed')
  if (error) throw error
  return data === true
}

/** lets your new account in with a sign-up code or the invite link you came from; throws an Error to show as it is */
export async function giveSignupCode(permit: SignUpPermit): Promise<void> {
  const { error } = await requireClient().rpc('use_signup_code', { p_code: permit.code?.trim() || undefined, p_invite: permit.invite || undefined })
  if (!error) {
    sessionStorage.removeItem(CODE_KEY)
    return
  }
  throw new AuthProblem(friendlyDbError(error, "We couldn't check your sign-up code. Try again in a moment."))
}

export interface Providers {
  github: boolean
  google: boolean
}

let settings: Promise<Providers | 'unknown'> | undefined

/** which ways to sign in whoever looks after Sprawniej has switched on ('unknown': Sprawniej can't be reached to ask) */
export function providersOn(): Promise<Providers | 'unknown'> {
  const config = backendConfig()
  if (!config) return Promise.resolve({ github: false, google: false })
  settings ??= fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.key } })
    .then((r) => (r.ok ? (r.json() as Promise<{ external?: Record<string, unknown> }>) : Promise.reject(new Error(String(r.status)))))
    .then((s): Providers => ({ github: s.external?.github === true, google: s.external?.google === true }))
    .catch(() => {
      settings = undefined // not known: ask again next time
      return 'unknown' as const
    })
  return settings
}

/** whoever looks after Sprawniej has switched GitHub sign-in on ('unknown': Sprawniej can't be reached to ask) */
export function githubAvailable(): Promise<'on' | 'off' | 'unknown'> {
  return providersOn().then((p) => (p === 'unknown' ? 'unknown' : p.github ? 'on' : 'off'))
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

// ---------- ways to sign in (Settings › Ways to sign in) ----------

/** set while you're away at GitHub to add it as a way to sign in; Settings reads it when you come back */
export const ADDING_KEY = 'sprawniej:adding-way'

/** what signInWays needs of an identity (the client's own UserIdentity has these) */
export type IdentityIn = Pick<UserIdentity, 'identity_id' | 'provider'> & { identity_data?: Record<string, unknown> }

export interface WayRow {
  kind: 'password' | 'github' | 'google'
  on: boolean
  /** the email, "@octocat", or "" */
  detail: string
  action: 'set-password' | 'change-password' | 'add' | 'remove' | null
  /** shown when there's nothing to do with it */
  why?: string
  identityId?: string
}

const ONLY_WAY = "It's your only way to sign in."
const SIGNED_UP_WITH: Record<'github' | 'google', string> = {
  github: "You made your account with GitHub, so it can't be removed.",
  google: "You made your account with Google, so it can't be removed.",
}
/** Sprawniej couldn't say which ways are switched on */
const NOT_KNOWN = "We couldn't check this just now. Try again later."
const OFF: Record<'github' | 'google', string> = {
  github: "Signing in with GitHub isn't switched on yet.",
  google: "Signing in with Google isn't switched on yet.",
}

/** which ways to sign in you have, and what you can do with each (pure, tested) */
export function signInWays(u: { email: string | null; identities: IdentityIn[]; passwordSet: boolean }, p: Providers): WayRow[] {
  const has = (provider: string) => u.identities.find((i) => i.provider === provider)
  const password: WayRow = !u.email
    ? { kind: 'password', on: false, detail: '', action: null, why: "Your account has no email address, so a password can't be added." }
    : has('email') || u.passwordSet
      ? { kind: 'password', on: true, detail: u.email, action: 'change-password' }
      : { kind: 'password', on: false, detail: u.email, action: 'set-password' }
  const other = (kind: 'github' | 'google'): WayRow => {
    const i = has(kind)
    if (i) {
      const handle = kind === 'github' ? i.identity_data?.user_name : i.identity_data?.email
      const detail = typeof handle === 'string' ? (kind === 'github' ? `@${handle}` : handle) : ''
      // the email identity is never offered for removal; GitHub or Google only when there is another way left. A
      // password set later isn't a way of its own to Sprawniej's sign-in (no email identity), so the first one stays.
      if (u.identities.length >= 2) return { kind, on: true, detail, action: 'remove', identityId: i.identity_id }
      return { kind, on: true, detail, action: null, why: u.passwordSet ? SIGNED_UP_WITH[kind] : ONLY_WAY, identityId: i.identity_id }
    }
    return p[kind] ? { kind, on: false, detail: '', action: 'add' } : { kind, on: false, detail: '', action: null, why: OFF[kind] }
  }
  return [password, other('github'), ...(p.google || has('google') ? [other('google')] : [])]
}

/** your ways to sign in, fresh from Sprawniej */
export async function waysToSignIn(): Promise<WayRow[]> {
  const [{ data, error }, providers] = await Promise.all([requireClient().auth.getUser(), providersOn()])
  if (error) throw new AuthProblem(friendlyAuthError(error))
  const u = data.user
  const ways = signInWays(
    { email: u.email || null, identities: u.identities ?? [], passwordSet: u.user_metadata?.password_set === true },
    providers === 'unknown' ? { github: false, google: false } : providers,
  )
  // the password still works; whether GitHub can be added isn't known
  return providers === 'unknown' ? ways.map((w) => (w.kind !== 'password' && w.action === null && !w.on ? { ...w, why: NOT_KNOWN } : w)) : ways
}

/** sets or changes your password (no Save button: it's the dialog's own form) */
export async function setPassword(password: string): Promise<void> {
  const { error } = await requireClient().auth.updateUser({ password, data: { password_set: true } })
  if (error) throw new AuthProblem(friendlyAuthError(error))
}

/** keeps your light or dark with your account (the rest of what it keeps, like your name, stays as it is) */
export async function saveTheme(theme: ThemeChoice, db: Db = requireClient()): Promise<void> {
  const { error } = await db.auth.updateUser({ data: { theme } })
  if (error) throw new AuthProblem(friendlyAuthError(error))
}

/** leaves for GitHub (or Google) and comes back with it added as a way to sign in */
export async function addWay(provider: 'github' | 'google'): Promise<void> {
  const p = await providersOn()
  if (p === 'unknown') throw new AuthProblem(UNREACHABLE)
  if (!p[provider]) throw new AuthProblem(provider === 'github' ? GITHUB_OFF : OFF.google)
  sessionStorage.setItem(RETURN_KEY, location.hash || '#/settings/account/sign-in')
  sessionStorage.setItem(ADDING_KEY, provider)
  const { error } = await requireClient().auth.linkIdentity({ provider, options: { redirectTo: authRedirectUrl() } })
  if (error) {
    sessionStorage.removeItem(RETURN_KEY)
    sessionStorage.removeItem(ADDING_KEY)
    throw new AuthProblem(friendlyAuthError(error))
  }
}

export async function removeWay(identityId: string): Promise<void> {
  const db = requireClient()
  const { data, error } = await db.auth.getUserIdentities()
  if (error) throw new AuthProblem(friendlyAuthError(error))
  const identity = data.identities.find((i) => i.identity_id === identityId)
  if (!identity) return
  const { error: unlinkError } = await db.auth.unlinkIdentity(identity)
  if (unlinkError) throw new AuthProblem(friendlyAuthError(unlinkError))
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
