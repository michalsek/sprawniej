/**
 * Sign-up codes: a new account needs a code or an invite link that still has room (docs/data-format.md, "Who may make
 * an account").
 * Email sign-ups are checked by the Auth hook before the account exists; an account made another way (GitHub) gets no
 * profile until it gives a code with use_signup_code().
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { client, enabled, RUN, expectError, getWorld, newSignupCode, newWorkspace, ok, ownerSql, signUpBare, testEmail, type Permit, type World } from './support'

const NEED = 'You need a sign-up code to make an account. Ask whoever looks after Sprawniej for one.'
const WRONG = "That sign-up code doesn't work. Check it and try again."
const OLD = 'That sign-up code no longer works. Ask whoever looks after Sprawniej for a new one.'
const USED_UP = 'That sign-up code has been used up. Ask whoever looks after Sprawniej for a new one.'
const BAD_INVITE = 'This invite link was already used or has expired. Ask for a new one.'
const NO_PLACES = 'This invite link has no places left right now. Ask for a new one.'

/** a sign-up that may be refused: the error's message, or null when the account was made */
async function trySignUp(name: string, permit: Permit): Promise<string | null> {
  const { data, error } = await client().auth.signUp({ email: testEmail(name), password: `${crypto.randomUUID()}Aa1!`, options: { data: permit } })
  if (error) return error.message
  expect(data.user).toBeTruthy()
  return null
}

const usesOf = async (code: string) =>
  (await ownerSql<{ uses: number }>(`select uses from private.signup_codes where code = '${code.replaceAll('-', '')}'`))[0]?.uses

/** the CLI takes a few seconds per call */
const SLOW = 120_000

