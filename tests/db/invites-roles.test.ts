import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  addMember,
  anonClient,
  closeChannels,
  DISPLAY,
  enabled,
  expectDenied,
  expectError,
  getWorld,
  listen,
  newIssue,
  newTeam,
  newWorkspace,
  ok,
  RUN,
  signUp,
  signUpBare,
  type Someone,
  ulid,
  type World,
} from './support'
import type { Database, Json } from '@/backend/database.types'

type NewInvite = Partial<Database['public']['Tables']['invites']['Insert']>

describe.skipIf(!enabled)('invites, members and roles', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, 60_000)
  afterAll(closeChannels)

  const invite = async (ws: string, more: NewInvite = {}) =>
    (await ok(w.ana.db.from('invites').insert({ workspace_id: ws, ...more }).select('token').single())).token
  const info = (who: Someone, token: string) => ok(who.db.rpc('invite_info', { p_token: token }))

  test('the join page sees what it needs, and invites work once', async () => {
    const { ws } = await newWorkspace(w.ana, 'invites')
    const token = await invite(ws, { for_login: 'dee' })
    const [open] = await info(w.dee, token)
    // the workspace's id only for whoever is in it already
    expect(open).toMatchObject({ workspace_id: null, invited_by_login: w.ana.login, for_login: 'dee', role: 'member', state: 'open' })
    expect(open.people).toEqual([{ name: `Test ana`, avatarUrl: '' }])
    expect(Object.keys(open)).not.toContain('token')
    expect((await info(w.ana, token))[0]).toMatchObject({ state: 'member', workspace_id: ws })
    expect(await info(w.dee, 'no-such-token')).toEqual([])

    expect(await ok(w.dee.db.rpc('accept_invite', { p_token: token }))).toBe(ws)
    expect((await info(w.cy, token))[0].state).toBe('used')
    await expectError(w.cy.db.rpc('accept_invite', { p_token: token }), 'SP002')
    expect(await ok(w.dee.db.rpc('accept_invite', { p_token: token }))).toBe(ws)   // already in: nothing happens

    const expired = await invite(ws, { expires_at: '2020-01-01T00:00:00Z' })
    expect((await info(w.cy, expired))[0].state).toBe('expired')
    await expectError(w.cy.db.rpc('accept_invite', { p_token: expired }), 'SP003')
    expect(await ok(w.cy.db.from('workspaces').select().eq('id', ws))).toEqual([])
  })

  test('an invite for a person from Linear makes that person you', async () => {
    const { ws, team } = await newWorkspace(w.ana, 'guest invite')
    const guest = crypto.randomUUID()
    await ok(w.ana.db.rpc('import_rows', { p_ws: ws, p_table: 'profiles', p_rows: [{ id: guest, login: `~dbt-${RUN}-g3`, name: 'Guest Three' }] }))
    const issue = await newIssue(w.ana, ws, team)
    await ok(w.ana.db.from('issues').update({ assignee_id: guest }).eq('id', issue.id))
    const token = await invite(ws, { for_profile: guest })
    await invite(ws, { for_profile: guest })
    expect((await info(w.dee, token))[0].for_name).toBe('Guest Three')

    await ok(w.dee.db.rpc('accept_invite', { p_token: token }))
    const mine = await ok(w.dee.db.from('issues').select('assignee_id').eq('id', issue.id).single())
    expect(mine.assignee_id).toBe(w.dee.profileId)
    const invites = await ok(w.ana.db.from('invites').select('accepted_by, for_profile').eq('workspace_id', ws))
    expect(invites).toEqual([{ accepted_by: w.dee.profileId, for_profile: null }])
    expect(await ok(w.ana.db.from('profiles').select().eq('id', guest))).toEqual([])
  })

  test('owners stay in charge of owners, and a workspace always keeps one', async () => {
    const { ws } = await newWorkspace(w.ana, 'roles')
    await addMember(w.ana, w.bob, ws, 'admin')
    await addMember(w.ana, w.dee, ws)
    const member = (who: Someone) => w.ana.db.from('workspace_members').select().eq('workspace_id', ws).eq('profile_id', who.profileId)
    const change = (by: Someone, of: Someone, patch: { role?: string; removed_at?: string | null }) =>
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

    // someone who left comes back only with a new invite, not because an admin says so
    await expectDenied(change(w.ana, w.bob, { removed_at: null }))
    expect((await ok(member(w.bob)))[0].removed_at).not.toBeNull()
    await addMember(w.ana, w.bob, ws)
    expect((await ok(member(w.bob)))[0]).toMatchObject({ removed_at: null, role: 'member' })
  })

  const importRows = (ws: string, table: string, rows: Json[]) => w.ana.db.rpc('import_rows', { p_ws: ws, p_table: table, p_rows: rows })
  const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

  test('an invite for a person from Linear hands over all of their work', async () => {
    const { ws, team: eng } = await newWorkspace(w.ana, 'handover')
    const ops = await newTeam(w.ana, ws, 'OPS')
    const web = await newTeam(w.ana, ws, 'WEB')
    const g = crypto.randomUUID()
    const gLogin = `~dbt-${RUN}-g5`
    const avatar = 'https://example.com/g5.png'
    await ok(importRows(ws, 'profiles', [{ id: g, login: gLogin, name: 'Guest Five', avatar_url: avatar, linear_ids: ['lin-g5'] }]))
    await ok(importRows(ws, 'team_members', [{ team_id: ops, profile_id: g }]))
    const webIssue = ulid()
    await ok(
      importRows(ws, 'issues', [
        { id: webIssue, team_id: web, number: 1, title: 'Theirs', sort_order: 'a0', created_by: g, archived_at: new Date().toISOString(), archived_by: g },
      ]),
    )
    // made here by ana: the assignment writes history
    const engIssue = await newIssue(w.ana, ws, eng)
    await ok(w.ana.db.from('issues').update({ assignee_id: g }).eq('id', engIssue.id))
    await ok(importRows(ws, 'issue_followers', [{ issue_id: engIssue.id, profile_id: g, following: true }]))
    const comment = ulid()
    await ok(importRows(ws, 'comments', [{ id: comment, issue_id: engIssue.id, author_id: g, body: 'Guest words' }]))
    const theirView = ulid()
    await ok(importRows(ws, 'views', [{ id: theirView, owner_id: g, name: 'Guest view', display: DISPLAY }]))
    const project = ulid()
    await ok(w.ana.db.from('projects').insert({ id: project, workspace_id: ws, name: 'Led by them', lead_id: g }))
    const anasView = ulid()
    const filters = { assignees: [gLogin, w.ana.login, null], subscribers: [gLogin] }
    await ok(w.ana.db.from('views').insert({ id: anasView, workspace_id: ws, name: 'Ana’s', filters, display: DISPLAY }))

    const token = await invite(ws, { for_profile: g })
    await invite(ws, { for_profile: g })
    const heard = await listen(w.ana, `ws:${ws}`)
    expect(heard.status).toBe('SUBSCRIBED')
    expect(await ok(w.dee.db.rpc('accept_invite', { p_token: token }))).toBe(ws)

    const dee = w.dee.profileId
    const issues = await ok(w.ana.db.from('issues').select('id, assignee_id, created_by, archived_by').in('id', [engIssue.id, webIssue]))
    expect(issues.find((i) => i.id === engIssue.id)?.assignee_id).toBe(dee)
    expect(issues.find((i) => i.id === webIssue)).toMatchObject({ created_by: dee, archived_by: dee })
    expect((await ok(w.ana.db.from('comments').select('author_id').eq('id', comment).single())).author_id).toBe(dee)
    expect((await ok(w.ana.db.from('projects').select('lead_id').eq('id', project).single())).lead_id).toBe(dee)
    expect((await ok(w.ana.db.from('views').select('owner_id').eq('id', theirView).single())).owner_id).toBe(dee)
    const follows = await ok(w.ana.db.from('issue_followers').select('profile_id, following').eq('issue_id', engIssue.id))
    expect(follows).toContainEqual({ profile_id: dee, following: true })
    expect(follows.map((f) => f.profile_id)).not.toContain(g)
    const swapped = await ok(w.ana.db.from('views').select('filters').eq('id', anasView).single())
    expect(swapped.filters).toEqual({ assignees: [w.dee.login, w.ana.login, null], subscribers: [w.dee.login] })
    // the ids inside the history move too; who did it stays. (History by the guest themselves can't be made through
    // the API: triggers stamp whoever is signed in, and imports write no history.)
    const history = await ok(w.ana.db.from('issue_events').select('actor_id, changes').eq('issue_id', engIssue.id))
    expect(history).toEqual([{ actor_id: w.ana.profileId, changes: { assignee: [null, dee] } }])
    const teams = await ok(w.ana.db.from('team_members').select('team_id').eq('workspace_id', ws).eq('profile_id', dee))
    expect(teams.map((t) => t.team_id).sort()).toEqual([eng, ops, web].sort())
    const me = await ok(w.dee.db.from('profiles').select('name, avatar_url, linear_ids').eq('id', dee).single())
    expect(me.linear_ids).toContain('lin-g5')
    expect(me.name).toBe('Test dee')
    expect(me.avatar_url).toBe(avatar)
    expect(await ok(w.ana.db.from('profiles').select().eq('id', g))).toEqual([])
    const gone = await ok(w.ana.db.from('deletions').select('row_key').eq('workspace_id', ws).eq('table_name', 'profiles'))
    expect(gone.map((d) => d.row_key)).toContainEqual({ id: g })
    const invites = await ok(w.ana.db.from('invites').select('accepted_by, for_profile').eq('workspace_id', ws))
    expect(invites).toEqual([{ accepted_by: dee, for_profile: null }])
    expect(await heard.waitFor((m) => m.op === 'catch_up')).toBeDefined()
  })

  test('only admins and owners make, see, change and delete invite links', async () => {
    const token = await invite(w.ws)
    await expectDenied(w.bob.db.from('invites').insert({ workspace_id: w.ws }))
    expect(await ok(w.bob.db.from('invites').select().eq('token', token))).toEqual([])
    expect(await ok(w.bob.db.from('invites').update({ for_email: 'x@y.z' }).eq('token', token).select())).toEqual([])
    expect(await ok(w.bob.db.from('invites').delete().eq('token', token).select())).toEqual([])
    expect(await ok(w.cy.db.from('invites').select().eq('token', token))).toEqual([])
    expect(await ok(w.ana.db.from('invites').select('for_email').eq('token', token))).toEqual([{ for_email: null }])

    // for a person from Linear: only one of this workspace's
    const other = await newWorkspace(w.ana, 'other guests')
    const elsewhere = crypto.randomUUID()
    await ok(importRows(other.ws, 'profiles', [{ id: elsewhere, login: `~dbt-${RUN}-g6`, name: 'Guest Six' }]))
    await expectDenied(w.ana.db.from('invites').insert({ workspace_id: w.ws, for_profile: elsewhere }))
    await expectDenied(w.ana.db.from('invites').insert({ workspace_id: w.ws, for_profile: w.bob.profileId }))

    // a link lasts 30 days at most (E127)
    await expectError(w.ana.db.from('invites').insert({ workspace_id: w.ws, expires_at: later(60) }), '23514')
    await ok(w.ana.db.from('invites').insert({ workspace_id: w.ws, expires_at: later(29) }))
    await expectError(w.ana.db.from('invites').update({ expires_at: later(400) }).eq('token', token), '23514')
  })

  test('the join page works before signing in', async () => {
    const { ws } = await newWorkspace(w.ana, 'preview')
    const token = await invite(ws, { role: 'admin' })
    const anon = anonClient()
    const [open] = await ok(anon.rpc('invite_info', { p_token: token }))
    expect(open).toMatchObject({ workspace_id: null, workspace_name: `dbtest ${RUN} preview`, invited_by_login: w.ana.login, role: 'admin', state: 'open' })
    expect(open.people).toEqual([{ name: 'Test ana', avatarUrl: '' }])
    expect(await ok(anon.rpc('invite_info', { p_token: 'deadbeefdeadbeefdeadbeef' }))).toEqual([])

    await expectError(anon.rpc('accept_invite', { p_token: token }), '42501')
    await expectError(anon.rpc('guest_emails', { p_ws: ws }))

    await ok(w.dee.db.rpc('accept_invite', { p_token: token }))
    const [used] = await ok(anon.rpc('invite_info', { p_token: token }))
    expect(used).toMatchObject({ workspace_id: null, state: 'used', people: [] })
    expect((await info(w.dee, token))[0]).toMatchObject({ workspace_id: ws, state: 'member' })
    const role = await ok(w.ana.db.from('workspace_members').select('role').eq('workspace_id', ws).eq('profile_id', w.dee.profileId).single())
    expect(role.role).toBe('admin')
  })

  test('an invite whose person from Linear was linked meanwhile stops working', async () => {
    const { ws } = await newWorkspace(w.ana, 'linked meanwhile')
    await addMember(w.ana, w.bob, ws)
    const g = crypto.randomUUID()
    await ok(importRows(ws, 'profiles', [{ id: g, login: `~dbt-${RUN}-g7`, name: 'Guest Seven' }]))
    const token = await invite(ws, { for_profile: g })
    await ok(w.ana.db.rpc('link_person', { p_ws: ws, p_guest: g, p_to: w.bob.profileId }))
    expect(await info(w.dee, token)).toEqual([])
    await expectError(w.dee.db.rpc('accept_invite', { p_token: token }), 'P0002')
  })

  test('admins change roles and remove people; owners stay in charge of owners', async () => {
    const fay = await signUp('fay')
    const { ws, team } = await newWorkspace(w.ana, 'roles two')
    await newIssue(w.ana, ws, team)
    await addMember(w.ana, w.bob, ws, 'admin')
    await addMember(w.ana, fay, ws)
    await addMember(w.ana, w.dee, ws)
    const roleOf = async (who: Someone) =>
      await ok(w.bob.db.from('workspace_members').select('role, removed_at').eq('workspace_id', ws).eq('profile_id', who.profileId).single())
    const change = (by: Someone, of: Someone, patch: { role?: string; removed_at?: string }) =>
      by.db.from('workspace_members').update(patch).eq('workspace_id', ws).eq('profile_id', of.profileId).select('role, removed_at')

    expect(await ok(change(w.bob, fay, { role: 'admin' }))).toHaveLength(1)
    expect(await ok(change(w.bob, fay, { role: 'member' }))).toHaveLength(1)
    await expectError(change(w.bob, fay, { role: 'owner' }), '42501')
    await expectError(change(w.bob, w.bob, { role: 'member' }), '42501')
    expect(await ok(change(fay, w.dee, { role: 'admin' }))).toEqual([])
    expect(await ok(change(fay, w.dee, { removed_at: new Date().toISOString() }))).toEqual([])
    expect(await roleOf(w.dee)).toEqual({ role: 'member', removed_at: null })

    expect(await ok(change(w.bob, fay, { removed_at: new Date().toISOString() }))).toHaveLength(1)
    expect(await ok(fay.db.from('workspaces').select().eq('id', ws))).toEqual([])
    expect(await ok(fay.db.from('issues').select().eq('workspace_id', ws))).toEqual([])

    expect(await ok(change(w.ana, w.bob, { role: 'owner' }))).toHaveLength(1)
    expect(await ok(change(w.ana, w.ana, { role: 'admin' }))).toHaveLength(1)
    expect(await ok(change(w.bob, w.ana, { removed_at: new Date().toISOString() }))).toHaveLength(1)
    expect((await roleOf(w.ana)).removed_at).not.toBeNull()

    await ok(w.dee.db.rpc('leave_workspace', { p_ws: ws }))
    await expectError(w.dee.db.rpc('leave_workspace', { p_ws: ws }), 'P0002')
    await expectError(fay.db.rpc('leave_workspace', { p_ws: ws }), 'P0002')
    await expectError(w.bob.db.rpc('leave_workspace', { p_ws: ws }), '23514')
  })

  test('only admins link, and only to people who joined', async () => {
    const g = crypto.randomUUID()
    await ok(importRows(w.ws, 'profiles', [{ id: g, login: `~dbt-${RUN}-g8`, name: 'Guest Eight' }]))
    await expectError(w.bob.db.rpc('link_person', { p_ws: w.ws, p_guest: g, p_to: w.bob.profileId }), '42501')
    await expectError(w.ana.db.rpc('link_person', { p_ws: w.ws, p_guest: g, p_to: w.guest }), '22023')
    const other = await newWorkspace(w.ana, 'link elsewhere')
    const elsewhere = crypto.randomUUID()
    await ok(importRows(other.ws, 'profiles', [{ id: elsewhere, login: `~dbt-${RUN}-g9`, name: 'Guest Nine' }]))
    await expectError(w.ana.db.rpc('link_person', { p_ws: w.ws, p_guest: elsewhere, p_to: w.bob.profileId }), 'P0002')
  })

  test('you pick a name before you can join', async () => {
    const eve = await signUpBare('eve')
    const token = await invite(w.ws)
    const { error } = await eve.db.rpc('accept_invite', { p_token: token })
    expect(error).toMatchObject({ code: '42501', message: 'Pick your name first.' })
  })
})
