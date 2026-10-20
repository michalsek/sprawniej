import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { applyRows, emptyLive } from '@/backend/apply'
import { ImportProblem, planImport, readExisting, runImport, type ImportPlan, type ImportStep } from '@/backend/importRows'
import { Loader } from '@/backend/load'
import { Registry } from '@/backend/registry'
import { EMPTY } from '@/data/store'
import type { LinearData } from '@/features/import/linearApi'
import type { ImportChoices, ImportResult } from '@/features/import/linearMap'
import { prepareImport } from '@/features/import/prepareImport'
import { linearFixture } from '../fixtures/linear'
import { anyTable, closeChannels, defaultStatuses, enabled, getWorld, newIssue, newWorkspace, ok, ulid, type Someone, type World } from './support'

// The Linear import end to end against the real database: the fixture goes in through import_rows, the way the
// wizard sends it, and comes back out through the loader. Running it again changes nothing.

const NOW = '2026-10-19T12:00:00.000Z'
/** the fixture, plus a comment on an issue that goes straight to the archive */
const fixture: LinearData = {
  ...linearFixture,
  comments: [...linearFixture.comments, { id: 'c-4', body: 'Archived talk', createdAt: '2026-01-05T00:00:00.000Z', user: { id: 'u-bob', name: 'Bob Stone' }, issue: { id: 'i-2' } }],
}
/** tables with a workspace_id and a changed_at */
const STAMPED = ['teams', 'team_members', 'labels', 'projects', 'project_teams', 'issues', 'issue_labels', 'issue_followers', 'comments', 'views', 'workspace_members'] as const

