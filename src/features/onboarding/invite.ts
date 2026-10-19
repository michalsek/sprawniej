/** Invite links: reading one from the address, making the one to send, and which join screen to show. Pure. */
import { INVITE_DAYS, type InviteInfo } from '@/backend/workspaces'
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

/** a ready-to-send message ("Hi Jan! …") */
export function inviteMessage(url: string, workspace: string, forName?: string | null): string {
  const first = forName?.trim().split(/\s+/)[0]
  return `${first ? `Hi ${first}!` : 'Hi!'} We plan and track our work in Sprawniej. Open this link to join ${workspace}. It works once, in the next ${INVITE_DAYS} days:\n${url}`
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

export type JoinStage = 'loading' | 'failed' | 'unknown' | 'used' | 'expired' | 'member' | 'welcome' | 'account' | 'profile' | 'name' | 'joining'

export function joinStage(i: {
  info: InviteInfo | null | undefined
  failed: boolean
  signedIn: boolean
  profile: 'loading' | 'failed' | 'none' | 'ready'
  pressedJoin: boolean
}): JoinStage {
  if (i.failed) return 'failed'
  if (i.info === undefined) return 'loading'
  if (i.info === null) return 'unknown'
  if (i.info.state !== 'open') return i.info.state
  if (!i.pressedJoin) return 'welcome'
  if (!i.signedIn) return 'account'
  if (i.profile === 'loading' || i.profile === 'failed') return 'profile'
  if (i.profile === 'none') return 'name'
  return 'joining'
}
