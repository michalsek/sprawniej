/** Invite links: reading one from the address, making the one to send, and which join screen to show. Pure. */
import type { InviteInfo } from '@/backend/workspaces'
import { authRedirectUrl, publicAppUrl } from '@/config'

/** "/join/<hex token>" → { token }; the older "/join/<owner>/<repo>" links → 'old'; anything else → null */
export function readInvitePath(path: string): { token: string } | 'old' | null {
  const m = path.match(/^\/join\/([0-9a-f]{16,128})\/?$/i)
  if (m) return { token: m[1].toLowerCase() }
  if (/^\/join\/[\w.-]+\/[\w.-]+/.test(path)) return 'old'
  return null
}

/** the link to send: the published address, or this computer's (`local`: it only works here) */
export function inviteUrl(token: string): { url: string; local: boolean } {
  const published = publicAppUrl()
  return { url: `${published ?? authRedirectUrl()}#/join/${token}`, local: published === null }
}

/** a ready-to-send message ("Hi Jan! …") */
export function inviteMessage(url: string, workspace: string, forName?: string | null): string {
  const first = forName?.trim().split(/\s+/)[0]
  return `${first ? `Hi ${first}!` : 'Hi!'} We plan and track our work in Sprawniej. Open this link to join ${workspace}. It works once, in the next 14 days:\n${url}`
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
