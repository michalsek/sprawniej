import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATUS_COLORS } from '@/model/colors'
import { channels, ratio } from './support/colour'

// Both looks in src/index.css must stay readable (WCAG AA): text 4.5:1 on everything it sits on, and the colours
// that carry meaning (statuses, urgent, the marks inside their icons) and the focus ring 3:1, as for icons.

const css = readFileSync(join(import.meta.dir, '..', 'src', 'index.css'), 'utf8')

/** the --name colours (#hex or oklch(…)) in the first block after `selector {` */
function block(selector: string): Record<string, string> {
  const body = new RegExp(`^${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''
  return Object.fromEntries([...body.matchAll(/--([\w-]+): (#[0-9a-f]{6}|oklch\([^)]*\));/g)].map((m) => [m[1], m[2]]))
}

const light = block(':root')
const themes = { light, dark: { ...light, ...block('.dark') } }

/** `top` at `alpha` over `under`, as bg-muted/60 paints */
const over = (top: string, alpha: number, under: string) =>
  `#${channels(top)
    .map((c, i) => Math.round(c * alpha + channels(under)[i] * (1 - alpha)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`

/** `hex` mixed with `k` black in oklab (CSS color-mix), as an oklch colour */
function mixBlack(hex: string, k: number): string {
  const [r, g, b] = channels(hex).map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
  const [l, m, s] = [0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b].map(Math.cbrt)
  const [L, A, B] = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s].map((x) => x * (1 - k))
  const hue = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return `oklch(${(L * 100).toFixed(4)}% ${Math.hypot(A, B).toFixed(6)} ${hue.toFixed(4)})`
}

/** every pair below its minimum, worded for the failure message */
function failing(t: Record<string, string>, fronts: string[], backs: string[], min: number) {
  const out: string[] = []
  for (const f of fronts) {
    for (const b of backs) {
      // a background is a token's name, or a colour worked out here (a code block)
      const [front, back] = [t[f], b.startsWith('#') ? b : t[b]]
      expect(front).toBeDefined()
      expect(back).toBeDefined()
      const r = ratio(front, back)
      expect(Number.isFinite(r)).toBe(true)
      if (r < min) out.push(`${f} on ${b}: ${r.toFixed(2)}`)
    }
  }
  return out
}

for (const [name, t] of Object.entries(themes)) {
  describe(`${name} colours`, () => {
    test('text reads on every background it sits on', () => {
      const backs = ['background', 'accent', 'sidebar', 'sidebar-accent', 'popover', 'muted']
      expect(failing(t, ['foreground', 'muted-foreground', 'sidebar-foreground'], backs, 4.5)).toEqual([])
      expect(failing(t, ['due-overdue', 'due-soon', 'destructive-text'], ['background', 'accent', 'popover'], 4.5)).toEqual([])
      expect(failing(t, ['primary-foreground'], ['primary'], 4.5)).toEqual([])
      expect(failing(t, ['secondary-foreground'], ['secondary'], 4.5)).toEqual([])
      // dark's red in menus is 4.2:1, as it always was (Dark stays as it is)
      expect(failing(t, ['destructive'], name === 'light' ? ['background', 'popover'] : ['background'], 4.5)).toEqual([])
    })

    test('code reads in a code block', () => {
      // .prose-sprawniej pre: bg-muted/60 on the page
      const code = over(t.muted, 0.6, t.background)
      const colours = ['comment', 'keyword', 'string', 'number', 'title', 'type'].map((c) => `code-${c}`)
      expect(failing(t, colours, [code], 4.5)).toEqual([])
    })

    test('statuses and urgent show on the page and on hover', () => {
      const meaning = ['backlog', 'todo', 'progress', 'review', 'done', 'canceled'].map((s) => `status-${s}`)
      expect(failing(t, [...meaning, 'urgent'], ['background', 'accent', 'popover'], 3)).toEqual([])
    })

    test('colours people pick for a status, as paintColor shades them, show too, and so do the marks on them', () => {
      const shade = Number(new RegExp(`^${name === 'light' ? ':root' : '\\.dark'} \\{[^}]*--status-shade: black (\\d+)%;`, 'm').exec(css)?.[1])
      expect(Number.isFinite(shade)).toBe(true)
      const painted = Object.fromEntries(STATUS_COLORS.map((c) => [`picked ${c}`, mixBlack(c, shade / 100)]))
      const all = { ...t, ...painted }
      expect(failing(all, Object.keys(painted), ['background', 'accent', 'popover'], 3)).toEqual([])
      expect(failing(all, ['status-mark'], Object.keys(painted), 3)).toEqual([])
    })

    test('the focus ring shows on everything it sits on', () => {
      expect(failing(t, ['ring'], ['background', 'accent', 'sidebar', 'sidebar-accent', 'popover', 'muted'], 3)).toEqual([])
    })

    test('the marks inside status and urgent icons show', () => {
      expect(failing(t, ['status-mark'], ['status-done', 'status-canceled'], 3)).toEqual([])
      expect(failing(t, ['urgent-mark'], ['urgent'], 3)).toEqual([])
    })
  })
}
