import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cn, TEXT_SIZES } from '@/lib/utils'

// Text sizes come from the type scale in src/index.css (docs/design.md, "Type"), so changing one token changes the
// whole app. A size of its own would stay behind when the scale moves.
const src = join(import.meta.dir, '..', 'src')
const css = readFileSync(join(src, 'index.css'), 'utf8')
const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(tsx?|css)$/.test(f))
const found = (pattern: RegExp, only = /./) =>
  files.filter((f) => only.test(f)).flatMap((f) => [...readFileSync(join(src, f), 'utf8').matchAll(pattern)].map((m) => `${f}: ${m[0]}`))

test('no text size of its own anywhere in the app', () => {
  expect(files.length).toBeGreaterThan(50)
  // text-[15px], text-[0.8rem], text-[length:…], text-[calc(…)], text-[var(…)], text-(--x); sizes in em are fine
  expect(found(/text-\[(?:length:|calc\(|var\(|[\d.]+(?:px|rem)\])|text-\(/g)).toEqual([])
  // font-size: 13px in CSS, fontSize: 13 or '13px' in a style
  expect(found(/font-size:\s*[\d.]/g, /\.css$/)).toEqual([])
  expect(found(/fontSize:\s*['"]?[\d.]/g, /\.tsx?$/)).toEqual([])
})

test("Tailwind's steps above text-sm only where a phone needs 16px", () => {
  // shadcn's Input and Textarea are 16px on phones (iOS zooms into smaller fields); our own fields use text-field
  const allowed = ['ui/input.tsx: text-base', 'ui/textarea.tsx: text-base']
  expect(found(/(?<![\w-])text-(?:base|lg|xl|\dxl)\b/g).toSorted()).toEqual(allowed)
})

test('cn knows every size of our own, so it keeps the colour next to it', () => {
  const scale = css.slice(css.indexOf('@theme {'))
  const ours = [
    ...[...scale.slice(0, scale.indexOf('\n}')).matchAll(/--text-([a-z0-9]+(?:-[a-z0-9]+)*):/g)].map((m) => m[1]),
    ...[...css.matchAll(/@utility text-([a-z0-9-]+)/g)].map((m) => m[1]),
  ].filter((name) => !['xs', 'sm'].includes(name))
  expect(ours.toSorted()).toEqual([...TEXT_SIZES].toSorted())
  expect(cn('text-ui', 'text-muted-foreground')).toBe('text-ui text-muted-foreground')
  expect(cn('text-sm', 'text-ui')).toBe('text-ui')
  expect(cn('md:text-ui', 'md:text-sm')).toBe('md:text-sm')
})
