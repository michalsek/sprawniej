import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  addMember,
  anonClient,
  closeChannels,
  enabled,
  expectDenied,
  expectError,
  listen,
  lit,
  newWorkspace,
  ok,
  ownerSql,
  RUN,
  signUp,
  signUpBare,
  type Someone,
} from './support'

// Changeable @handles (supabase/migrations/20261021120000_handles.sql): the login stays, the handle people see changes
// with set_handle(), and nothing is kept for anyone once they move off a handle. These accounts are the test's own, so
// the shared world's logins stay as other tests expect them.

describe.skipIf(!enabled)('handles', () => {
  let ana: Someone
  let bob: Someone
  let ws: string
  beforeAll(async () => {
    ;[ana, bob] = await Promise.all([signUp('hana'), signUp('hbob')])
    ;({ ws } = await newWorkspace(ana, 'handles'))
    await addMember(ana, bob, ws)
  }, 60_000)
  afterAll(closeChannels)

  const h = (name: string) => `dbt-${RUN}-${name}`
  const set = (who: Someone, handle: string) => who.db.rpc('set_handle', { p_handle: handle }).single()

  test('changes the handle and never the login; your own login stores none', async () => {
    const changed = await ok(set(ana, ` ${h('ania')} `))
    expect(changed).toMatchObject({ login: ana.login, handle: h('ania') })
    // a change of case only is fine
    expect((await ok(set(ana, h('ania').toUpperCase()))).handle).toBe(h('ania').toUpperCase())
    expect((await ok(set(ana, ana.login))).handle).toBeNull()
  })

  test('says no to what isn’t a handle', async () => {
    for (const bad of ['-x', 'a_b', 'a.b', '~x', '', 'a'.repeat(40)]) await expectError(set(ana, bad), '22023')
  })

  test('someone else’s handle now is taken, case aside; one they moved off is free', async () => {
    await expectError(set(ana, bob.login.toUpperCase()), '23505')
    await ok(set(bob, h('robert')))
    await expectError(set(ana, h('Robert')), '23505')
    // Bob's login and his earlier handle are free now
    expect((await ok(set(ana, bob.login))).handle).toBe(bob.login)
    await ok(set(bob, h('rob')))
    expect((await ok(set(ana, h('robert')))).handle).toBe(h('robert'))
    // and Ana's login, which she moved off, is free for Bob
    expect((await ok(set(bob, ana.login))).handle).toBe(ana.login)
    await expectError(set(ana, ana.login), '23505')
    // back as they were, for the tests below
    expect((await ok(set(bob, bob.login))).handle).toBeNull()
    expect((await ok(set(ana, ana.login))).handle).toBeNull()
  })

  test('only through set_handle, and only when signed in with a name', async () => {
    await expectDenied(ana.db.from('profiles').update({ handle: h('direct') }).eq('id', ana.profileId))
    await expectDenied(ana.db.from('profiles').update({ login: h('direct') }).eq('id', ana.profileId))
    const { error } = await anonClient().rpc('set_handle', { p_handle: h('nobody') })
    expect(error).not.toBeNull()
    const bare = await signUpBare('hbare')
    await expectError(bare.db.rpc('set_handle', { p_handle: h('bare') }), '42501')
  })

  test('a new account can’t pick anyone’s login or handle now', async () => {
    await ok(set(bob, h('bobby')))
    const one = await signUpBare('hnew')
    await expectError(one.db.rpc('create_profile', { p_login: h('bobby'), p_name: 'New' }), '23505')
    await expectError(one.db.rpc('create_profile', { p_login: bob.login, p_name: 'New' }), '23505')
  })

  test('a GitHub sign-up whose GitHub login is someone’s handle picks a name instead', async () => {
    await ok(set(bob, h('gh-taken')))
    const gh = await signUpBare('hgh')
    const id = 9_100_000_000_000 + (parseInt(RUN.replace(/[^0-9a-z]/g, '').slice(-6), 36) % 1_000_000)
    await ownerSql(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (${lit(String(id))}, ${lit(gh.userId)}, ${lit({ sub: String(id), user_name: h('gh-taken') })}::jsonb,
               'github', now(), now(), now())`,
    )
    expect(await ok(gh.db.rpc('ensure_profile'))).toEqual([])
  })

  test('two people taking one handle at once: one gets it', async () => {
    const both = await Promise.all([set(ana, h('same')), set(bob, h('same'))])
    expect(both.filter((r) => !r.error)).toHaveLength(1)
    expect(both.find((r) => r.error)?.error?.code).toBe('23505')
    await ok(set(ana, ana.login))
  })

  test('teammates hear about it at once, and the join page shows it', async () => {
    const heard = await listen(bob, `ws:${ws}`)
    expect(heard.status).toBe('SUBSCRIBED')
    await ok(set(ana, h('live')))
    const m = await heard.waitFor((m) => m.table === 'profiles' && m.op === 'UPDATE' && m.row?.id === ana.profileId)
    expect(m?.row).toMatchObject({ id: ana.profileId, handle: h('live') })

    const inv = await ok(ana.db.from('invites').insert({ workspace_id: ws }).select('token').single())
    const [info] = await ok(bob.db.rpc('invite_info', { p_token: inv.token }))
    expect(info.invited_by_login).toBe(h('live'))
  })
})
