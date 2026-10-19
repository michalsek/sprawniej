import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '@/backend/client'
import { COLS, ImportProblem, NOT_NULL, planImport, runImport, stepSize, type ImportPlan, type ImportStep, type ImportTable } from '@/backend/importRows'
import { Registry } from '@/backend/registry'
import { buildImport, type Existing, type ImportChoices, type ImportResult } from '@/features/import/linearMap'
import type { Person, Team } from '@/model/schema'
import { linearFixture as data } from './fixtures/linear'

const WS = 'ws-1'
const NOW = '2026-03-01T00:00:00.000Z'
const person = (login: string, name: string, more: object = {}): Person => ({ login, githubId: 0, name, avatarUrl: '', ...more })
const team = (key: string, more: object = {}): Team => ({ key, name: `${key} team`, emoji: '🛠️', members: ['mikolaj'], createdAt: NOW, ...more })

/** you (mikolaj), Ana and Cat (who has joined), Cat's guest from an earlier import; ENG here, OLD holding Linear's DES */
function world() {
  const registry = new Registry()
  registry.learnProfile('p-me', 'mikolaj')
  registry.learnProfile('p-ana', 'ana')
  registry.learnProfile('p-cw', 'cwong')
  registry.learnProfile('p-cat', '~cat-wong')
  registry.learnTeam('t-eng-here', 'ENG')
  registry.learnTeam('t-old-here', 'OLD')
  const existing: Existing = {
    me: 'mikolaj',
    people: { mikolaj: person('mikolaj', 'Mikołaj'), ana: person('ana', 'Ana Nowak'), cwong: person('cwong', 'Cat'), '~cat-wong': person('~cat-wong', 'Cat Wong', { linearId: 'u-cat' }) },
    teams: { ENG: team('ENG'), OLD: team('OLD', { linearId: 't-des' }) },
    issues: {},
    labels: {},
    projects: {},
    comments: {},
    views: {},
    archivedByLinear: {},
    archivedComments: {},
    usedNumbers: {},
  }
  return { registry, existing }
}

const choices: ImportChoices = {
  teamKeys: { 't-eng': 'ENG', 't-des': 'DES' },
  people: { 'u-ana': 'ana', 'u-bob': '~bob-stone', 'u-old': null, 'u-cat': 'cwong' },
}

function build(d = data, c = choices, w = world()) {
  let n = 0
  let g = 0
  const r = buildImport(d, c, w.existing, { newId: () => `01J${String(++n).padStart(10, '0')}`, newGuestId: () => `guest-${++g}`, now: NOW })
  return { ...w, r }
}

function plan(b = build(), more: { batch?: number; maxBytes?: number } = {}) {
  let t = 0
  return planImport(b.r, b.existing, { workspaceId: WS, registry: b.registry, newTeamId: () => `new-team-${++t}`, ...more })
}

/** an issue row's Linear id, from the first pass (the parents pass doesn't send it) */
const linearOf = (p: ImportPlan, id: unknown) => rowsOf(p, 'issues', 'first').find((r) => r.id === id)?.linear_id
const label = (s: ImportStep) => (s.kind === 'rows' ? s.part : s.kind === 'remove' ? `remove ${s.table}` : s.kind)
const rowsOf = (p: ImportPlan, table: ImportTable, part?: string) =>
  p.steps.flatMap((s) => (s.kind === 'rows' && s.table === table && (!part || s.part === part) ? s.rows : []))

