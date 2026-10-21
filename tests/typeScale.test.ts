import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cn, TEXT_SIZES } from '@/lib/utils'

// Text sizes come from the type scale in src/index.css (docs/design.md, "Type"), so changing one token changes the
// whole app. A size in pixels (`text-[15px]`, `text-[13px]`) would stay behind when the scale moves.
const src = join(import.meta.dir, '..', 'src')
const css = readFileSync(join(src, 'index.css'), 'utf8')

test('no text size in pixels or rem anywhere in the app', () => {
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(tsx?|css)$/.test(f))
  const found = files.flatMap((f) =>
    [...readFileSync(join(src, f), 'utf8').matchAll(/text-\[[\d.]+(?:px|rem)\]/g)].map((m) => `${f}: ${m[0]}`),
  )
  expect(files.length).toBeGreaterThan(50)
  // the one in the scale's own comment, which says not to
  expect(found).toEqual(['index.css: text-[15px]'])
})

test('cn knows every size of our own, so it keeps the colour next to it', () => {
  const scale = css.slice(css.indexOf('@theme {'))
  const ours = [...scale.slice(0, scale.indexOf('\n}')).matchAll(/--text-([a-z]+(?:-[a-z]+)*):/g)]
    .map((m) => m[1])
    .filter((name) => !['xs', 'sm', 'base', 'lg', 'xl'].includes(name))
  expect(ours.toSorted()).toEqual([...TEXT_SIZES].toSorted())
  for (const size of TEXT_SIZES) expect(cn(`text-${size}`, 'text-muted-foreground')).toBe(`text-${size} text-muted-foreground`)
  expect(cn('text-sm', 'text-ui')).toBe('text-ui')
})
