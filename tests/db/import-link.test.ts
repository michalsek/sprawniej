import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { closeChannels, DISPLAY, enabled, expectError, getWorld, listen, newIssue, newTeam, ok, RUN, ulid, type World } from './support'

describe.skipIf(!enabled)('imports and people from Linear', () => {
  let w: World
  let team: string
  beforeAll(async () => {
    w = await getWorld()
    team = await newTeam(w.ana, w.ws, 'IMP')
  }, 60_000)
  afterAll(closeChannels)

  const importRows = (who = w.ana, table: string, rows: unknown[], ws = w.ws) =>
    who.db.rpc('import_rows', { p_ws: ws, p_table: table, p_rows: rows })

  test('only admins import, only into the tables an import writes, only guests', async () => {
    await expectError(importRows(w.bob, 'labels', [{ id: ulid(), name: 'x', color: '#000' }]), '42501')
    await expectError(importRows(w.ana, 'workspace_members', [{ profile_id: w.cy.profileId }]), '22023')
    await expectError(importRows(w.ana, 'inbox', [{ id: ulid() }]), '22023')
    await expectError(importRows(w.ana, 'profiles', [{ id: w.bob.profileId, login: '~bob', name: 'Not Bob' }]), '42501')
    const elsewhere = crypto.randomUUID()
    const label = ulid()
    await ok(importRows(w.ana, 'labels', [{ id: label, workspace_id: elsewhere, name: `Pinned ${label}`, color: '#000' }]))
    const row = await ok(w.ana.db.from('labels').select('workspace_id').eq('id', label).single<{ workspace_id: string }>())
    expect(row.workspace_id).toBe(w.ws)
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
    expect(await ok(importRows(w.ana, 'issues', [issue]))).toBe(1)
    const row = await ok(w.ana.db.from('issues').select().eq('id', id).single<Record<string, any>>())
    expect(row.number).toBe(500)
    expect(row.created_at).toBe(issue.created_at)
    expect(row.updated_at).toBe(issue.updated_at)
    expect(row.completed_at).toBe(issue.completed_at)
    const teamRow = await ok(w.ana.db.from('teams').select('last_number').eq('id', team).single<{ last_number: number }>())
    expect(teamRow.last_number).toBeGreaterThanOrEqual(500)
    expect(await heard.waitFor((m) => m.op === 'catch_up' && m.table === 'issues')).toBeDefined()
    expect(heard.got.filter((m) => m.table === 'issues' && m.row?.id === id)).toEqual([])

    expect(await ok(importRows(w.ana, 'issues', [issue]))).toBe(0)
    const same = await ok(w.ana.db.from('issues').select('changed_at').eq('id', id).single<{ changed_at: string }>())
    expect(same.changed_at).toBe(row.changed_at)

    expect(await ok(importRows(w.ana, 'issues', [{ ...issue, title: 'Renamed in Linear' }]))).toBe(1)
    const renamed = await ok(w.ana.db.from('issues').select('title, number').eq('id', id).single<{ title: string; number: number }>())
    expect(renamed).toEqual({ title: 'Renamed in Linear', number: 500 })
    expect(await ok(w.ana.db.from('issue_events').select().eq('issue_id', id))).toEqual([])

    await expectError(importRows(w.ana, 'issues', [{ ...issue, id: ulid(), linear_id: null }]), '23505')
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
    await ok(importRows(w.ana, 'profiles', [{ id: guest, login: guestLogin, name: 'Guest Two' }]))
    const linkTeam = await newTeam(w.ana, w.ws, 'LNK')
    const issue = await newIssue(w.ana, w.ws, linkTeam)
    await ok(w.ana.db.from('issues').update({ assignee_id: guest }).eq('id', issue.id))
    const comment = ulid()
    await ok(importRows(w.ana, 'comments', [{ id: comment, issue_id: issue.id, author_id: guest, body: 'Old words' }]))
    const view = ulid()
    await ok(
      w.ana.db.from('views').insert({ id: view, workspace_id: w.ws, name: 'Theirs', filters: { assignees: [guestLogin, 'x', null] }, display: DISPLAY }),
    )

    await expectError(w.bob.db.rpc('link_person', { p_ws: w.ws, p_guest: guest, p_to: w.bob.profileId }), '42501')
    await ok(w.ana.db.rpc('link_person', { p_ws: w.ws, p_guest: guest, p_to: w.bob.profileId }))

    const moved = await ok(w.ana.db.from('issues').select('assignee_id').eq('id', issue.id).single<{ assignee_id: string }>())
    expect(moved.assignee_id).toBe(w.bob.profileId)
    const said = await ok(w.ana.db.from('comments').select('author_id').eq('id', comment).single<{ author_id: string }>())
    expect(said.author_id).toBe(w.bob.profileId)
    const filters = await ok(w.ana.db.from('views').select('filters').eq('id', view).single<{ filters: Record<string, unknown> }>())
    expect(filters.filters.assignees).toEqual([w.bob.login, 'x', null])
    const history = await ok(w.ana.db.from('issue_events').select('changes').eq('issue_id', issue.id))
    expect(history.map((e) => e.changes)).toEqual([{ assignee: [null, w.bob.profileId] }])
    expect(await ok(w.ana.db.from('team_members').select().eq('team_id', linkTeam).eq('profile_id', w.bob.profileId))).toHaveLength(1)
    expect(await ok(w.ana.db.from('profiles').select().eq('id', guest))).toEqual([])
    const gone = await ok(w.ana.db.from('deletions').select('row_key').eq('workspace_id', w.ws).eq('table_name', 'profiles'))
    expect(gone.map((d) => d.row_key)).toContainEqual({ id: guest })
  })
})
