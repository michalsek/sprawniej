import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Both looks in src/index.css must stay readable (WCAG AA): text 4.5:1 on everything it sits on, and the colours
// that carry meaning (statuses, urgent, the marks inside their icons) 3:1, as for icons.

const css = readFileSync(join(import.meta.dir, '..', 'src', 'index.css'), 'utf8')

/** the --name: #hex colours in the first block after `selector {` */
function block(selector: string): Record<string, string> {
  const body = new RegExp(`^${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? ''
  return Object.fromEntries([...body.matchAll(/--([\w-]+): (#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]))
}

const light = block(':root')
const themes = { light, dark: { ...light, ...block('.dark') } }

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** `top` at `alpha` over `under`, as bg-muted/60 paints */
const over = (top: string, alpha: number, under: string) =>
  `#${channels(top)
    .map((c, i) => Math.round(c * alpha + channels(under)[i] * (1 - alpha)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`

/** every pair below its minimum, worded for the failure message */
function failing(t: Record<string, string>, fronts: string[], backs: string[], min: number) {
  const out: string[] = []
  for (const f of fronts) {
    for (const b of backs) {
      const [front, back] = [t[f], t[b] ?? b]
      expect(front).toBeDefined()
      expect(back).toBeDefined()
      const r = ratio(front, back)
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

    test('the marks inside status and urgent icons show', () => {
      expect(failing(t, ['status-mark'], ['status-done', 'status-canceled'], 3)).toEqual([])
      expect(failing(t, ['urgent-mark'], ['urgent'], 3)).toEqual([])
    })
  })
}
