import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PROJECT_CATEGORY_INFO } from '@/model/status'
import { closeChannels, defaultStatuses, enabled, expectError, getWorld, newWorkspace, ok, projectInsert, ulid, type Someone, type World } from './support'

// A project's status and place (supabase/migrations/20261021150000_project_statuses.sql): every workspace starts with
// six project statuses, projects.status (the category) and projects.status_id stay in step both ways, and
// projects.sort_order is the place in a board column, which a second import leaves alone.

describe.skipIf(!enabled)('project statuses', () => {
  let w: World
  let ws: string
  let ana: Someone
  let bob: Someone
  let st: Record<string, string>

  beforeAll(async () => {
    w = await getWorld()
    ana = w.ana
    bob = w.bob
    ;({ ws } = await newWorkspace(ana, 'project statuses'))
    const inv = await ok(ana.db.from('invites').insert({ workspace_id: ws, role: 'member' }).select('token').single())
    await ok(bob.db.rpc('accept_invite', { p_token: inv.token }))
    st = await defaultStatuses(ana, ws, 'project')
  }, 60_000)
  afterAll(closeChannels)

  const newStatus = async (category: string, name: string, more: Record<string, unknown> = {}) => {
    const row = { id: ulid(), workspace_id: ws, kind: 'project', category, name, color: '#bb87fc', position: `b${ulid()}`, ...more }
    await ok(ana.db.from('statuses').insert(row))
    return row.id
  }
  const newProject = async (more: Record<string, unknown> = {}) =>
    ok(ana.db.from('projects').insert(projectInsert({ id: ulid(), workspace_id: ws, name: `Project ${ulid()}`, ...more })).select('id, status, status_id, sort_order').single())
  const project = async (id: string) => ok(ana.db.from('projects').select('status, status_id, sort_order').eq('id', id).single())

  test('a new workspace starts with one project status per category, named and coloured as the app shows them', async () => {
    const rows = await ok(ana.db.from('statuses').select('category, name, color, position, hidden').eq('workspace_id', ws).eq('kind', 'project'))
    const byCategory = (a: { category: string }, b: { category: string }) => a.category.localeCompare(b.category)
    expect(rows.sort(byCategory)).toEqual(PROJECT_CATEGORY_INFO.map((c) => ({ category: c.id, name: c.name, color: c.seed, position: 'a0', hidden: false })).sort(byCategory))
  })

  test('a project without a status gets Planned’s default; with one, the category follows; both ways on a change', async () => {
    expect(await newProject()).toMatchObject({ status: 'planned', status_id: st.planned, sort_order: null })
    // an older app: only the category
    expect((await newProject({ status: 'paused' })).status_id).toBe(st.paused)
    const p = await newProject({ status_id: st.in_progress, sort_order: 'a0' })
    expect(p).toMatchObject({ status: 'in_progress', sort_order: 'a0' })
    await ok(ana.db.from('projects').update({ status: 'completed' }).eq('id', p.id))
    expect(await project(p.id)).toMatchObject({ status: 'completed', status_id: st.completed })
    await ok(ana.db.from('projects').update({ status_id: st.backlog }).eq('id', p.id))
    expect(await project(p.id)).toMatchObject({ status: 'backlog', status_id: st.backlog })
  })

  test('an older app’s category lands on its first shown status; a project keeps a hidden one', async () => {
    const first = await newStatus('paused', `On hold ${ulid()}`, { position: 'Z0' })
    const p = await newProject()
    await ok(ana.db.from('projects').update({ status: 'paused' }).eq('id', p.id))
    expect((await project(p.id)).status_id).toBe(first)
    await ok(ana.db.from('statuses').update({ hidden: true }).eq('id', first))
    expect((await newProject({ status: 'paused' })).status_id).toBe(st.paused)
    expect((await project(p.id)).status_id).toBe(first)
  })

  test('an issue status or another workspace’s status is refused', async () => {
    const p = await newProject()
    const issueTodo = (await defaultStatuses(ana, ws)).todo
    await expectError(ana.db.from('projects').update({ status_id: issueTodo }).eq('id', p.id), '22023')
    const other = await newWorkspace(ana, 'project statuses other')
    const theirs = (await defaultStatuses(ana, other.ws, 'project')).planned
    await expectError(ana.db.from('projects').update({ status_id: theirs }).eq('id', p.id), '22023')
    await ok(ana.db.from('workspaces').delete().eq('id', other.ws))
  })

  test('each group keeps a shown project status', async () => {
    await expectError(ana.db.from('statuses').update({ hidden: true }).eq('id', st.canceled), '23514')
  })

  test('members move projects: their status and their place', async () => {
    const p = await newProject()
    await ok(bob.db.from('projects').update({ status_id: st.in_progress, sort_order: 'a5' }).eq('id', p.id))
    expect(await project(p.id)).toMatchObject({ status: 'in_progress', status_id: st.in_progress, sort_order: 'a5' })
  })

  test('the import: the category alone or a status; a second import keeps the place people gave it', async () => {
    const id = ulid()
    const row = (more: Record<string, unknown>) => ({ id, name: 'Imported', emoji: '', description: '', status: 'planned', linear_id: `LIN-${id}`, created_at: '2026-01-01T00:00:00Z', extra: {}, ...more })
    const send = (more: Record<string, unknown>) => ok(ana.db.rpc('import_rows', { p_ws: ws, p_table: 'projects', p_rows: [row(more)] }))
    await send({ status: 'paused', sort_order: 'a1' })
    expect(await project(id)).toMatchObject({ status: 'paused', status_id: st.paused, sort_order: 'a1' })
    const building = await newStatus('in_progress', `Building ${ulid()}`)
    await ok(ana.db.from('projects').update({ sort_order: 'a9' }).eq('id', id))
    await send({ status: 'in_progress', status_id: building, sort_order: 'a2' })
    expect(await project(id)).toMatchObject({ status: 'in_progress', status_id: building, sort_order: 'a9' })
  })
})
