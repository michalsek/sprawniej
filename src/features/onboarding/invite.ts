/** Invite links: reading one from the address, making the one to send, and which join screen to show. Pure. */
import type { InviteInfo } from '@/backend/workspaces'
import { authRedirectUrl, publicAppUrl } from '@/config'

const TOKEN = /^[0-9a-f]{16,128}$/

/**
 * "/join/<hex token>" → { token }; the older "/join/<owner>/<repo>" links → 'old'; any other "/join/…" → an invite
 * whose token is null (it doesn't work); anything else → null. Spaces around the token and a ?query after it go.
 */
export function readInvitePath(path: string): { token: string | null } | 'old' | null {
  if (!/^\/join(\/|$)/.test(path)) return null
  const rest = path.slice('/join'.length).split(/[?#]/)[0]
  const parts = rest.split('/').filter(Boolean)
  if (parts.length >= 2 && /^[\w.-]+$/.test(parts[0]) && /^[\w.-]+$/.test(parts[1])) return 'old'
  let raw = parts[0] ?? ''
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // not encoded properly: as it is
  }
  const token = raw.trim().toLowerCase()
  return { token: parts.length === 1 && TOKEN.test(token) ? token : null }
}

/** the link to send: the published address, or this computer's (`local`: it only works here) */
export function inviteUrl(token: string): { url: string; local: boolean } {
  const published = publicAppUrl()
  return { url: `${published ?? authRedirectUrl()}#/join/${token}`, local: published === null }
}

/** "Saturday 31 October", in this computer's time zone */
const untilDay = (at: string) => new Date(at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

/**
 * A ready-to-send message ("Hi Jan! …"). `forName`: the person from Linear it is for; `shared`: a link for several
 * people or anyone, so it isn't "just for you".
 */
export function inviteMessage(url: string, workspace: string, o: { forName?: string | null; expiresAt: string; shared?: boolean }): string {
  const first = o.forName?.trim().split(/\s+/)[0]
  const works = o.shared ? 'It works' : "It's just for you and works"
  return `${first ? `Hi ${first}!` : 'Hi!'} We plan and track our work in Sprawniej. Open this link to join ${workspace}. ${works} until ${untilDay(o.expiresAt)}:\n${url}`
}

/** "Ania, Tomek and 4 others are here." (invite_info shows up to 8, so 8 may mean more) */
export function peopleLine(names: readonly string[], most = 8): string {
  const [a, b, c] = names
  if (!a) return ''
  if (!b) return `${a} is here.`
  if (names.length === 2) return `${a} and ${b} are here.`
  if (names.length === 3) return `${a}, ${b} and ${c} are here.`
  const rest = names.length - 2
  return `${a}, ${b} and ${names.length >= most ? 'others' : `${rest} others`} are here.`
}

/** sessionStorage: the invite you pressed Join for (it outlasts a trip to GitHub to sign in) */
export const JOINING_KEY = 'sprawniej:joining'

export type JoinStage =
  | 'loading'
  | 'failed'
  | 'unknown'
  | 'used'
  | 'ended'
  | 'full'
  | 'expired'
  | 'left'
  | 'no-places'
  | 'member'
  | 'welcome'
  | 'account'
  | 'profile'
  | 'name'
  | 'joining'

/**
 * `noPlaces`: making an account with the link was refused because accounts still being made hold all its places. The
 * link itself reads open, so only that refusal tells.
 */
export function joinStage(i: {
  info: InviteInfo | null | undefined
  failed: boolean
  signedIn: boolean
  profile: 'loading' | 'failed' | 'none' | 'ready'
  pressedJoin: boolean
  noPlaces?: boolean
}): JoinStage {
  if (i.failed) return 'failed'
  if (i.info === undefined) return 'loading'
  if (i.info === null) return 'unknown'
  if (i.info.state !== 'open') return i.info.state
  if (!i.pressedJoin) return 'welcome'
  if (!i.signedIn) return i.noPlaces ? 'no-places' : 'account'
  if (i.profile === 'loading' || i.profile === 'failed') return 'profile'
  if (i.profile === 'none') return i.noPlaces ? 'no-places' : 'name'
  return 'joining'
}