describe.skipIf(!enabled)('sign-up codes', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, SLOW)

  test('a valid code makes an account and is written down; then it is used up', async () => {
    const code = await newSignupCode('one use')
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
    // case, spaces and dashes don't matter
    expect(await trySignUp('code-ok', { signup_code: ` ${code.toLowerCase().replaceAll('-', ' ')} ` })).toBeNull()
    expect(await usesOf(code)).toBe(1)
    const [used] = await ownerSql<{ email: string; provider: string; code: string }>(
      `select s.email, s.provider, c.code from private.signups s join private.signup_codes c on c.id = s.code_id where s.email = '${testEmail('code-ok')}'`,
    )
    expect(used).toEqual({ email: testEmail('code-ok'), provider: 'email', code: code.replaceAll('-', '') })
    expect(await trySignUp('code-again', { signup_code: code })).toBe(USED_UP)
    expect(await usesOf(code)).toBe(1)
  }, SLOW)

  test('expired, switched off, wrong or missing codes make no account', async () => {
    const [expired, off] = await Promise.all([newSignupCode('expired', 1, 5), newSignupCode('off', 1, 5)])
    await ownerSql(`update private.signup_codes set expires_at = now() - interval '1 minute' where code = '${expired.replaceAll('-', '')}'`)
    expect((await ownerSql<{ r: string }>(`select private.switch_off_signup_code('${off.toLowerCase()}') as r`))[0].r).toBe('Switched off')
    const results = await Promise.all([
      trySignUp('expired', { signup_code: expired }),
      trySignUp('off', { signup_code: off }),
      trySignUp('wrong', { signup_code: 'AAAA-BBBB-CCCC' }),
      trySignUp('none', {}),
    ])
    expect(results).toEqual([OLD, OLD, WRONG, NEED])
    const made = await ownerSql(`select 1 from auth.users where email in ('${['expired', 'off', 'wrong', 'none'].map(testEmail).join("','")}')`)
    expect(made).toHaveLength(0)
    expect(await usesOf(expired)).toBe(0)
  }, SLOW)

  test('an open invite link makes one account, without a code', async () => {
    const { ws } = await newWorkspace(w.ana, 'signup invite')
    const token = (await ok(w.ana.db.from('invites').insert({ workspace_id: ws }).select('token').single())).token
    const expiredToken = (await ok(w.ana.db.from('invites').insert({ workspace_id: ws, expires_at: '2020-01-01T00:00:00Z' }).select('token').single())).token
    expect(await trySignUp('invite-expired', { invite: expiredToken })).toBe(BAD_INVITE)
    const { db } = await signUpBare('invited', { invite: token })
    // the same link can't make a second account, even before it is accepted
    expect(await trySignUp('invite-again', { invite: token })).toBe(NO_PLACES)
    await ok(db.rpc('create_profile', { p_login: `dbt-${RUN}-invited`, p_name: 'Invited' }).single())
    expect(await ok(db.rpc('accept_invite', { p_token: token }))).toBe(ws)
  }, SLOW)

  test('an account that came in without a code (GitHub) gets no name until it gives one', async () => {
    // GitHub sign-ups pass the hook (they can't carry a code)
    const [hook] = await ownerSql<{ r: unknown }>(
      `select private.before_user_created('{"user": {"id": "${crypto.randomUUID()}", "email": "x@example.com", "app_metadata": {"provider": "github"}, "user_metadata": {}}}'::jsonb) as r`,
    )
    expect(hook.r).toEqual({})
    // an account like that: made with a code, then the record taken away
    const { db, userId } = await signUpBare('github-like')
    await ownerSql(`delete from private.signups where user_id = '${userId}'`)

    expect(await ok(db.rpc('signup_code_needed'))).toBe(true)
    expect(await ok(db.rpc('ensure_profile'))).toEqual([])
    const login = `dbt-${RUN}-ghlike`
    await expectError(db.rpc('create_profile', { p_login: login, p_name: 'Like GitHub' }), 'SP004')
    await expectError(db.rpc('use_signup_code', { p_code: 'AAAA-BBBB-CCCC' }), 'SP005')

    const code = await newSignupCode('later')
    await ok(db.rpc('use_signup_code', { p_code: code }))
    expect(await ok(db.rpc('signup_code_needed'))).toBe(false)
    expect(await usesOf(code)).toBe(1)
    await ok(db.rpc('use_signup_code', { p_code: 'AAAA-BBBB-CCCC' }))   // in already: nothing to do
    await ok(db.rpc('create_profile', { p_login: login, p_name: 'Like GitHub' }).single())
    expect(await ok(db.rpc('signup_code_needed'))).toBe(false)
  }, SLOW)

  test('an account that came in without a code can use an invite link instead', async () => {
    const { ws } = await newWorkspace(w.ana, 'signup invite later')
    const token = (await ok(w.ana.db.from('invites').insert({ workspace_id: ws }).select('token').single())).token
    const { db, userId } = await signUpBare('github-invite')
    await ownerSql(`delete from private.signups where user_id = '${userId}'`)
    await ok(db.rpc('use_signup_code', { p_invite: token }))
    await ok(db.rpc('create_profile', { p_login: `dbt-${RUN}-ghinv`, p_name: 'Invited later' }).single())
    expect(await ok(db.rpc('accept_invite', { p_token: token }))).toBe(ws)
  }, SLOW)

  const link = async (ws: string, max_uses: number | null) =>
    ok(w.ana.db.from('invites').insert({ workspace_id: ws, max_uses }).select('id, token').single())

  test('a link for up to 2 makes at most 2 accounts that have not joined yet', async () => {
    const { ws } = await newWorkspace(w.ana, 'signup two')
    const { token } = await link(ws, 2)
    const a = await signUpBare('two-a', { invite: token })
    await signUpBare('two-b', { invite: token })
    expect(await trySignUp('two-c', { invite: token })).toBe(NO_PLACES)
    expect((await ok(client().rpc('invite_info', { p_token: token })))[0].state).toBe('open')
    // joining doesn't free a place: the one who joined still holds it
    await ok(a.db.rpc('create_profile', { p_login: `dbt-${RUN}-two-a`, p_name: 'Two A' }).single())
    expect(await ok(a.db.rpc('accept_invite', { p_token: token }))).toBe(ws)
    expect(await trySignUp('two-d', { invite: token })).toBe(NO_PLACES)
  }, SLOW)

  test('an account that got in another way no longer holds a place', async () => {
    const { ws } = await newWorkspace(w.ana, 'signup elsewhere')
    const { token } = await link(ws, 2)
    const a = await signUpBare('else-a', { invite: token })
    await signUpBare('else-b', { invite: token })
    expect(await trySignUp('else-c', { invite: token })).toBe(NO_PLACES)
    await ok(a.db.rpc('create_profile', { p_login: `dbt-${RUN}-else-a`, p_name: 'Else A' }).single())
    const other = await link(ws, 1)
    expect(await ok(a.db.rpc('accept_invite', { p_token: other.token }))).toBe(ws)
    expect(await trySignUp('else-d', { invite: token })).toBeNull()
  }, SLOW)

  test('a link for anyone makes accounts until it ends; ended, expired and full links make none', async () => {
    const { ws } = await newWorkspace(w.ana, 'signup anyone')
    const anyone = await link(ws, null)
    for (const n of ['any-a', 'any-b', 'any-c']) expect(await trySignUp(n, { invite: anyone.token })).toBeNull()
    await ok(w.ana.db.rpc('end_invite', { p_invite: anyone.id }))
    expect(await trySignUp('any-d', { invite: anyone.token })).toBe(BAD_INVITE)

    const expired = (await ok(w.ana.db.from('invites').insert({ workspace_id: ws, max_uses: null, expires_at: '2020-01-01T00:00:00Z' }).select('token').single())).token
    expect(await trySignUp('any-expired', { invite: expired })).toBe(BAD_INVITE)
    const full = await link(ws, 2)
    await ok(w.bob.db.rpc('accept_invite', { p_token: full.token }))
    await ok(w.dee.db.rpc('accept_invite', { p_token: full.token }))
    expect(await trySignUp('any-full', { invite: full.token })).toBe(BAD_INVITE)

    // without a code (GitHub): the same rule
    const { db, userId } = await signUpBare('github-shared')
    await ownerSql(`delete from private.signups where user_id = '${userId}'`)
    await expectError(db.rpc('use_signup_code', { p_invite: anyone.token }), 'SP005')
    const open = await link(ws, 5)
    await ok(db.rpc('use_signup_code', { p_invite: open.token }))
    expect(await ok(db.rpc('signup_code_needed'))).toBe(false)

    // deleting a link keeps the record of who signed up with it
    await ok(w.ana.db.from('invites').delete().eq('id', open.id))
    const [kept] = await ownerSql<{ invite_id: string | null }>(`select invite_id from private.signups where user_id = '${userId}'`)
    expect(kept).toEqual({ invite_id: null })
  }, SLOW)

  test('two sign-ups at once with a link for one person make one account', async () => {
    const { ws } = await newWorkspace(w.ana, 'signup race')
    const { token } = await link(ws, 1)
    const both = await Promise.all([trySignUp('race-a', { invite: token }), trySignUp('race-b', { invite: token })])
    expect(both.filter((r) => r === null)).toHaveLength(1)
    expect(both.filter((r) => r === NO_PLACES)).toHaveLength(1)
  }, SLOW)

  test('accounts never let in are removed after 7 days; the rest stay', async () => {
    const { userId: stranger } = await signUpBare('stranger')
    const { userId: fresh } = await signUpBare('stranger-new')
    await ownerSql(`delete from private.signups where user_id in ('${stranger}', '${fresh}')`)
    await ownerSql(`update auth.users set created_at = now() - interval '8 days' where id = '${stranger}'`)
    await ownerSql('select private.forget_strangers()')
    const left = await ownerSql<{ id: string }>(`select id from auth.users where id in ('${stranger}', '${fresh}', '${w.ana.userId}')`)
    expect(left.map((r) => r.id).sort()).toEqual([fresh, w.ana.userId].sort())
  }, SLOW)

  test('browsers can not reach the codes', async () => {
    await expectError(w.ana.db.rpc('make_signup_code' as never, { p_note: 'x' } as never))
    expect(await ok(w.ana.db.rpc('signup_code_needed'))).toBe(false)
    await expectError(client().rpc('use_signup_code', { p_code: 'AAAA-BBBB-CCCC' }))
  }, SLOW)
})
