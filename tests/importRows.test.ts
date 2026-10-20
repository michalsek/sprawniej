import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
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

  test('a team an import made but stopped before its members gets them; a guest without their email gets it', () => {
    // it stopped after making DES and Bob: DES is here now (so not new), with nobody in it, and Bob has no email kept
    const w = world()
    w.registry.learnTeam('des-here', 'DES')
    w.registry.learnProfile('p-bob', '~bob-stone')
    w.existing.teams.DES = team('DES', { members: [], linearId: 't-des' })
    w.existing.people!['~bob-stone'] = person('~bob-stone', 'Bob Stone', { linearId: 'u-bob' })
    const again = plan(build(data, choices, w))
    expect(again.newTeams).toEqual({})
    expect(rowsOf(again, 'team_members')).toEqual([
      { team_id: 'des-here', profile_id: 'p-me' },
      { team_id: 'des-here', profile_id: 'p-ana' },
    ])
    expect(again.steps.filter((s) => s.kind === 'email')).toEqual([{ kind: 'email', profile: 'p-bob', email: 'bstone@acme.dev' }])
    // once both are there, neither comes again
    w.existing.teams.DES = team('DES', { members: ['mikolaj', 'ana'], linearId: 't-des' })
    w.existing.guestEmails = { '~bob-stone': 'bstone@acme.dev' }
    const settled = plan(build(data, choices, w))
    expect(rowsOf(settled, 'team_members')).toEqual([])
    expect(settled.steps.filter((s) => s.kind === 'email')).toEqual([])
  })

  test('an issue already here sends only the labels and followers it doesn’t have yet', () => {
    const first = build()
    const w = world()
    for (const i of first.r.issues) if (!i.archivedAt) w.existing.issues[i.id] = { ...i }
    w.registry.learnProfile('guest-1', '~bob-stone')
    w.existing.people!['~bob-stone'] = person('~bob-stone', 'Bob Stone', { linearId: 'u-bob' })
    w.existing.guestEmails = { '~bob-stone': 'bstone@acme.dev' }
    w.existing.labels = Object.fromEntries(first.r.labels.map((l) => [l.id, l]))
    w.existing.projects = Object.fromEntries(first.r.projects.map((p) => [p.id, p]))
    const charts = first.r.issues.find((i) => i.linearId === 'i-1')!
    const renamed = { ...data, issues: data.issues.map((i) => (i.id === 'i-1' ? { ...i, title: 'Charts are slower', labels: { nodes: [...i.labels.nodes, { id: 'l-unused' }] } } : i)) }
    const p = plan(build(renamed, choices, w))
    const unused = first.r.labels.find((l) => l.name === 'Unused')!.id
    expect(rowsOf(p, 'issue_labels')).toEqual([{ issue_id: charts.id, label_id: unused }])
    expect(rowsOf(p, 'issue_followers').filter((f) => f.issue_id === charts.id)).toEqual([])
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
    // one delete per issue (or project), kept to the workspace when sent
    expect(p.steps.filter((s) => s.kind === 'remove')).toEqual([
      { kind: 'remove', table: 'project_teams', eq: { project_id: 'p-1' }, col: 'team_id', values: ['t-old-here'] },
      { kind: 'remove', table: 'issue_labels', eq: { issue_id: i1.id }, col: 'label_id', values: ['l-x', 'l-y'] },
      { kind: 'remove', table: 'issue_labels', eq: { issue_id: i2.id }, col: 'label_id', values: ['l-x'] },
      { kind: 'remove', table: 'issue_followers', eq: { issue_id: i1.id }, col: 'profile_id', values: ['p-ana'] },
      { kind: 'remove', table: 'views', eq: {}, col: 'id', values: ['v-1', 'v-2'] },
    ])
    const many = planImport({ ...b.r, removedViews: Array.from({ length: 150 }, (_, n) => `v-${n}`) }, b.existing, { workspaceId: WS, registry: b.registry, newTeamId: () => 'x' })
    expect(many.steps.filter((s) => s.kind === 'remove').map((s) => (s.kind === 'remove' ? s.values.length : 0))).toEqual([100, 50])
    const stranger = { ...b.r, issues: [{ ...b.r.issues[0], assignee: 'nobody-here' }] }
    expect(() => planImport(stranger, b.existing, { workspaceId: WS, registry: b.registry, newTeamId: () => 'x' })).toThrow('Unknown person: nobody-here')
  })
})

