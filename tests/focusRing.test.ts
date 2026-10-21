import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The focus ring is solid (docs/design.md): at half strength it falls under 3:1 on the page. A see-through ring or
// outline in ring's colour, or a see-through red one, must not come back.
test('no see-through focus ring anywhere in the app', () => {
  const src = join(import.meta.dir, '..', 'src')
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(tsx?|css)$/.test(f))
  const found = files.flatMap((f) =>
    [...readFileSync(join(src, f), 'utf8').matchAll(/(?:ring|outline)-ring\/\d+|ring-destructive\/\d+/g)].map((m) => `${f}: ${m[0]}`),
  )
  expect(files.length).toBeGreaterThan(50)
  expect(found).toEqual([])
})
