import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { applyRows, emptyLive, type Incoming, type LiveState, type StoreSlice } from '@/backend/apply'
import { fetchByKeys, loadAll, loadArchived, loadChanged, planFetch, sinceMark } from '@/backend/load'
import { Registry } from '@/backend/registry'
import { EMPTY } from '@/data/store'
import { closeChannels, enabled, getWorld, newIssue, newWorkspace, ok, ulid, type World } from './support'

const fresh = (): StoreSlice => ({ ...EMPTY })

describe.skipIf(!enabled)('reading a workspace', () => {
  let w: World
  let ws: string
  let eng: string
  let label: string
  let open: string
  let done: string
  beforeAll(async () => {
    w = await getWorld()
    ;({ ws, team: eng } = await newWorkspace(w.ana, 'load'))
    label = ulid()
    await ok(w.ana.db.from('labels').insert({ id: label, workspace_id: ws, name: 'Bug', color: '#eb5757' }))
    open = (await newIssue(w.ana, ws, eng, { title: 'Open one' })).id
    await ok(w.ana.db.from('issue_labels').insert({ workspace_id: ws, issue_id: open, label_id: label }))
    await ok(w.ana.db.from('comments').insert({ id: ulid(), workspace_id: ws, issue_id: open, body: 'On the open one' }))
    done = (await newIssue(w.ana, ws, eng, { title: 'Archived one', status: 'done' })).id
    await ok(w.ana.db.from('comments').insert({ id: ulid(), workspace_id: ws, issue_id: done, body: 'On the archived one' }))
    await ok(w.ana.db.from('issues').update({ archived_at: new Date().toISOString() }).eq('id', done))
  }, 60_000)
  afterAll(closeChannels)

  const apply = (state: LiveState, inputs: Incoming[], registry = new Registry()) =>
    applyRows(state, fresh(), inputs, { workspaceId: ws, meId: w.ana.profileId, registry })

  test('opening reads the open issues with their labels and comments, the teams, the people', async () => {
    const inputs = await loadAll(w.ana.db, ws, w.ana.profileId)
    const r = apply(emptyLive(), inputs)
    expect(r.patch.workspace?.name).toEndWith(' load')
    expect(Object.keys(r.patch.teams ?? {})).toEqual(['ENG'])
    expect(r.patch.teams?.ENG.members).toEqual([w.ana.login])
    expect(r.patch.labels?.[label]?.name).toBe('Bug')
    expect(r.patch.members?.[w.ana.login]?.role).toBe('owner')
    expect(r.patch.people?.[w.ana.login]?.name).toBe('Test ana')
    expect(r.patch.issues?.[open]?.labels).toEqual([label])
    expect(r.patch.comments?.[open]?.map((c) => c.body)).toEqual(['On the open one'])
    expect(r.patch.issues?.[done]).toBeUndefined()
    expect(r.patch.comments?.[done]).toBeUndefined()
    expect(r.fetch).toEqual([])
    expect(r.state.mark).not.toBeNull()
  })

  test('the archive comes on its own, with its comments', async () => {
    const r = apply(emptyLive(), [...(await loadAll(w.ana.db, ws, w.ana.profileId)), ...(await loadArchived(w.ana.db, ws))])
    expect(r.patch.archive?.[done]?.title).toBe('Archived one')
    expect(r.patch.archive?.[done]?.comments?.map((c) => c.body)).toEqual(['On the archived one'])
    expect(r.patch.archive?.[open]).toBeUndefined()
  })

  test('catching up brings changed rows and deletions', async () => {
    const registry = new Registry()
    const first = apply(emptyLive(), await loadAll(w.ana.db, ws, w.ana.profileId), registry)
    const since = sinceMark(first.state.mark!, 0)
    await ok(w.ana.db.from('issues').update({ title: 'Renamed' }).eq('id', open))
    await ok(w.ana.db.from('issue_labels').delete().eq('issue_id', open).eq('label_id', label))
    const members = new Set([w.ana.profileId])
    const changed = await loadChanged(w.ana.db, ws, w.ana.profileId, since, members)
    expect(changed.gone).toBe(false)
    expect(changed.full).toEqual([])
    const issues = changed.inputs.find((i) => i.from === 'fetch' && i.table === 'issues')
    // archived issues count too (the archiving came after everything the first read saw)
    expect(issues?.from === 'fetch' && issues.rows.map((r) => r.title)).toContain('Renamed')
    const deletions = changed.inputs.find((i) => i.from === 'deletions')
    expect(deletions?.from === 'deletions' && deletions.rows.map((d) => d.row_key)).toEqual([{ issue_id: open, label_id: label }])
    const next = applyRows(first.state, { ...fresh(), ...first.patch } as StoreSlice, changed.inputs, { workspaceId: ws, meId: w.ana.profileId, registry })
    expect(next.patch.issues?.[open]?.title).toBe('Renamed')
    expect(next.patch.issues?.[open]?.labels).toEqual([])
  })

  test('rows asked for by key, a new issue with its parts', async () => {
    const groups = planFetch([{ table: 'issues', key: { id: open } }, { table: 'labels', key: { id: label } }])
    const inputs = await fetchByKeys(w.ana.db, ws, groups, [open])
    const tables = inputs.flatMap((i) => (i.from === 'fetch' && i.rows.length ? [i.table] : []))
    expect(tables.sort()).toEqual(['comments', 'issues', 'labels'])
  })

  test('a workspace you are not in reads as gone', async () => {
    const changed = await loadChanged(w.cy.db, ws, w.cy.profileId, '2026-01-01T00:00:00Z', new Set())
    expect(changed.gone).toBe(true)
  })
})
