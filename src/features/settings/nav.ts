/**
 * The rules of the settings pages, without React: which group a page is in, who may open it, which ones the menu and
 * ⌘K list, and what an address under #/settings opens. The pages themselves are listed in pages.tsx.
 */
import type { DataState } from '@/data/store'

export type SettingsGroup = 'account' | 'workspace'

/** the menu's groups, in this order */
export const GROUPS: { id: SettingsGroup; title: string }[] = [
  { id: 'account', title: 'Your account' },
  { id: 'workspace', title: 'Workspace' },
]

interface PageBase {
  id: string
  group: SettingsGroup
  /** its address, e.g. '/settings/workspace/members' */
  path: string
  /** in the menu, the crumbs, the page heading and ⌘K ("Settings › Members") */
  title: string
  /** the line under the heading */
  description?: string
  /** keep it out of the menu and ⌘K while there's nothing in it (the address still opens) */
  listed?: (s: DataState) => boolean
  /** older addresses that open this page */
  oldPaths?: string[]
  /** more words ⌘K matches ("people roles" for Members) */
  words?: string
  /** draws its own heading and scroll (the import wizard) */
  ownLayout?: boolean
}

/** a page for admins and owners says what a member who opens it reads, under "Only admins and owners can …" */
export type PageMeta = PageBase & ({ who: 'everyone' } | { who: 'admins'; forMembers: { title: string; text: string } })

export const isSettingsPath = (loc: string) => loc === '/settings' || loc.startsWith('/settings/')

/** whether you may open a page: admins-only pages are for admins and owners */
const canSee = (p: PageMeta, admin: boolean): boolean => p.who === 'everyone' || admin

/** the pages the settings menu and ⌘K list for you, in order */
export function listedPages<P extends PageMeta>(pages: P[], admin: boolean, s: DataState): P[] {
  return pages.filter((p) => canSee(p, admin) && (p.listed?.(s) ?? true))
}

/** what an address opens: somewhere else (`to`), a page (and whether you may see it), or nothing */
export type Resolved<P> = { to: string } | { page: P; allowed: boolean } | { missing: true }

export function resolveSettings<P extends PageMeta>(loc: string, pages: P[], admin: boolean): Resolved<P> {
  // Settings itself opens the first page you may see
  if (loc === '/settings' || loc === '/settings/') {
    const first = pages.find((p) => canSee(p, admin)) ?? pages[0]
    return first ? { to: first.path } : { missing: true }
  }
  if (loc.length > 1 && loc.endsWith('/')) return { to: loc.replace(/\/+$/, '') }
  const page = pages.find((p) => p.path === loc)
  if (page) return { page, allowed: canSee(page, admin) }
  const moved = pages.find((p) => p.oldPaths?.includes(loc))
  return moved ? { to: moved.path } : { missing: true }
}

/** where "Back to Sprawniej" goes: the last page outside Settings, or Home when that page's team was deleted meanwhile */
export function backTo(last: string, teams: Record<string, unknown>): string {
  const team = /^\/team\/([^/]+)/.exec(last)?.[1]
  return team && !teams[team] ? '/' : last
}