describe('the steps of an import', () => {
  test('come in the order that lets every row find what it points at', () => {
    const p = plan()
    expect([...new Set(p.steps.map(label))]).toEqual([
      'guests', 'release', 'new', 'team_members', 'take', 'labels', 'projects', 'project_teams', 'first', 'parents', 'issue_labels', 'followers',
      'comments', 'views', 'email', 'link',
    ])
    expect(p.total).toBe(p.steps.reduce((n, s) => n + stepSize(s), 0))
    expect(p.newTeams).toEqual({ DES: 'new-team-1' })
    expect(rowsOf(p, 'teams', 'release')).toEqual([{ id: 't-old-here', key: 'OLD', name: 'OLD team', linear_id: null }])
    expect(rowsOf(p, 'teams', 'take')).toEqual([{ id: 't-eng-here', key: 'ENG', name: 'ENG team', linear_id: 't-eng' }])
    expect(p.steps.filter((s) => s.kind === 'email')).toEqual([{ kind: 'email', profile: 'guest-1', email: 'bstone@acme.dev' }])
    expect(p.steps.filter((s) => s.kind === 'link')).toEqual([{ kind: 'link', guest: 'p-cat', to: 'p-cw' }])
  })

  test('two teams swapping their Linear teams both let go before either takes one', () => {
    const w = world()
    w.registry.learnTeam('t-a', 'AAA')
    w.registry.learnTeam('t-b', 'BBB')
    w.existing.teams = { AAA: team('AAA', { linearId: 't-eng' }), BBB: team('BBB', { linearId: 't-des' }) }
    const p = plan(build(data, { ...choices, teamKeys: { 't-eng': 'BBB', 't-des': 'AAA' } }, w))
    const parts = p.steps.map(label)
    const release = parts.indexOf('release')
    expect(release).toBeGreaterThanOrEqual(0)
    expect(parts.indexOf('take')).toBeGreaterThan(release)
    expect(parts).not.toContain('new')
    expect(rowsOf(p, 'teams', 'release').map((t) => [t.key, t.linear_id])).toEqual(expect.arrayContaining([['AAA', null], ['BBB', null]]))
    expect(rowsOf(p, 'teams', 'take').map((t) => [t.key, t.linear_id])).toEqual(expect.arrayContaining([['BBB', 't-eng'], ['AAA', 't-des']]))
    // no step names one key twice
    for (const s of p.steps) if (s.kind === 'rows') expect(new Set(s.rows.map((r) => JSON.stringify([r.id, r.issue_id, r.label_id, r.team_id, r.profile_id]))).size).toBe(s.rows.length)
  })

  test('are cut into batches by count and by size, in order', () => {
    const p = plan(build(), { batch: 2 })
    const firsts = p.steps.filter((s) => s.kind === 'rows' && s.table === 'issues' && s.part === 'first')
    expect(firsts.map((s) => (s.kind === 'rows' ? s.rows.length : 0))).toEqual([2, 2])
    expect(firsts.flatMap((s) => (s.kind === 'rows' ? s.rows.map((r) => r.linear_id) : []))).toEqual(build().r.issues.map((i) => i.linearId))
    expect(p.total).toBe(p.steps.reduce((n, s) => n + stepSize(s), 0))
    const big = 'x'.repeat(1_500_000)
    const heavy = plan(build({ ...data, issues: data.issues.map((i) => (i.id === 'i-1' || i.id === 'i-3' ? { ...i, description: big } : i)) }))
    const sizes = heavy.steps.filter((s) => s.kind === 'rows' && s.part === 'first').map((s) => (s.kind === 'rows' ? s.rows.length : 0))
    expect(sizes.length).toBeGreaterThan(1)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(4)
  })

  test('every batch sends the same columns, never an empty required one', () => {
    const p = plan()
    for (const s of p.steps) {
      if (s.kind !== 'rows') continue
      const keys = JSON.stringify(Object.keys(s.rows[0]).sort())
      for (const row of s.rows) {
        expect(JSON.stringify(Object.keys(row).sort())).toBe(keys)
        for (const c of NOT_NULL[s.table]) if (c in row) expect({ table: s.table, c, v: row[c] }).not.toEqual({ table: s.table, c, v: null })
        expect('workspace_id' in row || 'guest_of' in row).toBe(false)
      }
    }
    for (const row of rowsOf(p, 'issues', 'first')) expect('parent_id' in row || 'duplicate_of' in row).toBe(false)
    const parents = rowsOf(p, 'issues', 'parents')
    // only the one with a parent: the others are new and have none
    expect(parents.map((r) => linearOf(p, r.id))).toEqual(['i-2'])
    expect(Object.keys(parents[0]).sort()).toEqual([...NOT_NULL.issues, 'parent_id', 'duplicate_of'].sort())
    expect(parents[0].parent_id).toBe(rowsOf(p, 'issues', 'first').find((r) => r.linear_id === 'i-1')?.id)
  })

  test('issues already here go through the parents pass too, so a parent taken off in Linear is cleared', () => {
    const first = build()
    const w = world()
    for (const i of first.r.issues) if (!i.archivedAt) w.existing.issues[i.id] = { ...i }
    const p = plan(build({ ...data, issues: data.issues.map((i) => (i.id === 'i-2' ? { ...i, parent: null, title: 'Axis' } : { ...i, title: `${i.title}!` })) }, choices, w))
    const parents = rowsOf(p, 'issues', 'parents')
    expect(parents.map((r) => linearOf(p, r.id)).sort()).toEqual(['i-1', 'i-2', 'i-3', 'i-9'])
    expect(parents.find((r) => linearOf(p, r.id) === 'i-2')?.parent_id).toBeNull()
  })

  test('keep the order of labels, a project’s teams and a team’s members (you first)', () => {
    const b = build()
    const p = plan(b)
    const charts = b.r.issues.find((i) => i.linearId === 'i-1')!
    const bug = b.r.labels.find((l) => l.name === 'Bug')!.id
    const area = b.r.labels.find((l) => l.name === 'Area: Charts')!.id
    expect(rowsOf(p, 'issue_labels').filter((r) => r.issue_id === charts.id)).toEqual([
      { issue_id: charts.id, label_id: bug },
      { issue_id: charts.id, label_id: area },
    ])
    expect(rowsOf(p, 'project_teams')).toEqual([{ project_id: b.r.projects[0].id, team_id: 't-eng-here' }])
    expect(rowsOf(p, 'team_members')).toEqual([
      { team_id: 'new-team-1', profile_id: 'p-me' },
      { team_id: 'new-team-1', profile_id: 'p-ana' },
    ])
  })

  test('new teams and guests have their ids in the rows that point at them; the app’s registry is left alone', () => {
    const b = build()
    const p = plan(b)
    expect(rowsOf(p, 'issues', 'first').find((r) => r.linear_id === 'i-9')?.team_id).toBe('new-team-1')
    expect(rowsOf(p, 'issues', 'first').find((r) => r.linear_id === 'i-1')?.assignee_id).toBe('guest-1')
    expect(rowsOf(p, 'profiles')).toEqual([{ id: 'guest-1', login: '~bob-stone', name: 'Bob Stone', avatar_url: '', linear_ids: ['u-bob'], extra: {} }])
    expect(b.registry.teamId('DES')).toBeUndefined()
    expect(b.registry.profileId('~bob-stone')).toBeUndefined()
  })

  test('trying again after it stopped partway: the teams the first try made get their members', () => {
    const firstTry = plan()
    // it stopped after making DES, before its members: DES is here now, so the import doesn't see it as new
    const w = world()
    w.registry.learnTeam('new-team-1', 'DES')
    w.existing.teams.DES = team('DES', { members: [], linearId: 't-des' })
    // and one it never got to make is made again, with a new id: what the first try had for it doesn't come
    const stale: ImportPlan = { ...firstTry, steps: [...firstTry.steps, { kind: 'rows', table: 'team_members', part: 'team_members', rows: [{ team_id: 'never-made', profile_id: 'p-me' }] }] }
    const again = planImport(build(data, choices, w).r, w.existing, { workspaceId: WS, registry: w.registry, newTeamId: () => 'x', carry: stale })
    expect(again.newTeams).toEqual({})
    expect(rowsOf(again, 'team_members')).toEqual([
      { team_id: 'new-team-1', profile_id: 'p-me' },
      { team_id: 'new-team-1', profile_id: 'p-ana' },
    ])
    // without the first try nobody would be in DES
    expect(rowsOf(plan(build(data, choices, w)), 'team_members')).toEqual([])
  })

  test('what Linear took off becomes deletes; a login nobody knows is a mistake', () => {
    const b = build()
    const [i1, i2] = b.r.issues
    const r: ImportResult = {
      ...b.r,
      removedLabels: [{ issue: i1.id, label: 'l-x' }, { issue: i1.id, label: 'l-y' }, { issue: i2.id, label: 'l-x' }],
      removedProjectTeams: [{ project: 'p-1', team: 'OLD' }],
      removedFollowers: [{ issue: i1.id, login: 'ana' }],
      removedViews: ['v-1', 'v-2'],
    }
    const p = planImport(r, b.existing, { workspaceId: WS, registry: b.registry, newTeamId: () => 'new-team' })
    expect(p.steps.filter((s) => s.kind === 'remove')).toEqual([
      { kind: 'remove', table: 'project_teams', keys: [{ project_id: 'p-1', team_id: 't-old-here' }] },
      { kind: 'remove', table: 'issue_labels', keys: [{ issue_id: i1.id, label_id: 'l-x' }, { issue_id: i1.id, label_id: 'l-y' }, { issue_id: i2.id, label_id: 'l-x' }] },
      { kind: 'remove', table: 'issue_followers', keys: [{ issue_id: i1.id, profile_id: 'p-ana' }] },
      { kind: 'remove', table: 'views', keys: [{ id: 'v-1' }, { id: 'v-2' }] },
    ])
    const stranger = { ...b.r, issues: [{ ...b.r.issues[0], assignee: 'nobody-here' }] }
    expect(() => planImport(stranger, b.existing, { workspaceId: WS, registry: b.registry, newTeamId: () => 'x' })).toThrow('Unknown person: nobody-here')
  })
})

