import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { client, closeChannels, enabled, RUN, expectDenied, getWorld, newIssue, ok, TABLES, ulid, wsColumn, type World } from './support'

describe.skipIf(!enabled)('who sees and changes what', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, 60_000)
  afterAll(closeChannels)

  test('someone outside the workspace sees nothing and changes nothing', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng, { title: 'Private' })
    for (const t of TABLES) {
      const rows = await ok(w.cy.db.from(t).select().eq(wsColumn(t), w.ws))
      expect({ t, rows }).toEqual({ t, rows: [] })
    }
    const { error } = await w.cy.db.from('issues').insert({ id: ulid(), workspace_id: w.ws, team_id: w.eng, title: 'x', sort_order: 'a0' })
    expect(error?.code).toBe('42501')
    expect(await ok(w.cy.db.from('issues').update({ title: 'Hacked' }).eq('id', issue.id).select())).toEqual([])
    const same = await ok(w.ana.db.from('issues').select('title').eq('id', issue.id).single<{ title: string }>())
    expect(same.title).toBe('Private')
    const moved = await w.cy.db.rpc('move_issue_to_team', { p_issue: issue.id, p_team: w.des })
    expect(moved.error).not.toBeNull()
  })

  test('nobody who is signed out gets anything', async () => {
    await expectDenied(client().from('issues').select())
    await expectDenied(client().rpc('ensure_profile'))
  })

  test('people see themselves, the people they work with and the workspace guests', async () => {
    const ids = [w.ana.profileId, w.bob.profileId, w.cy.profileId, w.guest]
    const seenByCy = await ok(w.cy.db.from('profiles').select('id').in('id', ids))
    expect(seenByCy.map((p) => p.id)).toEqual([w.cy.profileId])
    const seenByBob = (await ok(w.bob.db.from('profiles').select('id').in('id', ids))).map((p) => p.id).sort()
    expect(seenByBob).toEqual([w.ana.profileId, w.bob.profileId, w.guest].sort())
  })

  test('members who are not admins see no invites and make none', async () => {
    expect(await ok(w.bob.db.from('invites').select().eq('workspace_id', w.ws))).toEqual([])
    await expectDenied(w.bob.db.from('invites').insert({ workspace_id: w.ws }))
  })

  test('only admins delete teams; every member deletes labels, projects, views and issues', async () => {
    expect(await ok(w.bob.db.from('teams').delete().eq('id', w.des).select())).toEqual([])
    expect(await ok(w.ana.db.from('teams').select('id').eq('id', w.des))).toHaveLength(1)

    const team = crypto.randomUUID()
    await ok(w.bob.db.from('teams').insert({ id: team, workspace_id: w.ws, key: 'GONE', name: 'Gone' }))
    expect(await ok(w.ana.db.from('teams').delete().eq('id', team).select('id'))).toHaveLength(1)

    const label = ulid()
    await ok(w.ana.db.from('labels').insert({ id: label, workspace_id: w.ws, name: `Bug ${label}`, color: '#eb5757' }))
    const project = ulid()
    await ok(w.ana.db.from('projects').insert({ id: project, workspace_id: w.ws, name: 'Charts' }))
    const view = ulid()
    await ok(w.ana.db.from('views').insert({ id: view, workspace_id: w.ws, name: 'Mine', display: {} }))
    const issue = await newIssue(w.ana, w.ws, w.eng)
    expect(await ok(w.bob.db.from('labels').delete().eq('id', label).select('id'))).toHaveLength(1)
    expect(await ok(w.bob.db.from('projects').delete().eq('id', project).select('id'))).toHaveLength(1)
    expect(await ok(w.bob.db.from('views').delete().eq('id', view).select('id'))).toHaveLength(1)
    expect(await ok(w.bob.db.from('issues').delete().eq('id', issue.id).select('id'))).toHaveLength(1)
  })

  test('only admins rename the workspace', async () => {
    expect(await ok(w.bob.db.from('workspaces').update({ name: 'Renamed by bob' }).eq('id', w.ws).select())).toEqual([])
    const renamed = await ok(w.ana.db.from('workspaces').update({ name: `dbtest ${RUN} main` }).eq('id', w.ws).select('name'))
    expect(renamed).toHaveLength(1)
  })
})
