/** Words and small rules for invite links in Settings. Pure. */
import type { Invite } from '@/backend/workspaces'

/** who a link is for, as its row's title */
export function linkTitle(i: Pick<Invite, 'maxUses' | 'forEmail'>, guestName?: string): string {
  if (guestName) return `For ${guestName}, from Linear`
  if (i.maxUses === null) return 'Anyone with the link'
  if (i.maxUses > 1) return `Up to ${i.maxUses} people`
  return i.forEmail ? `For ${i.forEmail}` : 'For one person'
}

/** what someone typed, as a whole number from `min` to `max`; null when it isn't one */
export function wholeIn(text: string, min: number, max: number): number | null {
  const t = text.trim()
  if (!/^\d{1,4}$/.test(t)) return null
  const n = Number(t)
  return n >= min && n <= max ? n : null
}
