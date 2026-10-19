import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INBOX_KEEP } from '@/data/actions'
import { AUTO_ARCHIVE_MONTHS, inboxItemSchema, PROJECT_STATUSES, TEAM_KEY_PATTERN } from '@/model/schema'
import { PRIORITY_IDS, STATUS_IDS, STATUSES } from '@/model/status'

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

const byGroup = (...groups: string[]) => STATUSES.filter((s) => groups.includes(s.group)).map((s) => s.id)

describe('database lists match src/model', () => {
  test('issue statuses (issues and inbox)', () => {
    const found = lists('issue-statuses')
    expect(found.length).toBe(2)
    for (const list of found) expect(list).toEqual([...STATUS_IDS])
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
