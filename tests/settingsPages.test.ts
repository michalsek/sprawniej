import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY, type DataState } from '@/data/store'
import { WORKSPACE_PAGE } from '@/features/onboarding/workspacePage'
import { backTo, GROUPS, isSettingsPath, listedPages, resolveSettings } from '@/features/settings/nav'
import { PAGES } from '@/features/settings/pages'

const ids = (list: { id: string }[]) => list.map((p) => p.id)
const page = (id: string) => PAGES.find((p) => p.id === id)!
const withPeople = (...logins: string[]): DataState => ({
  ...EMPTY,
  people: Object.fromEntries(logins.map((login) => [login, { login, githubId: 0, name: login, avatarUrl: '' }])),
})

describe('the list of settings pages', () => {
  test('every page has its own address under /settings/, a known group and its own id', () => {
    const paths = PAGES.flatMap((p) => [p.path, ...(p.oldPaths ?? [])])
    expect(new Set(paths).size).toBe(paths.length)
    expect(new Set(ids(PAGES)).size).toBe(PAGES.length)
    const groups = GROUPS.map((g) => g.id)
    for (const p of PAGES) {
      expect(p.path).toMatch(/^\/settings\/(account|workspace)(\/[a-z0-9-]+)*$/)
      expect(groups).toContain(p.group)
      expect(p.title.trim()).not.toBe('')
    }
  })

  test('no em dashes in what the pages say', () => {
    for (const p of PAGES) {
      const members = p.who === 'admins' ? [p.forMembers.title, p.forMembers.text] : []
      expect([p.title, p.description, ...members].join(' ')).not.toContain('—')
    }
  })

  // links to settings pages are written out by hand around the app: each must open a page where it is now
  test('every settings address written in the app opens a page', () => {
    const src = join(import.meta.dir, '..', 'src')
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f))
    const found = files.flatMap((f) => [...readFileSync(join(src, f), 'utf8').matchAll(/['"`]#?(\/settings(?:\/[a-z0-9-]+)*)['"`]/g)].map((m) => ({ f, path: m[1] })))
    expect(found.length).toBeGreaterThan(5)
    for (const { f, path } of found) {
      const r = resolveSettings(path, PAGES, true)
      const ok = path === '/settings' || ('page' in r && r.page.path === path) || (f.endsWith('pages.tsx') && 'to' in r)
      expect({ f, path, ok }).toEqual({ f, path, ok: true })
    }
  })
})

describe('what an address under Settings opens', () => {
  test('Settings itself opens the first page', () => {
    expect(resolveSettings('/settings', PAGES, false)).toEqual({ to: PAGES[0].path })
    expect(resolveSettings('/settings', PAGES, true)).toEqual({ to: '/settings/account' })
    expect(resolveSettings('/settings/', PAGES, true)).toEqual({ to: '/settings/account' })
  })

  test('older addresses open where the page is now', () => {
    for (const p of PAGES) for (const old of p.oldPaths ?? []) expect(resolveSettings(old, PAGES, true)).toEqual({ to: p.path })
    // bookmarks from before the pages were split
    expect(resolveSettings('/settings/import', PAGES, true)).toEqual({ to: '/settings/workspace/import' })
  })

  test('a slash at the end goes, and an unknown address is missing', () => {
    expect(resolveSettings('/settings/workspace/members/', PAGES, false)).toEqual({ to: '/settings/workspace/members' })
    expect(resolveSettings('/settings/whatever', PAGES, true)).toEqual({ missing: true })
    expect(resolveSettings('/settings/workspace/nope', PAGES, true)).toEqual({ missing: true })
  })

  test('every page opens at its address; members may not open the admins pages', () => {
    for (const p of PAGES) expect(resolveSettings(p.path, PAGES, true)).toEqual({ page: p, allowed: true })
    expect(resolveSettings('/settings/workspace/invites', PAGES, false)).toEqual({ page: page('invites'), allowed: false })
    expect(resolveSettings('/settings/workspace/import', PAGES, false)).toEqual({ page: page('import'), allowed: false })
    expect(resolveSettings('/settings/workspace/members', PAGES, false)).toEqual({ page: page('members'), allowed: true })
  })

  test('only Settings counts as Settings', () => {
    expect(isSettingsPath('/settings')).toBe(true)
    expect(isSettingsPath('/settings/workspace/labels')).toBe(true)
    expect(isSettingsPath('/settingsx')).toBe(false)
    expect(isSettingsPath('/team/ENG/issues')).toBe(false)
  })
})

describe('what the settings menu and ⌘K list', () => {
  test('members don’t see the pages for admins and owners; admins see them all', () => {
    const s = withPeople('ana', '~linear-ola')
    expect(ids(listedPages(PAGES, true, s))).toEqual(ids(PAGES))
    const member = ids(listedPages(PAGES, false, s))
    expect(member).not.toContain('invites')
    expect(member).not.toContain('import')
    expect(member).toContain('members')
    expect(member).toContain('general')
  })

  test('People from Linear is listed only while someone from Linear hasn’t joined', () => {
    expect(ids(listedPages(PAGES, true, withPeople('ana')))).not.toContain('linear-people')
    expect(ids(listedPages(PAGES, true, withPeople('ana', '~linear-ola')))).toContain('linear-people')
    // the address opens anyway
    expect(resolveSettings('/settings/workspace/linear-people', PAGES, false)).toEqual({ page: page('linear-people'), allowed: true })
  })
})

describe('a link to a settings page opened before choosing a workspace', () => {
  test('is kept while you choose', () => {
    for (const p of PAGES) expect(WORKSPACE_PAGE.test(p.path)).toBe(true)
    expect(WORKSPACE_PAGE.test('/settings')).toBe(true)
    expect(WORKSPACE_PAGE.test('/settings/import')).toBe(true)
    expect(WORKSPACE_PAGE.test('/settingsx')).toBe(false)
    expect(WORKSPACE_PAGE.test('/settings/<script>')).toBe(false)
  })
})

describe('Back to Sprawniej', () => {
  test('goes to the last page outside Settings, or Home when its team is gone', () => {
    const teams = { ENG: {} }
    expect(backTo('/team/ENG/issues/active', teams)).toBe('/team/ENG/issues/active')
    expect(backTo('/team/OLD/issues/active', teams)).toBe('/')
    expect(backTo('/inbox', teams)).toBe('/inbox')
  })
})
