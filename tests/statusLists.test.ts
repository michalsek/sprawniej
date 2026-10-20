import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INBOX_KEEP } from '@/data/actions'
import { AUTO_ARCHIVE_MONTHS, inboxItemSchema, PROJECT_STATUSES, TEAM_KEY_PATTERN } from '@/model/schema'
import { PRIORITY_IDS, ISSUE_CATEGORIES, CATEGORIES } from '@/model/status'

// The database checks copy the fixed lists from src/model. Each copy has a marker comment ("-- @list issue-statuses")
// on the line above it; this test reads the line after every marker and compares.

const dir = join(import.meta.dir, '..', 'supabase', 'migrations')
const sql = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(dir, f), 'utf8'))
  .join('\n')

/** the line after each "-- @<kind> <name>" marker, in file order */
function marked(kind: string, name: string): string[] {
  const lines = sql.split('\n')
  const out: string[] = []
  lines.forEach((line, n) => {
    if (line.trim() === `-- @${kind} ${name}`) out.push(lines[n + 1] ?? '')
  })
  return out
}

const quoted = (line: string) => [...line.matchAll(/'([^']*)'/g)].map((m) => m[1])

const lists = (name: string) => {
  const found = marked('list', name).map(quoted)
  expect(found.length).toBeGreaterThan(0)
  return found
}

const byGroup = (...groups: string[]) => CATEGORIES.filter((s) => groups.includes(s.group)).map((s) => s.id)

describe('database lists match src/model', () => {
  test('issue categories (issues, inbox and the statuses table)', () => {
    const found = lists('issue-statuses')
    expect(found.length).toBe(3)
    for (const list of found) expect(list).toEqual([...ISSUE_CATEGORIES])
  })

  test('the statuses every workspace starts with: one per category, named and coloured as the app shows them', () => {
    const [line] = marked('seed', 'issue-statuses')
    const triples = [...line.matchAll(/\('([^']*)', '([^']*)', '([^']*)'\)/g)].map((m) => [m[1], m[2], m[3]])
    expect(triples).toEqual(CATEGORIES.map((c) => [c.id, c.name, c.seed]))
    // and the seed colours are the theme's status colours, so nothing looks different
    const css = readFileSync(join(import.meta.dir, '..', 'src', 'index.css'), 'utf8')
    for (const c of CATEGORIES) {
      const name = /var\((--[\w-]+)\)/.exec(c.color)?.[1]
      const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(css)?.[1]
      expect({ c: c.id, value }).toEqual({ c: c.id, value: c.seed })
    }
  })

  test('project statuses', () => {
    for (const list of lists('project-statuses')) expect(list).toEqual([...PROJECT_STATUSES])
  })

  test('inbox note types', () => {
    for (const list of lists('inbox-types')) expect(list).toEqual([...inboxItemSchema.shape.type.options])
  })

  test('statuses that count as finished (completed_at) and closed (auto-archive)', () => {
    for (const list of lists('completed-statuses')) expect(list).toEqual(byGroup('completed'))
    for (const list of lists('closed-statuses')) expect(list).toEqual(byGroup('completed', 'canceled'))
  })

  test('priorities', () => {
    const [line] = marked('range', 'priorities')
    const range = line.match(/between (\d+) and (\d+)/)?.slice(1).map(Number)
    expect(range).toEqual([Math.min(...PRIORITY_IDS), Math.max(...PRIORITY_IDS)])
  })

  test('team keys', () => {
    const [line] = marked('regex', 'team-key')
    expect(quoted(line)).toEqual([TEAM_KEY_PATTERN.source])
  })

  test('days before inbox notes are tidied away', () => {
    const DAY = 24 * 60 * 60 * 1000
    const days = (name: string) => marked('days', name).map((line) => Number(line.match(/'(\d+) days'/)?.[1]))
    expect(days('inbox-read')).toEqual([INBOX_KEEP.read / DAY])
    expect(days('inbox-unread')).toEqual([INBOX_KEEP.unread / DAY])
  })

  test('months before finished issues are archived', () => {
    const [line] = marked('default', 'auto-archive')
    expect(line.match(/default (\d+)/)?.[1]).toBe(String(AUTO_ARCHIVE_MONTHS))
  })
})
