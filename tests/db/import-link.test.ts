import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  addMember,
  closeChannels,
  DISPLAY,
  enabled,
  expectError,
  getWorld,
  listen,
  newIssue,
  newTeam,
  newWorkspace,
  ok,
  projectInsert,
  RUN,
  type Someone,
  ulid,
  type World,
} from './support'
import type { Json } from '@/backend/database.types'

describe.skipIf(!enabled)('imports and people from Linear', () => {
  let w: World
  let team: string
  beforeAll(async () => {
    w = await getWorld()
    team = await newTeam(w.ana, w.ws, 'IMP')
  }, 60_000)
  afterAll(closeChannels)

  const importRows = (table: string, rows: Json[], who: Someone = w.ana, ws = w.ws) =>
    who.db.rpc('import_rows', { p_ws: ws, p_table: table, p_rows: rows })

  test('only admins import, only into the tables an import writes, only guests', async () => {
    await expectError(importRows('labels', [{ id: ulid(), name: 'x', color: '#000' }], w.bob), '42501')
    await expectError(importRows('workspace_members', [{ profile_id: w.cy.profileId }]), 'SP010')
    await expectError(importRows('inbox', [{ id: ulid() }]), 'SP010')
    await expectError(importRows('labels', [{ name: 'no id', color: '#000' }]), 'SP010')
    await expectError(importRows('profiles', [{ id: w.bob.profileId, login: '~bob', name: 'Not Bob' }]), '42501')
    const elsewhere = crypto.randomUUID()
    const label = ulid()
    await ok(importRows('labels', [{ id: label, workspace_id: elsewhere, name: `Pinned ${label}`, color: '#000' }]))
    const row = await ok(w.ana.db.from('labels').select('workspace_id').eq('id', label).single())
    expect(row.workspace_id).toBe(w.ws)
  })

  test('an admin of one workspace can’t change another workspace through an import', async () => {
    // the victim: rows in ana's workspace. The attacker: cy, admin of a workspace of their own.
    const issue = await newIssue(w.ana, w.ws, w.eng, { title: 'Victim issue' })
    const comment = ulid()
    await ok(w.ana.db.from('comments').insert({ id: comment, workspace_id: w.ws, issue_id: issue.id, body: 'Victim comment' }))
    const label = ulid()
    await ok(w.ana.db.from('labels').insert({ id: label, workspace_id: w.ws, name: `Victim ${label}`, color: '#111' }))
    const project = ulid()
    await ok(w.ana.db.from('projects').insert(projectInsert({ id: project, workspace_id: w.ws, name: 'Victim project' })))
    const view = ulid()
    await ok(w.ana.db.from('views').insert({ id: view, workspace_id: w.ws, name: 'Victim view', display: DISPLAY }))
    await ok(w.ana.db.from('issue_followers').insert({ workspace_id: w.ws, issue_id: issue.id, profile_id: w.bob.profileId, following: true }))

    const theirs = await newWorkspace(w.cy, 'attacker')
    const theirIssue = await newIssue(w.cy, theirs.ws, theirs.team)
    const attack = (table: string, row: Json) => expectError(importRows(table, [row], w.cy, theirs.ws), '42501')
    await attack('issues', { id: issue.id, team_id: theirs.team, title: 'Taken', sort_order: 'a0' })
    await attack('comments', { id: comment, issue_id: theirIssue.id, body: 'Taken' })
    await attack('teams', { id: w.eng, key: 'ENG', name: 'Taken' })
    await attack('labels', { id: label, name: 'Taken', color: '#f00' })
    await attack('projects', { id: project, name: 'Taken' })
    await attack('views', { id: view, name: 'Taken', display: DISPLAY })
    await attack('issue_followers', { issue_id: issue.id, profile_id: w.bob.profileId, following: false })

    const victim = await ok(w.ana.db.from('issues').select('title, team_id').eq('id', issue.id).single())
    expect(victim).toEqual({ title: 'Victim issue', team_id: w.eng })
    expect((await ok(w.ana.db.from('comments').select('body').eq('id', comment).single())).body).toBe('Victim comment')
    expect((await ok(w.ana.db.from('teams').select('name').eq('id', w.eng).single())).name).toBe('Engineering')
    expect((await ok(w.ana.db.from('labels').select('name').eq('id', label).single())).name).toBe(`Victim ${label}`)
    expect((await ok(w.ana.db.from('projects').select('name').eq('id', project).single())).name).toBe('Victim project')
    expect((await ok(w.ana.db.from('views').select('name').eq('id', view).single())).name).toBe('Victim view')
    expect(await ok(w.ana.db.from('issue_followers').select('profile_id').eq('issue_id', issue.id))).toEqual([{ profile_id: w.bob.profileId }])
  })

  test('an import never rewrites a comment someone wrote here', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const comment = ulid()
    await ok(w.bob.db.from('comments').insert({ id: comment, workspace_id: w.ws, issue_id: issue.id, body: 'My words' }))
    expect(await ok(importRows('comments', [{ id: comment, issue_id: issue.id, body: 'Rewritten' }]))).toBe(0)
    expect((await ok(w.ana.db.from('comments').select('body').eq('id', comment).single())).body).toBe('My words')
  })

  test('imports keep numbers and times, write no history, send one catch-up message; a re-run changes nothing', async () => {
    const heard = await listen(w.bob, `ws:${w.ws}`)
    expect(heard.status).toBe('SUBSCRIBED')
    const id = ulid()
    const issue = {
      id,
      team_id: team,
      number: 500,
      title: 'From Linear',
      description: '',
      status: 'done',
      priority: 2,
      sort_order: 'a0',
      created_by: w.ana.profileId,
      created_at: '2024-01-02T03:04:05+00:00',
      updated_at: '2024-02-01T00:00:00+00:00',
      completed_at: '2024-02-01T00:00:00+00:00',
      linear_id: `lin-${id}`,
    }
    expect(await ok(importRows('issues', [issue]))).toBe(1)
    const row = await ok(w.ana.db.from('issues').select().eq('id', id).single())
    expect(row.number).toBe(500)
    expect(row.created_at).toBe(issue.created_at)
    expect(row.updated_at).toBe(issue.updated_at)
    expect(row.completed_at).toBe(issue.completed_at)
    const teamRow = await ok(w.ana.db.from('teams').select('last_number').eq('id', team).single())
    expect(teamRow.last_number).toBeGreaterThanOrEqual(500)
    expect(await heard.waitFor((m) => m.op === 'catch_up' && m.table === 'issues')).toBeDefined()
    expect(heard.got.filter((m) => m.table === 'issues' && m.row?.id === id)).toEqual([])

    expect(await ok(importRows('issues', [issue]))).toBe(0)
    const same = await ok(w.ana.db.from('issues').select('changed_at').eq('id', id).single())
    expect(same.changed_at).toBe(row.changed_at)

    expect(await ok(importRows('issues', [{ ...issue, title: 'Renamed in Linear' }]))).toBe(1)
    const renamed = await ok(w.ana.db.from('issues').select('title, number').eq('id', id).single())
    expect(renamed).toEqual({ title: 'Renamed in Linear', number: 500 })
    expect(await ok(w.ana.db.from('issue_events').select().eq('issue_id', id))).toEqual([])

    await expectError(importRows('issues', [{ ...issue, id: ulid(), linear_id: null }]), '23505')
    // numbers stay between 1 and a million, so the counter can't be pushed out of reach
    await expectError(importRows('issues', [{ ...issue, id: ulid(), linear_id: null, number: 2147483647 }]))
    await expectError(importRows('issues', [{ ...issue, id: ulid(), linear_id: null, number: -1 }]))
    expect((await ok(w.ana.db.from('teams').select('last_number').eq('id', team).single())).last_number).toBe(teamRow.last_number)
  })

  test('guest emails are for admins', async () => {
    await ok(w.ana.db.rpc('set_guest_email', { p_profile: w.guest, p_email: 'guest@sprawniej.invalid' }))
    const emails = await ok(w.ana.db.rpc('guest_emails', { p_ws: w.ws }))
    expect(emails).toEqual([{ profile_id: w.guest, email: 'guest@sprawniej.invalid' }])
    await expectError(w.bob.db.rpc('set_guest_email', { p_profile: w.guest, p_email: 'x@y.z' }), '42501')
    expect(await ok(w.bob.db.rpc('guest_emails', { p_ws: w.ws }))).toEqual([])
  })

  test('linking a person from Linear to a member moves everything over', async () => {
    const guest = crypto.randomUUID()
    const guestLogin = `~dbt-${RUN}-g2`
    await ok(importRows('profiles', [{ id: guest, login: guestLogin, name: 'Guest Two' }]))
    const linkTeam = await newTeam(w.ana, w.ws, 'LNK')
    const issue = await newIssue(w.ana, w.ws, linkTeam)
    await ok(w.ana.db.from('issues').update({ assignee_id: guest }).eq('id', issue.id))
    const comment = ulid()
    await ok(importRows('comments', [{ id: comment, issue_id: issue.id, author_id: guest, body: 'Old words' }]))
    const view = ulid()
    const filters = { assignees: [guestLogin, w.bob.login, 'x', null] }
    await ok(w.ana.db.from('views').insert({ id: view, workspace_id: w.ws, name: 'Theirs', filters, display: DISPLAY }))
    // a view with groups: the login moves inside the tree too, and a login that only starts the same stays
    const grouped = ulid()
    const tree = (who: string) => ({
      join: 'and',
      items: [
        { field: 'statuses', op: 'is', values: ['todo'] },
        { join: 'or', items: [{ field: 'assignees', op: 'is', values: [who, `${guestLogin}-x`] }, { field: 'subscribers', op: 'not', values: [who] }] },
      ],
    })
    await ok(w.ana.db.from('views').insert({ id: grouped, workspace_id: w.ws, name: 'Grouped', filters: { statuses: ['todo'], tree: tree(guestLogin) }, display: DISPLAY }))

    await expectError(w.bob.db.rpc('link_person', { p_ws: w.ws, p_guest: guest, p_to: w.bob.profileId }), '42501')
    await ok(w.ana.db.rpc('link_person', { p_ws: w.ws, p_guest: guest, p_to: w.bob.profileId }))

    const moved = await ok(w.ana.db.from('issues').select('assignee_id').eq('id', issue.id).single())
    expect(moved.assignee_id).toBe(w.bob.profileId)
    const said = await ok(w.ana.db.from('comments').select('author_id').eq('id', comment).single())
    expect(said.author_id).toBe(w.bob.profileId)
    // the guest becomes bob, and bob, already there, isn't listed twice
    const after = await ok(w.ana.db.from('views').select('filters').eq('id', view).single())
    expect(after.filters).toEqual({ assignees: [w.bob.login, 'x', null] })
    const afterTree = await ok(w.ana.db.from('views').select('filters').eq('id', grouped).single())
    expect(afterTree.filters).toEqual({ statuses: ['todo'], tree: tree(w.bob.login) })
    const history = await ok(w.ana.db.from('issue_events').select('changes').eq('issue_id', issue.id))
    expect(history.map((e) => e.changes)).toEqual([{ assignee: [null, w.bob.profileId] }])
    expect(await ok(w.ana.db.from('team_members').select().eq('team_id', linkTeam).eq('profile_id', w.bob.profileId))).toHaveLength(1)
    expect(await ok(w.ana.db.from('profiles').select().eq('id', guest))).toEqual([])
    const gone = await ok(w.ana.db.from('deletions').select('row_key').eq('workspace_id', w.ws).eq('table_name', 'profiles'))
    expect(gone.map((d) => d.row_key)).toContainEqual({ id: guest })
  })

  test('a person from Linear can only be linked to someone who is still in the workspace', async () => {
    const { ws } = await newWorkspace(w.ana, 'link removed')
    await addMember(w.ana, w.dee, ws)
    await ok(w.ana.db.from('workspace_members').update({ removed_at: new Date().toISOString() }).eq('workspace_id', ws).eq('profile_id', w.dee.profileId))
    const guest = crypto.randomUUID()
    await ok(importRows('profiles', [{ id: guest, login: `~dbt-${RUN}-g4`, name: 'Guest Four' }], w.ana, ws))
    await expectError(w.ana.db.rpc('link_person', { p_ws: ws, p_guest: guest, p_to: w.dee.profileId }), '22023')
  })
})
