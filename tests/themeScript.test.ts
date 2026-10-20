import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEVICE_KEY, resolveTheme, THEME_COLORS, type Resolved } from '@/lib/theme'

// index.html puts light or dark on the page before the app loads, with its own copy of src/lib/theme.ts's rules.
// This runs that script in a pretend page and compares it with the app's.

const root = join(import.meta.dir, '..')
const html = readFileSync(join(root, 'index.html'), 'utf8')
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
const metas = [...html.matchAll(/<meta name="theme-color" content="([^"]+)" media="([^"]+)" \/>/g)].map((m) => ({ content: m[1], media: m[2] }))

/** the page after the script ran, with `kept` in localStorage (a function that throws: storage switched off) */
function run(kept: string | null | (() => never), systemDark: boolean) {
  const classes = new Set<string>()
  const shown = metas.map((m) => ({ ...m }))
  const page = {
    documentElement: { classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) } },
    querySelectorAll: () => shown.map((m) => ({ setAttribute: (_: string, v: string) => void (m.content = v) })),
  }
  const storage = { getItem: (k: string) => (typeof kept === 'function' ? kept() : k === DEVICE_KEY ? kept : null) }
  const win = { matchMedia: (q: string) => ({ matches: q === '(prefers-color-scheme: dark)' && systemDark }) }
  new Function('window', 'document', 'localStorage', script[0])(win, page, storage)
  return { dark: classes.has('dark'), metas: shown.map((m) => m.content) }
}

describe('the first-frame script in index.html', () => {
  test('there is one, before the app', () => {
    expect(script).toHaveLength(1)
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<script type="module"'))
  })

  for (const choice of ['system', 'light', 'dark'] as const) {
    for (const systemDark of [false, true]) {
      test(`${choice}, device ${systemDark ? 'dark' : 'light'}: the same look as the app's`, () => {
        const resolved: Resolved = resolveTheme(choice, systemDark)
        const page = run(choice, systemDark)
        expect(page.dark).toBe(resolved === 'dark')
        // following the device leaves each meta its own colour; a forced choice gives both the chosen one
        expect(page.metas).toEqual(choice === 'system' ? metas.map((m) => m.content) : [THEME_COLORS[resolved], THEME_COLORS[resolved]])
      })
    }
  }

  test('nothing kept, something else kept, or storage switched off: the device decides', () => {
    for (const kept of [null, 'blue', () => { throw new Error('denied') }]) {
      expect(run(kept, true).dark).toBe(true)
      expect(run(kept, false).dark).toBe(false)
    }
  })
})

describe('the page colours agree everywhere', () => {
  test("index.html's theme-color metas are THEME_COLORS", () => {
    expect(metas).toEqual([
      { content: THEME_COLORS.light, media: '(prefers-color-scheme: light)' },
      { content: THEME_COLORS.dark, media: '(prefers-color-scheme: dark)' },
    ])
  })

  test("the light page colour in src/index.css is THEME_COLORS.light", () => {
    const css = readFileSync(join(root, 'src', 'index.css'), 'utf8')
    const light = /:root \{[^}]*?--background: (#[0-9a-f]+);/.exec(css)?.[1]
    expect(light).toBe(THEME_COLORS.light)
  })
})