describe('the columns match the database', () => {
  const dir = join(import.meta.dir, '..', 'supabase', 'migrations')
  const tablesSql = readFileSync(join(dir, '20261019000001_tables.sql'), 'utf8')
  const functionsSql = readFileSync(join(dir, '20261019000006_functions.sql'), 'utf8')
  const laterSql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && f > '20261019000006')
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
  /** columns a trigger fills in when a row comes without them (status_id: follow_status), so they may go empty */
  const FILLED = new Set(['status_id'])
  /** column → { notNull, hasDefault } for one table, with the columns later migrations add */
  const columns = (table: string) => {
    const body = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(tablesSql)?.[1] ?? ''
    const out = new Map<string, { notNull: boolean; hasDefault: boolean }>()
    for (const line of body.split('\n')) {
      const m = /^ {2}([a-z_]+)\s+(?!key\b)(\w+)(.*)$/.exec(line)
      if (!m || ['primary', 'unique', 'foreign', 'check'].includes(m[1])) continue
      const rest = `${m[2]} ${m[3]}`.replace(/--.*$/, '')
      out.set(m[1], { notNull: /not null|primary key/.test(rest), hasDefault: /\bdefault\b|generated/.test(rest) })
    }
    for (const m of laterSql.matchAll(new RegExp(`alter table public\\.${table} add column ([a-z_]+) ([^;\\n]+)`, 'g'))) {
      out.set(m[1], FILLED.has(m[1]) ? { notNull: false, hasDefault: true } : { notNull: /not null/.test(m[2]), hasDefault: /\bdefault\b/.test(m[2]) })
    }
    return out
  }
  /** what import_rows may insert: the first list, and what later migrations add to it */
  const insertCols = (table: string) => [
    ...(new RegExp(`\\('${table}',\\s*'\\{([\\w,]+)\\}'`).exec(functionsSql)?.[1].split(',') ?? []),
    ...[...laterSql.matchAll(new RegExp(`set insert_cols = insert_cols \\|\\| '\\{([\\w,]+)\\}'[^;]*?where table_name = '${table}'`, 'g'))].flatMap((m) => m[1].split(',')),
  ]
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
  count?: number
}

