import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KEYS, LIVE_TABLES } from '@/backend/tables'
import { TABLES, wsColumn } from './db/support'

// private.wiring (the helpers migration) is the one list of tables the database wires up. The app (KEYS and
// LIVE_TABLES in src/backend/tables.ts) and the database tests keep their own copies; this reads the list from the SQL
// and checks that they agree.

// the helpers migration starts the list; later migrations add their tables to it the same way
const dir = join(import.meta.dir, '..', 'supabase', 'migrations')
const sql = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(dir, f), 'utf8'))
  .join('\n')

interface Wired {
  name: string
  keys: string[]
  wsCol: string
  topic: string | null
}

const text = (v: string) => (v === 'null' ? null : v.replace(/^'|'$/g, ''))
const wiring: Wired[] = [...sql.matchAll(/^\s*\('(\w+)',\s*'\{([\w,]+)\}',\s*('\w+'|null),\s*('[\w:]+'|null),/gm)].map((m) => ({
  name: m[1],
  keys: m[2].split(','),
  wsCol: text(m[3]) ?? '',
  topic: text(m[4]),
}))
const wiringTest = readFileSync(join(import.meta.dir, 'db', 'wiring.test.ts'), 'utf8')

describe('private.wiring matches its copies', () => {
  test('the list is read', () => {
    expect(wiring.length).toBe(25)
  })

  test('the database tests know every table and its workspace column', () => {
    expect(wiring.map((t) => t.name).sort()).toEqual([...TABLES].sort())
    for (const t of TABLES) expect({ t, col: wiring.find((x) => x.name === t)?.wsCol }).toEqual({ t, col: wsColumn(t) })
  })

  test('the app applies exactly the broadcast tables, with the same keys', () => {
    const live = wiring.filter((t) => t.topic)
    expect(live.map((t) => t.name).sort()).toEqual([...LIVE_TABLES].sort())
    const appKeys: Record<string, readonly string[]> = KEYS
    for (const t of live) expect({ t: t.name, keys: appKeys[t.name] }).toEqual({ t: t.name, keys: t.keys })
  })

  test('the wiring tests cover every broadcast table, with the same keys', () => {
    for (const t of wiring.filter((x) => x.topic)) expect({ t: t.name, covered: wiringTest.includes(`'${t.name}'`) }).toEqual({ t: t.name, covered: true })
    for (const m of wiringTest.matchAll(/table: '(\w+)',\s*keys: \[([^\]]*)\]/g)) {
      const keys = [...m[2].matchAll(/'(\w+)'/g)].map((k) => k[1])
      expect({ t: m[1], keys }).toEqual({ t: m[1], keys: wiring.find((x) => x.name === m[1])?.keys ?? [] })
    }
  })
})