describe('the columns match the database', () => {
  const dir = join(import.meta.dir, '..', 'supabase', 'migrations')
  const tablesSql = readFileSync(join(dir, '20261019000001_tables.sql'), 'utf8')
  const functionsSql = readFileSync(join(dir, '20261019000006_functions.sql'), 'utf8')
  /** column → { notNull, hasDefault } for one table */
  const columns = (table: string) => {
    const body = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(tablesSql)?.[1] ?? ''
    const out = new Map<string, { notNull: boolean; hasDefault: boolean }>()
    for (const line of body.split('\n')) {
      const m = /^ {2}([a-z_]+)\s+(?!key\b)(\w+)(.*)$/.exec(line)
      if (!m || ['primary', 'unique', 'foreign', 'check'].includes(m[1])) continue
      const rest = `${m[2]} ${m[3]}`.replace(/--.*$/, '')
      out.set(m[1], { notNull: /not null|primary key/.test(rest), hasDefault: /\bdefault\b|generated/.test(rest) })
    }
    return out
  }
  const insertCols = (table: string) => new RegExp(`\\('${table}',\\s*'\\{([\\w,]+)\\}'`).exec(functionsSql)?.[1].split(',') ?? []
  const SENT: Record<ImportTable, readonly string[]> = {
    profiles: COLS.profiles,
    teams: [...new Set([...COLS.teams, ...COLS.teamLink])],
    team_members: COLS.team_members,
    labels: COLS.labels,
    projects: COLS.projects,
    project_teams: COLS.project_teams,
    issues: [...new Set([...COLS.issues, ...COLS.issueParents])],
    issue_labels: COLS.issue_labels,
    issue_followers: COLS.issue_followers,
    comments: COLS.comments,
    views: COLS.views,
  }
  const PINNED = new Set(['workspace_id', 'guest_of', 'changed_at', 'joined_at'])

  test('every required column without a default is sent; what is sent is a column import_rows writes', () => {
    for (const [table, sent] of Object.entries(SENT)) {
      const cols = columns(table)
      expect({ table, read: cols.size > 2 }).toEqual({ table, read: true })
      const required = [...cols].filter(([c, x]) => x.notNull && !x.hasDefault && !PINNED.has(c)).map(([c]) => c)
      expect({ table, missing: required.filter((c) => !sent.includes(c)) }).toEqual({ table, missing: [] })
      expect({ table, unknown: sent.filter((c) => !cols.has(c)) }).toEqual({ table, unknown: [] })
      expect({ table, dropped: sent.filter((c) => !insertCols(table).includes(c)) }).toEqual({ table, dropped: [] })
    }
  })

  test('NOT_NULL says which sent columns may never be empty', () => {
    for (const [table, sent] of Object.entries(SENT) as [ImportTable, readonly string[]][]) {
      const cols = columns(table)
      expect({ table, notNull: sent.filter((c) => cols.get(c)?.notNull).sort() }).toEqual({ table, notNull: [...NOT_NULL[table]].sort() })
    }
  })
})