/** a pretend database: answers import_rows and the other calls from `answer`, and writes down every call */
function fakeDb(answer: (fn: string, args: Record<string, unknown>, n: number) => Answer | Promise<Answer> = () => ({ data: 1 })) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const reply = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    const a = await answer(fn, args, calls.length)
    return { data: a.data ?? null, error: a.error ?? null, status: a.status ?? (a.error ? 400 : 200), count: a.count ?? null }
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
const one = (step: ImportStep): ImportPlan => ({ workspaceId: WS, total: stepSize(step), newTeams: {}, archive: false, steps: [step] })
const issueRows = (n: number): ImportStep => ({ kind: 'rows', table: 'issues', part: 'first', rows: Array.from({ length: n }, (_, k) => ({ id: `i${k}` })) })
let errors: ReturnType<typeof spyOn>
beforeEach(() => {
  errors = spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errors.mockRestore())

describe('sending an import', () => {
  test('sends every step, says how far it got, and adds up what changed', async () => {
    const p = plan()
    const { db, calls } = fakeDb((fn, args) => ({ data: fn === 'import_rows' ? (args.p_rows as unknown[]).length : null, count: fn.startsWith('delete') ? 1 : undefined }))
    const seen: number[] = []
    const changed = await runImport(db, WS, p, (saved, total) => {
      expect(total).toBe(p.total)
      seen.push(saved)
    }, noSleep)
    expect(seen[0]).toBe(0)
    expect(seen.at(-1)).toBe(p.total)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    // rows written, rows deleted and people linked; emails don't count
    expect(changed).toBe(p.steps.reduce((n, s) => n + (s.kind === 'rows' ? s.rows.length : s.kind === 'remove' || s.kind === 'link' ? 1 : 0), 0))
    expect(calls.map((c) => c.fn)).toEqual(p.steps.map((s) => (s.kind === 'rows' ? 'import_rows' : s.kind === 'email' ? 'set_guest_email' : s.kind === 'link' ? 'link_person' : `delete ${s.table}`)))
  })

  test('a delete is kept to the workspace and its issue', async () => {
    const { db, calls } = fakeDb(() => ({ count: 2 }))
    expect(await runImport(db, WS, one({ kind: 'remove', table: 'issue_labels', eq: { issue_id: 'a' }, col: 'label_id', values: ['x', 'y'] }), () => {}, noSleep)).toBe(2)
    expect(calls.map((c) => c.args.filters)).toEqual([['workspace_id=ws-1', 'issue_id=a', 'label_id in x,y']])
    const failing = fakeDb(() => ({ error: { code: '42501', message: 'permission denied for table issue_labels' }, status: 403 }))
    await expect(runImport(failing.db, WS, one({ kind: 'remove', table: 'issue_labels', eq: { issue_id: 'a' }, col: 'label_id', values: ['x'] }), () => {}, noSleep)).rejects.toThrow(
      "You aren't allowed to do that here.",
    )
  })

  test('a dropped connection is tried again; one that stays down stops it partway, saying so', async () => {
    const p = plan()
    let fails = 2
    const flaky = fakeDb((fn) => (fn === 'import_rows' && fails-- > 0 ? { error: { message: 'TypeError: Failed to fetch' }, status: 0 } : { data: 1 }))
    const waits: number[] = []
    await runImport(flaky.db, WS, p, () => {}, async (ms) => void waits.push(ms))
    expect(waits).toEqual([1_000, 3_000])
    const down = fakeDb((_fn, _a, n) => (n > 2 ? { error: { message: 'TypeError: Failed to fetch' }, status: 0 } : { data: 1 }))
    const saved: number[] = []
    const stopped = runImport(down.db, WS, p, (s) => saved.push(s), noSleep)
    await expect(stopped).rejects.toThrow("We couldn't reach Sprawniej, so the import stopped partway. Check your internet connection.")
    await expect(stopped).rejects.toBeInstanceOf(ImportProblem)
    // what was saved before stays counted
    expect(saved.at(-1)).toBeLessThan(p.total)
    expect(down.calls).toHaveLength(2 + 4)
  })

  test('a busy moment is tried again too: 408, 429, 5xx and the connection codes', async () => {
    for (const [status, code] of [[408, ''], [429, ''], [503, ''], [500, 'PGRST000'], [503, 'PGRST003'], [500, '40001'], [500, '08006']] as const) {
      let n = 0
      const { db } = fakeDb(() => (++n === 1 ? { error: { code, message: 'busy' }, status } : { data: 1 }))
      expect({ status, code, changed: await runImport(db, WS, one(issueRows(1)), () => {}, noSleep) }).toEqual({ status, code, changed: 1 })
    }
  })

  test('a sign-in that ran out is tried again, then says so', async () => {
    const { db, calls } = fakeDb(() => ({ error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }))
    await expect(runImport(db, WS, one(issueRows(1)), () => {}, noSleep)).rejects.toThrow('You were signed out, so the import stopped partway. Sign in again, then press Try again.')
    expect(calls).toHaveLength(4)
  })

  test('something that throws without being the connection stops at once', async () => {
    const db = { rpc: () => Promise.reject(new RangeError('Invalid array length')) } as unknown as Db
    await expect(runImport(db, WS, one(issueRows(1)), () => {}, async () => void expect.unreachable())).rejects.toThrow('Something went wrong, so the import stopped partway.')
    const offline = { rpc: () => Promise.reject(new TypeError('Failed to fetch')) } as unknown as Db
    await expect(runImport(offline, WS, one(issueRows(1)), () => {}, noSleep)).rejects.toThrow("We couldn't reach Sprawniej")
  })

  test('a batch too slow or too big for the database is halved until it goes through, not below 25 rows', async () => {
    for (const fail of [{ code: '57014', message: 'canceling statement due to statement timeout', status: 500 }, { code: '', message: 'Payload Too Large', status: 413 }]) {
      const { db, calls } = fakeDb((_fn, args) => {
        const n = (args.p_rows as unknown[]).length
        return n > 30 ? { error: { code: fail.code, message: fail.message }, status: fail.status } : { data: n }
      })
      expect(await runImport(db, WS, one(issueRows(100)), () => {}, noSleep)).toBe(100)
      expect(calls.map((c) => (c.args.p_rows as unknown[]).length)).toEqual([100, 50, 25, 25, 50, 25, 25])
    }
    const never = fakeDb(() => ({ error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 }))
    await expect(runImport(never.db, WS, one(issueRows(50)), () => {}, noSleep)).rejects.toThrow('Something went wrong, so the import stopped partway.')
    expect(never.calls.map((c) => (c.args.p_rows as unknown[]).length)).toEqual([50, 25])
  })

  test('someone linked already counts as done; a number taken or a row changed meanwhile stops it with words to show', async () => {
    expect(await runImport(fakeDb(() => ({ error: { code: 'P0002', message: 'That person isn’t here any more.' } })).db, WS, one({ kind: 'link', guest: 'g', to: 'p' }), () => {}, noSleep)).toBe(0)
    const taken = fakeDb(() => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint "issue_numbers_pkey"' }, status: 409 }))
    await expect(runImport(taken.db, WS, one(issueRows(1)), () => {}, noSleep)).rejects.toThrow('Someone added an issue to one of these teams while you were importing, so a number was taken.')
    const twice = fakeDb(() => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint "issues_workspace_id_linear_id_key"' }, status: 409 }))
    await expect(runImport(twice.db, WS, one(issueRows(1)), () => {}, noSleep)).rejects.toThrow('Something here changed while you were importing.')
    const refused = fakeDb(() => ({ error: { code: '42501', message: 'Only admins can import.' }, status: 403 }))
    await expect(runImport(refused.db, WS, one(issueRows(1)), () => {}, noSleep)).rejects.toThrow('Only admins can import.')
    const odd = fakeDb(() => ({ error: { code: 'SP010', message: 'This import has something Sprawniej can’t take.' }, status: 400 }))
    await expect(runImport(odd.db, WS, one(issueRows(1)), () => {}, noSleep)).rejects.toThrow('Something went wrong, so the import stopped partway.')
    expect(errors).toHaveBeenCalled()
  })
})