describe.skipIf(!enabled)('importing from Linear', () => {
  let w: World
  let ws: string
  let eng: string
  let choices: ImportChoices
  let first: { plan: ImportPlan; result: ImportResult }
  const seen: number[] = []

  /** the workspace as the app holds it, the extras, and what the import would do now */
  async function prepare(d: LinearData, who: Someone = w.ana, into = ws) {
    const registry = new Registry()
    const loader = new Loader(who.db, into, who.profileId)
    const inputs = [...(await loader.all()), ...(await loader.archived())]
    const r = applyRows(emptyLive(), { ...EMPTY }, inputs, { workspaceId: into, meId: who.profileId, registry })
    const store = { ...EMPTY, ...r.patch }
    const extras = await readExisting(who.db, into, registry)
    const { plan, result } = prepareImport(store, extras, d, choices, {
      now: NOW,
      newId: ulid,
      newGuestId: () => crypto.randomUUID(),
      plan: (r, existing) => planImport(r, existing, { workspaceId: into, registry, newTeamId: () => crypto.randomUUID() }),
    })
    return { plan, result, extras }
  }

  /** the latest change in the workspace, over every table that keeps one, and its people from Linear */
  async function latest(): Promise<string> {
    const stamps = await Promise.all([
      ...STAMPED.map((t) => ok(anyTable(w.ana.db, t).select('changed_at').eq('workspace_id', ws).order('changed_at', { ascending: false }).limit(1))),
      ok(w.ana.db.from('profiles').select('changed_at').eq('guest_of', ws).order('changed_at', { ascending: false }).limit(1)),
    ])
    return stamps.flatMap((rows) => (rows as { changed_at: string }[]).map((r) => r.changed_at)).sort().at(-1) ?? ''
  }

  /** how many rows changed after `since` */
  async function changedSince(since: string): Promise<number> {
    const counts = await Promise.all([
      ...STAMPED.map(async (t) => (await ok(anyTable(w.ana.db, t).select('changed_at').eq('workspace_id', ws).gt('changed_at', since))).length),
      (async () => (await ok(w.ana.db.from('profiles').select('changed_at').eq('guest_of', ws).gt('changed_at', since))).length)(),
    ])
    return counts.reduce((a, b) => a + b, 0)
  }

  beforeAll(async () => {
    w = await getWorld()
    ;({ ws, team: eng } = await newWorkspace(w.ana, 'linear'))
    choices = {
      teamKeys: { 't-eng': 'ENG', 't-des': 'DES' },
      people: { 'u-ana': w.ana.login, 'u-bob': '~bob-stone', 'u-old': null, 'u-cat': '~cat-wong' },
    }
    first = await prepare(fixture)
    await runImport(w.ana.db, ws, first.plan, (saved) => seen.push(saved))
  }, 120_000)
  afterAll(closeChannels)

  test('the first import brings everything over, numbers and order kept, without history', async () => {
    expect(seen.at(-1)).toBe(first.plan.total)
    const teams = await ok(w.ana.db.from('teams').select('id, key, linear_id').eq('workspace_id', ws).order('key'))
    expect(teams.map((t) => [t.key, t.linear_id])).toEqual([
      ['DES', 't-des'],
      ['ENG', 't-eng'],
    ])
    expect(teams.find((t) => t.key === 'ENG')?.id).toBe(eng)
    const issues = await ok(w.ana.db.from('issues').select('id, linear_id, number, team_id, parent_id, archived_at').eq('workspace_id', ws).order('linear_id'))
    const byLinear = Object.fromEntries(issues.map((i) => [i.linear_id, i]))
    expect(issues.map((i) => [i.linear_id, i.number, i.team_id === eng ? 'ENG' : 'DES', !!i.archived_at])).toEqual([
      ['i-1', 1, 'ENG', false],
      ['i-2', 2, 'ENG', true],
      ['i-3', 3, 'ENG', false],
      ['i-9', 9, 'DES', true],
    ])
    expect(byLinear['i-2'].parent_id).toBe(byLinear['i-1'].id)
    const labels = await ok(w.ana.db.from('labels').select('id, name').eq('workspace_id', ws))
    expect(labels.map((l) => l.name).sort()).toEqual(['Area: Charts', 'Bug', 'Unused'])
    const name = (id: string) => labels.find((l) => l.id === id)?.name
    const onCharts = await ok(w.ana.db.from('issue_labels').select('label_id').eq('issue_id', byLinear['i-1'].id).order('changed_at'))
    expect(onCharts.map((l) => name(l.label_id))).toEqual(['Bug', 'Area: Charts'])
    const projects = await ok(w.ana.db.from('projects').select('id, name, status, status_id, sort_order').eq('workspace_id', ws))
    expect(projects.map((p) => p.name)).toEqual(['Launch'])
    // Linear's "started" is the In progress group: its first status, at the bottom of that column
    expect(projects[0]).toMatchObject({ status: 'in_progress', status_id: (await defaultStatuses(w.ana, ws, 'project')).in_progress })
    expect(projects[0].sort_order).not.toBeNull()
    expect(await ok(w.ana.db.from('project_teams').select('team_id').eq('project_id', projects[0].id))).toEqual([{ team_id: eng }])
    const comments = await ok(w.ana.db.from('comments').select('linear_id, issue_id').eq('workspace_id', ws).order('linear_id'))
    expect(comments.map((c) => c.linear_id)).toEqual(['c-1', 'c-2', 'c-4'])
    expect(comments.find((c) => c.linear_id === 'c-4')?.issue_id).toBe(byLinear['i-2'].id)
    const views = await ok(w.ana.db.from('views').select('id').eq('workspace_id', ws))
    expect(views).toHaveLength(first.result.counts.views)
    const guests = await ok(w.ana.db.from('profiles').select('id, login, linear_ids').eq('guest_of', ws).order('login'))
    expect(guests.map((g) => [g.login, g.linear_ids])).toEqual([
      ['~bob-stone', ['u-bob']],
      ['~cat-wong', ['u-cat']],
    ])
    const emails = await ok(w.ana.db.rpc('guest_emails', { p_ws: ws }))
    expect(emails).toEqual([{ profile_id: guests[0].id, email: 'bstone@acme.dev' }])
    expect(await ok(w.ana.db.from('issue_events').select('id').eq('workspace_id', ws))).toEqual([])
  })

  test('running it again changes nothing', async () => {
    const m0 = await latest()
    const again = await prepare(fixture)
    expect(again.plan.total).toBe(0)
    expect(again.extras.archived.map((a) => a.linearId).sort()).toEqual(['i-2', 'i-9'])
    expect(again.extras.archivedComments.map((c) => c.linearId)).toEqual(['c-4'])
    // the first plan, sent once more (an import that is tried again after it got through)
    expect(await runImport(w.ana.db, ws, first.plan, () => {})).toBe(0)
    expect(await latest()).toBe(m0)
  })

  test('one issue renamed in Linear changes that one row', async () => {
    const m0 = await latest()
    const renamed = { ...fixture, issues: fixture.issues.map((i) => (i.id === 'i-3' ? { ...i, title: 'Old idea, renamed' } : i)) }
    const p = await prepare(renamed)
    expect(p.result.issues.map((i) => i.linearId)).toEqual(['i-3'])
    expect(await runImport(w.ana.db, ws, p.plan, () => {})).toBe(1)
    expect(await changedSince(m0)).toBe(1)
    expect((await ok(w.ana.db.from('issues').select('title').eq('workspace_id', ws).eq('linear_id', 'i-3').single())).title).toBe('Old idea, renamed')
  })

  test('a label taken off in Linear is taken off here', async () => {
    const charts = await ok(w.ana.db.from('issues').select('id').eq('workspace_id', ws).eq('linear_id', 'i-1').single())
    const bug = await ok(w.ana.db.from('labels').select('id').eq('workspace_id', ws).eq('name', 'Bug').single())
    const off = { ...fixture, issues: fixture.issues.map((i) => (i.id === 'i-1' ? { ...i, labels: { nodes: [{ id: 'l-charts' }] } } : i)) }
    const p = await prepare(off)
    expect(p.result.removedLabels).toEqual([{ issue: charts.id, label: bug.id }])
    await runImport(w.ana.db, ws, p.plan, () => {})
    expect(await ok(w.ana.db.from('issue_labels').select('label_id').eq('issue_id', charts.id).eq('label_id', bug.id))).toEqual([])
    const gone = await ok(w.ana.db.from('deletions').select('row_key').eq('workspace_id', ws).eq('table_name', 'issue_labels'))
    expect(gone.map((d) => d.row_key)).toContainEqual({ issue_id: charts.id, label_id: bug.id })
    expect((await prepare(off)).plan.total).toBe(0)
  })

  test('an import that stopped partway, run again: its new team gets members, its guests their emails', async () => {
    const other = await newWorkspace(w.ana, 'linear partway')
    const full = await prepare(fixture, w.ana, other.ws)
    // it stopped right after making the teams and the guests: before the members and every email
    const upTo = full.plan.steps.findIndex((s: ImportStep) => s.kind === 'rows' && s.table === 'team_members')
    await runImport(w.ana.db, other.ws, { ...full.plan, steps: full.plan.steps.slice(0, upTo) }, () => {})
    const des = await ok(w.ana.db.from('teams').select('id').eq('workspace_id', other.ws).eq('key', 'DES').single())
    expect(await ok(w.ana.db.from('team_members').select('profile_id').eq('team_id', des.id))).toEqual([])
    expect(await ok(w.ana.db.rpc('guest_emails', { p_ws: other.ws }))).toEqual([])
    // worked out again from what's here (a reload): the rest comes, members and emails too
    const again = await prepare(fixture, w.ana, other.ws)
    expect(again.result.teams).toEqual([])
    await runImport(w.ana.db, other.ws, again.plan, () => {})
    expect(await ok(w.ana.db.from('team_members').select('profile_id').eq('team_id', des.id))).toEqual([{ profile_id: w.ana.profileId }])
    const emails = await ok(w.ana.db.rpc('guest_emails', { p_ws: other.ws }))
    expect(emails.map((e) => e.email)).toEqual(['bstone@acme.dev'])
    expect((await prepare(fixture, w.ana, other.ws)).plan.total).toBe(0)
  })

  test('a number taken while importing stops it, saying why', async () => {
    const other = await newWorkspace(w.ana, 'linear taken')
    const p = await prepare(fixture, w.ana, other.ws)
    await newIssue(w.ana, other.ws, other.team, { title: 'Made here meanwhile' })
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const run = runImport(w.ana.db, other.ws, p.plan, () => {}, () => Promise.resolve())
      await expect(run).rejects.toBeInstanceOf(ImportProblem)
      await expect(run).rejects.toThrow('Someone added an issue to one of these teams while you were importing, so a number was taken.')
    } finally {
      quiet.mockRestore()
    }
  })
})
