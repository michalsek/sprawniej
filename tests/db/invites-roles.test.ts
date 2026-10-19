import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { addMember, closeChannels, enabled, expectError, getWorld, newIssue, newWorkspace, ok, RUN, type World } from './support'

describe.skipIf(!enabled)('invites, members and roles', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, 60_000)
  afterAll(closeChannels)

  const invite = async (ws: string, more: Record<string, unknown> = {}) =>
    (await ok(w.ana.db.from('invites').insert({ workspace_id: ws, ...more }).select('token').single<{ token: string }>())).token
  const info = async (who: typeof w.ana, token: string) => ok(who.db.rpc('invite_info', { p_token: token })) as Promise<Array<Record<string, any>>>

  test('the join page sees what it needs, and invites work once', async () => {
    const ws = await newWorkspace(w.ana, 'invites')
    const token = await invite(ws, { for_login: 'dee' })
    const [open] = await info(w.dee, token)
    expect(open).toMatchObject({ workspace_id: ws, invited_by_login: w.ana.login, for_login: 'dee', role: 'member', state: 'open' })
    expect(open.people).toEqual([{ name: `Test ana`, avatarUrl: '' }])
    expect(Object.keys(open)).not.toContain('token')
    expect((await info(w.ana, token))[0].state).toBe('member')
    expect(await info(w.dee, 'no-such-token')).toEqual([])

    expect(await ok(w.dee.db.rpc('accept_invite', { p_token: token }))).toBe(ws)
    expect((await info(w.cy, token))[0].state).toBe('used')
    await expectError(w.cy.db.rpc('accept_invite', { p_token: token }))
    expect(await ok(w.dee.db.rpc('accept_invite', { p_token: token }))).toBe(ws)   // already in: nothing happens

    const expired = await invite(ws, { expires_at: '2020-01-01T00:00:00Z' })
    expect((await info(w.cy, expired))[0].state).toBe('expired')
    await expectError(w.cy.db.rpc('accept_invite', { p_token: expired }))
    expect(await ok(w.cy.db.from('workspaces').select().eq('id', ws))).toEqual([])
  })

  test('an invite for a person from Linear makes that person you', async () => {
    const ws = await newWorkspace(w.ana, 'guest invite')
    const team = (await ok(w.ana.db.from('teams').select('id').eq('workspace_id', ws).single<{ id: string }>())).id
    const guest = crypto.randomUUID()
    await ok(w.ana.db.rpc('import_rows', { p_ws: ws, p_table: 'profiles', p_rows: [{ id: guest, login: `~dbt-${RUN}-g3`, name: 'Guest Three' }] }))
    const issue = await newIssue(w.ana, ws, team)
    await ok(w.ana.db.from('issues').update({ assignee_id: guest }).eq('id', issue.id))
    const token = await invite(ws, { for_profile: guest })
    await invite(ws, { for_profile: guest })
    expect((await info(w.dee, token))[0].for_name).toBe('Guest Three')

    await ok(w.dee.db.rpc('accept_invite', { p_token: token }))
    const mine = await ok(w.dee.db.from('issues').select('assignee_id').eq('id', issue.id).single<{ assignee_id: string }>())
    expect(mine.assignee_id).toBe(w.dee.profileId)
    const invites = await ok(w.ana.db.from('invites').select('accepted_by, for_profile').eq('workspace_id', ws))
    expect(invites).toEqual([{ accepted_by: w.dee.profileId, for_profile: null }])
    expect(await ok(w.ana.db.from('profiles').select().eq('id', guest))).toEqual([])
  })

  test('owners stay in charge of owners, and a workspace always keeps one', async () => {
    const ws = await newWorkspace(w.ana, 'roles')
    await addMember(w.ana, w.bob, ws, 'admin')
    await addMember(w.ana, w.dee, ws)
    const member = (who: typeof w.ana) => w.ana.db.from('workspace_members').select().eq('workspace_id', ws).eq('profile_id', who.profileId)
    const change = (by: typeof w.ana, of: typeof w.ana, patch: Record<string, unknown>) =>
      by.db.from('workspace_members').update(patch).eq('workspace_id', ws).eq('profile_id', of.profileId).select()

    await expectError(change(w.bob, w.bob, { role: 'owner' }), '42501')
    await expectError(change(w.bob, w.ana, { role: 'member' }), '42501')
    await expectError(change(w.bob, w.ana, { removed_at: new Date().toISOString() }), '42501')
    expect(await ok(change(w.dee, w.dee, { role: 'admin' }))).toEqual([])
    expect((await ok(member(w.dee)))[0].role).toBe('member')

    await expectError(change(w.ana, w.ana, { role: 'admin' }), '23514')
    await expectError(w.ana.db.rpc('leave_workspace', { p_ws: ws }), '23514')

    expect(await ok(change(w.ana, w.bob, { role: 'owner' }))).toHaveLength(1)
    await ok(w.bob.db.rpc('leave_workspace', { p_ws: ws }))
    expect(await ok(w.bob.db.from('workspaces').select().eq('id', ws))).toEqual([])
    expect((await ok(member(w.bob)))[0].removed_at).not.toBeNull()
  })
})
