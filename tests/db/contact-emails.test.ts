import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  addMember,
  client,
  closeChannels,
  enabled,
  expectDenied,
  expectError,
  getWorld,
  listen,
  newWorkspace,
  ok,
  ownerSql,
  signUp,
  type Someone,
  type World,
} from './support'

// Contact emails (supabase/migrations/20261021190000_contact_emails.sql): your list is yours alone (profile_emails),
// and the one you show is copied onto your profile (profiles.contact_email) by the database. Each test starts with
// Ana and Bob keeping no emails and showing none, and makes what it needs, so any one of them can run alone.

/** profile_id is filled in by the database (and refused from browsers), so a new email sends only the email */
const add = (who: Someone, email: string) => who.db.from('profile_emails').insert({ email }).select('id').single()
const addId = async (who: Someone, email: string) => (await ok(add(who, email))).id

const shownBy = async (reader: Someone, of: Someone) =>
  (await ok(reader.db.from('profiles').select('contact_email').eq('id', of.profileId).single())).contact_email

/** shows none and keeps none */
async function clear(who: Someone) {
  await ok(who.db.rpc('show_email'))
  await ok(who.db.from('profile_emails').delete().eq('profile_id', who.profileId))
}

describe.skipIf(!enabled)('contact emails', () => {
  let w: World
  let ana: Someone
  let bob: Someone
  let cy: Someone

  beforeEach(async () => {
    w = await getWorld()
    ;({ ana, bob, cy } = w)
    await Promise.all([clear(ana), clear(bob)])
  }, 60_000)

  afterAll(async () => {
    // the shared world's people show nothing and keep nothing afterwards
    if (w) await Promise.all([clear(w.ana), clear(w.bob)])
    await closeChannels()
  })

  test('only you read your emails, and a new one is hidden', async () => {
    const id = await addId(ana, 'ana@firma.pl')
    const mine = await ok(ana.db.from('profile_emails').select('id, profile_id, email, visible'))
    expect(mine).toEqual([{ id, profile_id: ana.profileId, email: 'ana@firma.pl', visible: false }])
    expect(await ok(bob.db.from('profile_emails').select('id').eq('profile_id', ana.profileId))).toEqual([])
    expect(await ok(cy.db.from('profile_emails').select('id'))).toEqual([])
    expect(await shownBy(bob, ana)).toBeNull()
  })

  test('nobody who is signed out gets or picks anything', async () => {
    await expectDenied(client().from('profile_emails').select())
    await expectDenied(client().rpc('show_email'))
  })

  test('nobody sends who it belongs to or whether it shows; nobody else changes yours', async () => {
    const id = await addId(ana, 'rules@firma.pl')
    await expectDenied(ana.db.from('profile_emails').insert({ email: 'x@firma.pl', profile_id: ana.profileId }))
    await expectDenied(ana.db.from('profile_emails').insert({ email: 'x@firma.pl', profile_id: bob.profileId }))
    await expectDenied(ana.db.from('profile_emails').insert({ email: 'x@firma.pl', profile_id: ana.profileId, visible: true }))
    await expectDenied(ana.db.from('profile_emails').update({ visible: true }).eq('id', id))
    await expectDenied(ana.db.from('profile_emails').update({ profile_id: bob.profileId }).eq('id', id))
    expect(await ok(bob.db.from('profile_emails').update({ email: 'evil@x.pl' }).eq('id', id).select('id'))).toEqual([])
    expect(await ok(bob.db.from('profile_emails').delete().eq('id', id).select('id'))).toEqual([])
    expect((await ok(ana.db.from('profile_emails').select('email').eq('id', id).single())).email).toBe('rules@firma.pl')
  })

  test('the same email twice, a bad one, a long one and a sixth are refused', async () => {
    await addId(ana, 'ana@firma.pl')
    await expectError(add(ana, 'ANA@Firma.pl'), '23505')
    for (const bad of ['ana@', 'ana firma@x.pl', 'ana@x', ' ana@x.pl', `${'a'.repeat(249)}@x.com`]) await expectError(add(ana, bad), '23514')
    // someone else may use the same one
    await addId(bob, 'ana@firma.pl')
    for (const e of ['two@x.pl', 'three@x.pl', 'four@x.pl', 'five@x.pl']) await addId(ana, e)
    const { error } = await add(ana, 'six@x.pl')
    expect(error?.code).toBe('23514')
    expect(error?.message).toBe('You can keep up to 5 emails. Remove one first.')
  })

  test('the one you show is on your profile for teammates; switching, none, editing and removing it follow', async () => {
    const first = await addId(ana, 'ana@firma.pl')
    const second = await addId(ana, 'Ana.Prywatna@gmail.com')
    await ok(ana.db.rpc('show_email', { p_email: first }))
    expect(await shownBy(bob, ana)).toBe('ana@firma.pl')

    await ok(ana.db.rpc('show_email', { p_email: second }))
    expect(await shownBy(bob, ana)).toBe('Ana.Prywatna@gmail.com')
    expect((await ok(ana.db.from('profile_emails').select('id').eq('visible', true))).map((e) => e.id)).toEqual([second])

    // editing a hidden one changes nothing teammates see; editing the shown one does
    await ok(ana.db.from('profile_emails').update({ email: 'ana@firma.com' }).eq('id', first))
    expect(await shownBy(bob, ana)).toBe('Ana.Prywatna@gmail.com')
    await ok(ana.db.from('profile_emails').update({ email: 'ana.prywatna@gmail.com' }).eq('id', second))
    expect(await shownBy(bob, ana)).toBe('ana.prywatna@gmail.com')

    await ok(ana.db.rpc('show_email'))
    expect(await shownBy(bob, ana)).toBeNull()

    await ok(ana.db.rpc('show_email', { p_email: second }))
    await ok(ana.db.from('profile_emails').delete().eq('id', second))
    expect(await shownBy(bob, ana)).toBeNull()
    await expectError(ana.db.rpc('show_email', { p_email: second }), 'P0002')
  })

  test('nobody shows someone else’s email or writes the copy on a profile', async () => {
    const id = await addId(ana, 'ana@firma.pl')
    await expectError(bob.db.rpc('show_email', { p_email: id }), 'P0002')
    await expectDenied(ana.db.from('profiles').update({ contact_email: 'fake@x.pl' }).eq('id', ana.profileId))
    await expectDenied(bob.db.from('profiles').update({ contact_email: 'fake@x.pl' }).eq('id', ana.profileId))
    expect(await shownBy(bob, ana)).toBeNull()
  })

  test('people in a workspace Ana left still see her later changes; someone sharing none sees nothing', async () => {
    // someone new owns a workspace Ana joins and then leaves, so they share no other workspace
    const dee = await signUp('ceold')
    const { ws } = await newWorkspace(dee, 'contact left')
    await addMember(dee, ana, ws)
    await ok(ana.db.rpc('leave_workspace', { p_ws: ws }))
    const id = await addId(ana, 'later@firma.pl')
    await ok(ana.db.rpc('show_email', { p_email: id }))
    expect(await shownBy(dee, ana)).toBe('later@firma.pl')
    await ok(ana.db.from('profile_emails').update({ email: 'later@firma.com' }).eq('id', id))
    expect(await shownBy(dee, ana)).toBe('later@firma.com')
    expect(await ok(cy.db.from('profiles').select('id, contact_email').eq('id', ana.profileId))).toEqual([])
    await ownerSql(`delete from public.workspaces where id = '${ws}'`)
  }, 60_000)

  test('a deleted account keeps its profile, but its emails go and nothing is shown', async () => {
    const gone = await signUp('cegone')
    const { ws } = await newWorkspace(ana, 'contact gone')
    await addMember(ana, gone, ws)
    const id = await addId(gone, 'gone@firma.pl')
    await addId(gone, 'other@firma.pl')
    await ok(gone.db.rpc('show_email', { p_email: id }))
    expect(await shownBy(ana, gone)).toBe('gone@firma.pl')

    await ownerSql(`delete from auth.users where id = '${gone.userId}'`)
    const after = await ok(ana.db.from('profiles').select('user_id, contact_email').eq('id', gone.profileId).single())
    expect([after.user_id, after.contact_email]).toEqual([null, null])
    const [left] = await ownerSql<{ n: number }>(`select count(*)::int as n from public.profile_emails where profile_id = '${gone.profileId}'`)
    expect(left.n).toBe(0)
    // the test cleanup finds profiles through their account, which is gone: remove this one here
    await ownerSql(`delete from public.workspaces where id = '${ws}'; delete from public.profiles where id = '${gone.profileId}'`)
  }, 60_000)

  test('teammates hear each choice, and nothing when you only add one', async () => {
    const heard = await listen(bob, `ws:${w.ws}`)
    expect(heard.status).toBe('SUBSCRIBED')
    const about = (email: string | null) => (m: { table?: string; op?: string; row?: Record<string, unknown> }) =>
      m.table === 'profiles' && m.op === 'UPDATE' && m.row?.id === ana.profileId && 'contact_email' in m.row && m.row.contact_email === email
    const id = await addId(ana, 'heard@firma.pl')
    await ok(ana.db.rpc('show_email', { p_email: id }))
    const m = await heard.waitFor(about('heard@firma.pl'))
    expect(Object.keys(m?.row ?? {}).sort()).toEqual(['changed_at', 'contact_email', 'id'])
    await ok(ana.db.rpc('show_email'))
    expect(await heard.waitFor(about(null))).toBeDefined()
    // adding one nobody sees sent nothing about Ana's profile
    expect(heard.got.filter((g) => g.table === 'profiles' && g.row?.id === ana.profileId)).toHaveLength(2)
  })
})