// ---------- sending ----------

interface Answer {
  data?: unknown
  error?: { code?: string; message?: string } | null
  status?: number
}

/** a pretend database: answers import_rows and the other calls from `answer`, and writes down every call */
function fakeDb(answer: (fn: string, args: Record<string, unknown>, n: number) => Answer | Promise<Answer> = () => ({ data: 1 })) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const reply = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    const a = await answer(fn, args, calls.length)
    return { data: a.data ?? null, error: a.error ?? null, status: a.status ?? (a.error ? 400 : 200) }
  }
  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => reply(fn, args),
    from: (table: string) => ({
      delete: () => {
        const filters: string[] = []
        const q = {
          eq: (c: string, v: string) => (filters.push(`${c}=${v}`), q),
          in: (c: string, v: string[]) => (filters.push(`${c} in ${v.join(',')}`), q),
          then: (ok: (x: unknown) => unknown, bad: (e: unknown) => unknown) => reply(`delete ${table}`, { filters }).then(ok, bad),
        }
        return q
      },
    }),
  }
  return { db: db as unknown as Db, calls }
}

const noSleep = () => Promise.resolve()
let errors: ReturnType<typeof spyOn>
beforeEach(() => {
  errors = spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errors.mockRestore())

describe('sending an import', () => {
  test('sends every step, says how far it got, and adds up what changed', async () => {
    const p = plan()
    const { db, calls } = fakeDb((fn, args) => ({ data: fn === 'import_rows' ? (args.p_rows as unknown[]).length : null }))
    const seen: number[] = []
    const changed = await runImport(db, WS, p, (saved, total) => {
      expect(total).toBe(p.total)
      seen.push(saved)
    }, noSleep)
    expect(seen[0]).toBe(0)
    expect(seen.at(-1)).toBe(p.total)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(changed).toBe(p.steps.reduce((n, s) => n + (s.kind === 'rows' ? s.rows.length : 0), 0))
    expect(calls.map((c) => c.fn)).toEqual(p.steps.map((s) => (s.kind === 'rows' ? 'import_rows' : s.kind === 'email' ? 'set_guest_email' : s.kind === 'link' ? 'link_person' : `delete ${s.table}`)))
  })

  test('deletes go per issue, kept to the workspace', async () => {
    const p: ImportPlan = { workspaceId: WS, total: 3, newTeams: {}, archived: 0, steps: [{ kind: 'remove', table: 'issue_labels', keys: [{ issue_id: 'a', label_id: 'x' }, { issue_id: 'a', label_id: 'y' }, { issue_id: 'b', label_id: 'x' }] }] }
    const { db, calls } = fakeDb()
    await runImport(db, WS, p, () => {}, noSleep)
    expect(calls.map((c) => c.args.filters)).toEqual([
      ['workspace_id=ws-1', 'issue_id=a', 'label_id in x,y'],
      ['workspace_id=ws-1', 'issue_id=b', 'label_id in x'],
    ])
  })

  test('a dropped connection is tried again; one that stays down stops it partway, saying so', async () => {
    const p = plan()
    let fails = 2
    const flaky = fakeDb((fn) => (fn === 'import_rows' && fails-- > 0 ? { error: { message: 'TypeError: Failed to fetch' }, status: 0 } : { data: 1 }))
    const waits: number[] = []
    await runImport(flaky.db, WS, p, () => {}, async (ms) => void waits.push(ms))
    expect(waits).toEqual([1_000, 3_000])
    const down = fakeDb((fn, _a, n) => (n > 2 ? { error: { message: 'TypeError: Failed to fetch' }, status: 0 } : { data: 1 }))
    const saved: number[] = []
    const stopped = runImport(down.db, WS, p, (s) => saved.push(s), noSleep)
    await expect(stopped).rejects.toThrow("We couldn't reach Sprawniej, so the import stopped partway. Check your internet connection.")
    await expect(stopped).rejects.toBeInstanceOf(ImportProblem)
    // what was saved before stays counted
    expect(saved.at(-1)).toBeLessThan(p.total)
    expect(down.calls).toHaveLength(2 + 4)
  })

  test('a batch too slow for the database is halved until it goes through', async () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({ id: `i${n}` }))
    const p: ImportPlan = { workspaceId: WS, total: 100, newTeams: {}, archived: 0, steps: [{ kind: 'rows', table: 'issues', part: 'first', rows }] }
    const { db, calls } = fakeDb((_fn, args) => {
      const n = (args.p_rows as unknown[]).length
      return n > 30 ? { error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 } : { data: n }
    })
    expect(await runImport(db, WS, p, () => {}, noSleep)).toBe(100)
    expect(calls.map((c) => (c.args.p_rows as unknown[]).length)).toEqual([100, 50, 25, 25, 50, 25, 25])
  })

  test('someone linked already counts as done; a number taken meanwhile stops it with words to show', async () => {
    const linked: ImportPlan = { workspaceId: WS, total: 1, newTeams: {}, archived: 0, steps: [{ kind: 'link', guest: 'g', to: 'p' }] }
    expect(await runImport(fakeDb(() => ({ error: { code: 'P0002', message: 'That person isn’t here any more.' } })).db, WS, linked, () => {}, noSleep)).toBe(0)
    const issues: ImportPlan = { workspaceId: WS, total: 1, newTeams: {}, archived: 0, steps: [{ kind: 'rows', table: 'issues', part: 'first', rows: [{ id: 'x' }] }] }
    const taken = fakeDb(() => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint "issues_team_id_number_key"' }, status: 409 }))
    await expect(runImport(taken.db, WS, issues, () => {}, noSleep)).rejects.toThrow('Someone added an issue to one of these teams while you were importing, so a number was taken.')
    const refused = fakeDb(() => ({ error: { code: '42501', message: 'Only admins can import.' }, status: 403 }))
    await expect(runImport(refused.db, WS, issues, () => {}, noSleep)).rejects.toThrow('Only admins can import.')
    const odd = fakeDb(() => ({ error: { code: 'SP010', message: 'This import has something Sprawniej can’t take.' }, status: 400 }))
    await expect(runImport(odd.db, WS, issues, () => {}, noSleep)).rejects.toThrow('Something went wrong, so the import stopped partway.')
    expect(errors).toHaveBeenCalled()
  })
})
