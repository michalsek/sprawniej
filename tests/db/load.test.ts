import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { applyRows, emptyLive, type Incoming, type LiveState, type StoreSlice } from '@/backend/apply'
import { Loader, planFetch, sinceMark } from '@/backend/load'
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

  const as = (who: World['ana'], page?: number) => new Loader(who.db, ws, who.profileId, { page })
  const apply = (state: LiveState, inputs: Incoming[], registry = new Registry()) =>
    applyRows(state, fresh(), inputs, { workspaceId: ws, meId: w.ana.profileId, registry })

  test('opening reads the open issues with their labels and comments, the teams, the people', async () => {
    const inputs = await as(w.ana).all()
    const r = apply(emptyLive(), inputs)
    expect(r.patch.workspace?.name).toEndWith(' load')
    expect(Object.keys(r.patch.teams ?? {})).toEqual(['ENG'])
    expect(r.patch.teams?.ENG.members).toEqual([w.ana.login])
    expect(r.patch.labels?.[label]?.name).toBe('Bug')
    // the statuses the workspace started with, and every issue on one of them
    const statuses = Object.values(r.patch.statuses ?? {})
    expect(statuses.filter((s) => s.kind === 'issue').map((s) => s.category).sort()).toEqual(['backlog', 'canceled', 'done', 'duplicate', 'in_progress', 'in_review', 'todo'])
    expect(statuses.filter((s) => s.kind === 'project').map((s) => s.category).sort()).toEqual(['backlog', 'canceled', 'completed', 'in_progress', 'paused', 'planned'])
    expect(Object.values(r.patch.issues ?? {}).every((i) => r.patch.statuses?.[i.statusId]?.category === i.status)).toBe(true)
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
    const r = apply(emptyLive(), [...(await as(w.ana).all()), ...(await as(w.ana).archived())])
    expect(r.patch.archive?.[done]?.title).toBe('Archived one')
    expect(r.patch.archive?.[done]?.comments?.map((c) => c.body)).toEqual(['On the archived one'])
    expect(r.patch.archive?.[open]).toBeUndefined()
  })

  test('catching up brings changed rows and deletions', async () => {
    const registry = new Registry()
    const first = apply(emptyLive(), await as(w.ana).all(), registry)
    const since = sinceMark(first.state.mark!, 0)
    await ok(w.ana.db.from('issues').update({ title: 'Renamed' }).eq('id', open))
    await ok(w.ana.db.from('issue_labels').delete().eq('issue_id', open).eq('label_id', label))
    const members = new Set([w.ana.profileId])
    const changed = await as(w.ana).changed(since, members)
    expect(changed.gone).toBe(false)
    const issues = changed.inputs.find((i) => i.from === 'fetch' && i.table === 'issues')
    // archived issues count too: archiving one came after everything the first read saw
    const titles = issues?.from === 'fetch' ? issues.rows.map((r) => r.title) : []
    expect(titles).toContain('Renamed')
    expect(titles).toContain('Archived one')
    const deletions = changed.inputs.find((i) => i.from === 'deletions')
    expect(deletions?.from === 'deletions' && deletions.rows.map((d) => d.row_key)).toEqual([{ issue_id: open, label_id: label }])
    const next = applyRows(first.state, { ...fresh(), ...first.patch } as StoreSlice, changed.inputs, { workspaceId: ws, meId: w.ana.profileId, registry })
    expect(next.patch.issues?.[open]?.title).toBe('Renamed')
    expect(next.patch.issues?.[open]?.labels).toEqual([])
  })

  test('catching up reads every changed row page after page, archived ones too, and only this workspace’s people', async () => {
    const first = apply(emptyLive(), await as(w.ana).all())
    const since = sinceMark(first.state.mark!, 0)
    const made = await Promise.all([1, 2, 3, 4, 5].map((n) => newIssue(w.ana, ws, eng, { title: `Changed ${n}` })))
    const archived = made.slice(0, 2).map((i) => i.id)
    await ok(w.ana.db.from('issues').update({ archived_at: new Date().toISOString() }).in('id', archived))
    // bob is in ana's other workspace only: his change isn't this one's
    await ok(w.bob.db.from('profiles').update({ name: 'Bob elsewhere' }).eq('id', w.bob.profileId))
    const changed = await as(w.ana, 2).changed(since, new Set([w.ana.profileId]))
    const rows = (t: string) => changed.inputs.flatMap((i) => (i.from === 'fetch' && i.table === t ? i.rows : []))
    const ids = rows('issues').map((r) => String(r.id))
    for (const i of made) expect(ids).toContain(i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(rows('issues').filter((r) => archived.includes(String(r.id))).every((r) => r.archived_at !== null)).toBe(true)
    expect(rows('profiles').map((r) => r.id)).not.toContain(w.bob.profileId)
  })

  test('the inbox’s note ids, page after page', async () => {
    // notes go to teammates: ana tells bob, in the workspace they share
    const issues = await Promise.all([1, 2, 3].map(() => newIssue(w.ana, w.ws, w.eng)))
    const notes = [ulid(), ulid(), ulid()]
    await ok(w.ana.db.from('inbox').insert(notes.map((id, n) => ({ id, workspace_id: w.ws, recipient_id: w.bob.profileId, type: 'assigned', issue_id: issues[n].id }))))
    await ok(w.bob.db.from('inbox').delete().eq('id', notes[1]))
    const bob = (page?: number) => new Loader(w.bob.db, w.ws, w.bob.profileId, { page })
    const ids = await bob(1).inboxIds()
    expect(ids.has(notes[0]) && ids.has(notes[2])).toBe(true)
    expect(ids.has(notes[1])).toBe(false)
    const all = (await bob().all()).flatMap((i) => (i.from === 'fetch' && i.table === 'inbox' ? i.rows.map((r) => String(r.id)) : []))
    expect([...ids].sort()).toEqual(all.sort())
  })

  test('your favourites: opening reads them in your order, and their ids page after page', async () => {
    const projects = [ulid(), ulid(), ulid()]
    await ok(w.ana.db.from('projects').insert(projects.map((id) => ({ id, workspace_id: ws, name: 'Starred' }))))
    await ok(
      w.ana.db
        .from('favourites')
        .insert(projects.map((item_id, n) => ({ profile_id: w.ana.profileId, workspace_id: ws, kind: 'project', item_id, sort_order: `a${projects.length - n}` }))),
    )
    expect([...(await as(w.ana, 1).favouriteIds())].sort()).toEqual([...projects].sort())
    const r = apply(emptyLive(), await as(w.ana).all())
    expect(r.patch.favourites?.map((f) => f.id)).toEqual([...projects].reverse())
  })

  test('rows asked for by key, a new issue with its parts', async () => {
    const groups = planFetch([{ table: 'issues', key: { id: open } }, { table: 'labels', key: { id: label } }])
    const inputs = await as(w.ana).byKeys(groups, [open])
    const tables = inputs.flatMap((i) => (i.from === 'fetch' && i.rows.length ? [i.table] : []))
    expect(tables.sort()).toEqual(['comments', 'issues', 'labels'])
  })

  test('page after page, whatever the page size: everything comes, nothing twice', async () => {
    const more = [(await newIssue(w.ana, ws, eng)).id, (await newIssue(w.ana, ws, eng)).id]
    const second = ulid()
    await ok(w.ana.db.from('labels').insert({ id: second, workspace_id: ws, name: 'Second', color: '#000000' }))
    // two rows with the same first key column: the page after one goes on within the issue
    await ok(w.ana.db.from('issue_labels').insert([label, second].map((label_id) => ({ workspace_id: ws, issue_id: more[0], label_id }))))
    for (const body of ['One', 'Two']) await ok(w.ana.db.from('comments').insert({ id: ulid(), workspace_id: ws, issue_id: more[1], body }))
    const inputs = await as(w.ana, 1).all()
    const rows = (t: string) => inputs.flatMap((i) => (i.from === 'fetch' && i.table === t ? i.rows : []))
    const whole = await as(w.ana).all()
    const wholeRows = (t: string) => whole.flatMap((i) => (i.from === 'fetch' && i.table === t ? i.rows : []))
    const key = (r: Record<string, unknown>) => String(r.id ?? `${String(r.issue_id)}|${String(r.label_id)}`)
    for (const t of ['issues', 'comments', 'labels', 'issue_labels']) {
      expect(rows(t).map(key).sort()).toEqual(wholeRows(t).map(key).sort())
      expect(new Set(rows(t).map(key)).size).toBe(rows(t).length)
    }
    expect(rows('issues').length).toBeGreaterThanOrEqual(3)
    expect(rows('issue_labels').length).toBe(2)
    expect(rows('comments').length).toBe(3)
  })

  test('a workspace you are not in reads as gone', async () => {
    const changed = await as(w.cy).changed('2026-01-01T00:00:00Z', new Set())
    expect(changed.gone).toBe(true)
  })
})
