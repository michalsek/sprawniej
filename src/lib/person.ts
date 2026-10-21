/** Initials and a stable colour for people without a picture, and telling whether two names are the same person. */
import { plainName } from './plain'

export function initials(name: string): string {
  // words that start with a letter or digit ("Zoë "Z" O'Neil 🚀" → ZO); whole characters, never half an emoji
  const parts = name.trim().split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+/u, '')).filter(Boolean)
  if (!parts.length) return '?'
  const first = (w: string) => Array.from(w)[0]
  return (parts.length === 1 ? Array.from(parts[0]).slice(0, 2).join('') : first(parts[0]) + first(parts[parts.length - 1])).toUpperCase()
}

export function personColor(login: string): string {
  let h = 0
  for (const ch of login.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  // one lightness and a gentle chroma for every hue: inside what a screen shows, and white initials read on all of
  // them (4.5:1, tests/person.test.ts)
  return `oklch(54% 0.09 ${h % 360})`
}

/** probably the same person: the same name, or an @handle that is their name */
export function sameName(name: string, other: { login: string; handle?: string; name?: string | null }): boolean {
  const n = plainName(name)
  return !!n && ((!!other.name && plainName(other.name) === n) || plainName(other.handle ?? other.login) === n)
}
