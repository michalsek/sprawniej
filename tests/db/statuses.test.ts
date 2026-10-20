import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { CATEGORIES } from '@/model/status'
import { client, closeChannels, defaultStatuses, enabled, expectDenied, expectError, getWorld, newIssue, newWorkspace, ok, ulid, type Someone, type World } from './support'

// A workspace's own statuses (supabase/migrations/20261021140000_statuses.sql): seeded per workspace, kept in step
// with the fixed category in issues.status both ways, hidden instead of deleted, and named in inbox notes.

describe.skipIf(!enabled)('statuses', () => {
  let w: World
  let ws: string
  let eng: string
  let ana: Someone
  let bob: Someone
  let st: Record<string, string>

  beforeAll(async () => {
    w = await getWorld()
    ana = w.ana
    bob = w.bob
    ;({ ws, team: eng } = await newWorkspace(ana, 'statuses'))
    const inv = await ok(ana.db.from('invites').insert({ workspace_id: ws, role: 'member' }).select('token').single())
    await ok(bob.db.rpc('accept_invite', { p_token: inv.token }))
    st = await defaultStatuses(ana, ws)
  }, 60_000)
  afterAll(closeChannels)

  /** a new status of the workspace, made by `who` */
  const newStatus = async (who: Someone, category: string, name: string, more: Record<string, unknown> = {}) => {
    const row = { id: ulid(), workspace_id: ws, kind: 'issue', category, name, color: '#bb87fc', position: `b${ulid()}`, ...more }
    await ok(who.db.from('statuses').insert(row))
    return row.id
  }
  const issue = async (id: string) => ok(ana.db.from('issues').select('status, status_id, updated_at, completed_at').eq('id', id).single())
  const lastEvent = async (id: string) =>
    (await ok(ana.db.from('issue_events').select('changes').eq('issue_id', id).order('id', { ascending: false }).limit(1).single())).changes as Record<string, unknown>

  test('a new workspace starts with one status per category, named and coloured as the app shows them', async () => {
    const rows = await ok(ana.db.from('statuses').select('kind, category, name, color, position, hidden').eq('workspace_id', ws).order('category'))
    expect(rows.sort((a, b) => a.category.localeCompare(b.category))).toEqual(
      CATEGORIES.map((c) => ({ kind: 'issue', category: c.id, name: c.name, color: c.seed, position: 'a0', hidden: false })).sort((a, b) => a.category.localeCompare(b.category)),
    )
  })

  test('an issue without a status gets its category’s default; with one, the category follows', async () => {
    const plain = await newIssue(ana, ws, eng)
    expect(plain).toMatchObject({ status: 'todo', status_id: st.todo })
    const backlog = await newIssue(ana, ws, eng, { status: 'backlog' })
    expect(backlog.status_id).toBe(st.backlog)
    // a done status on a new issue sets completed_at: the category is known before the times are
    const done = await newIssue(ana, ws, eng, { status_id: st.done })
    expect(done.status).toBe('done')
    expect(done.completed_at).not.toBeNull()
    // both sent and disagreeing: the status wins
    const both = await newIssue(ana, ws, eng, { status: 'backlog', status_id: st.in_progress })
    expect(both.status).toBe('in_progress')
  })

  test('moving within a category and across', async () => {
    const testing = await newStatus(ana, 'in_progress', `Testing ${ulid()}`)
    const i = await newIssue(ana, ws, eng)
    await ok(ana.db.from('issues').update({ status_id: testing }).eq('id', i.id))
    expect(await issue(i.id)).toMatchObject({ status: 'in_progress', status_id: testing })
    expect(await lastEvent(i.id)).toEqual({ status: ['todo', 'in_progress'], statusId: [st.todo, testing] })
    const before = await issue(i.id)
    await Bun.sleep(20)
    await ok(ana.db.from('issues').update({ status_id: st.in_progress }).eq('id', i.id))
    const after = await issue(i.id)
    expect(after.updated_at > before.updated_at).toBe(true)
    expect(await lastEvent(i.id)).toEqual({ statusId: [testing, st.in_progress] })

    // Done to another done status keeps completed_at
    const released = await newStatus(ana, 'done', `Released ${ulid()}`)
    await ok(ana.db.from('issues').update({ status_id: st.done }).eq('id', i.id))
    const finished = (await issue(i.id)).completed_at
    expect(finished).not.toBeNull()
    await ok(ana.db.from('issues').update({ status_id: released }).eq('id', i.id))
    expect((await issue(i.id)).completed_at).toBe(finished)
  })

  test('an older app setting only the category lands on that category’s default, hidden ones skipped', async () => {
    const first = await newStatus(ana, 'in_review', `Early review ${ulid()}`, { position: 'Z0' })
    const i = await newIssue(ana, ws, eng)
    await ok(ana.db.from('issues').update({ status: 'in_review' }).eq('id', i.id))
    expect((await issue(i.id)).status_id).toBe(first)
    // the same category again changes nothing
    await ok(ana.db.from('issues').update({ status: 'in_review', title: 'Again' }).eq('id', i.id))
    expect((await issue(i.id)).status_id).toBe(first)
    await ok(ana.db.from('statuses').update({ hidden: true }).eq('id', first))
    const j = await newIssue(ana, ws, eng, { status: 'in_review' })
    expect(j.status_id).toBe(st.in_review)
    // an issue keeps a hidden status
    expect((await issue(i.id)).status_id).toBe(first)
  })

  test('a status of another workspace, or a project status, is refused', async () => {
    const other = await newWorkspace(ana, 'statuses other')
    const theirs = (await defaultStatuses(ana, other.ws)).todo
    const i = await newIssue(ana, ws, eng)
    await expectError(ana.db.from('issues').update({ status_id: theirs }).eq('id', i.id), '22023')
    const project = await newStatus(ana, 'planned', `Planned ${ulid()}`, { kind: 'project' })
    await expectError(ana.db.from('issues').update({ status_id: project }).eq('id', i.id), '22023')
    await ok(ana.db.from('workspaces').delete().eq('id', other.ws))
  })

  test('members add, rename, recolour, reorder and hide; nobody deletes, or changes kind or category', async () => {
    const id = await newStatus(bob, 'todo', `Ready ${ulid()}`)
    const name = `Ready now ${ulid()}`
    await ok(bob.db.from('statuses').update({ name, color: '#f2994a', position: 'a5', hidden: true }).eq('id', id))
    const changed = await ok(ana.db.from('statuses').select('name, color, position, hidden').eq('id', id).single())
    expect(changed).toEqual({ name, color: '#f2994a', position: 'a5', hidden: true })
    await expectDenied(bob.db.from('statuses').update({ category: 'done' }).eq('id', id))
    await expectDenied(bob.db.from('statuses').update({ kind: 'project' }).eq('id', id))
    await expectDenied(ana.db.from('statuses').delete().eq('id', id))
    // someone outside the workspace reads nothing and adds nothing
    expect(await ok(w.cy.db.from('statuses').select().eq('workspace_id', ws))).toEqual([])
    await expectDenied(w.cy.db.from('statuses').insert({ id: ulid(), workspace_id: ws, kind: 'issue', category: 'todo', name: 'Sneaky', color: '#000000', position: 'a0' }))
    await expectDenied(client().from('statuses').select())
  })

  test('names are unique per kind, case aside; an issue status and a project status may share one', async () => {
    const name = `Shared ${ulid()}`
    await newStatus(ana, 'todo', name)
    await expectError(bob.db.from('statuses').insert({ id: ulid(), workspace_id: ws, kind: 'issue', category: 'done', name: name.toUpperCase(), color: '#000000', position: 'a0' }), '23505')
    await newStatus(ana, 'planned', name, { kind: 'project' })
    // bad values are refused
    await expectError(ana.db.from('statuses').insert({ id: ulid(), workspace_id: ws, kind: 'issue', category: 'planned', name: `Wrong ${ulid()}`, color: '#000000', position: 'a0' }), '23514')
    await expectError(ana.db.from('statuses').insert({ id: ulid(), workspace_id: ws, kind: 'issue', category: 'todo', name: `Loud ${ulid()}`, color: 'red', position: 'a0' }), '23514')
    await expectError(ana.db.from('statuses').insert({ id: ulid(), workspace_id: ws, kind: 'issue', category: 'todo', name: '  ', color: '#000000', position: 'a0' }), '23514')
  })

  test('each category keeps a shown status, also when two people hide the last two at once', async () => {
    await expectError(ana.db.from('statuses').update({ hidden: true }).eq('id', st.canceled), '23514')
    const second = await newStatus(ana, 'duplicate', `Same thing ${ulid()}`)
    const results = await Promise.all([
      ana.db.from('statuses').update({ hidden: true }).eq('id', st.duplicate),
      bob.db.from('statuses').update({ hidden: true }).eq('id', second),
    ])
    expect(results.filter((r) => r.error?.code === '23514')).toHaveLength(1)
    const shown = await ok(ana.db.from('statuses').select('id').eq('workspace_id', ws).eq('category', 'duplicate').eq('hidden', false))
    expect(shown).toHaveLength(1)
  })

  test('status notes name the status; the repeat check tells two statuses of one category apart', async () => {
    const i = await newIssue(ana, ws, eng, { status: 'in_progress' })
    const testing = await newStatus(ana, 'in_progress', `Checking ${ulid()}`)
    // an older app: only the category, after the change is saved
    const old = ulid()
    await ok(ana.db.from('inbox').insert({ id: old, workspace_id: ws, recipient_id: bob.profileId, type: 'status', issue_id: i.id, status: 'in_progress' }))
    // the new app: the status, and a category that disagrees is put right
    const mine = ulid()
    await ok(ana.db.from('inbox').insert({ id: mine, workspace_id: ws, recipient_id: bob.profileId, type: 'status', issue_id: i.id, status: 'todo', status_id: testing }))
    // a wrong id is dropped, not refused
    const wrong = ulid()
    await ok(ana.db.from('inbox').insert({ id: wrong, workspace_id: ws, recipient_id: bob.profileId, type: 'assigned', issue_id: i.id, status_id: 'not-a-status-at-all' }))
    const notes = await ok(bob.db.from('inbox').select('id, status, status_id').in('id', [old, mine, wrong]))
    expect(Object.fromEntries(notes.map((n) => [n.id, [n.status, n.status_id]]))).toEqual({
      [old]: ['in_progress', st.in_progress],
      [mine]: ['in_progress', testing],
      [wrong]: [null, null],
    })
  })

  test('the import sends the category: a new issue gets its default, a status stays while its category does', async () => {
    const id = ulid()
    const row = (status: string, title = 'Imported') => ({ id, team_id: eng, title, status, sort_order: 'a0', linear_id: `LIN-${id}` })
    const send = (status: string, title?: string) => ok(ana.db.rpc('import_rows', { p_ws: ws, p_table: 'issues', p_rows: [row(status, title)] }))
    await send('in_progress')
    expect((await issue(id)).status_id).toBe(st.in_progress)
    const custom = await newStatus(ana, 'in_progress', `Building ${ulid()}`)
    await ok(ana.db.from('issues').update({ status_id: custom }).eq('id', id))
    await send('in_progress', 'Imported again')
    expect((await issue(id)).status_id).toBe(custom)
    await send('done')
    expect(await issue(id)).toMatchObject({ status: 'done', status_id: st.done })
    // only the change made here is in the history; the import writes none
    expect(await ok(ana.db.from('issue_events').select('id').eq('issue_id', id))).toHaveLength(1)
  })
})
