import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Lookup } from '@/notion/handler'
import { sha256Hex } from '@/notion/key'
import {
  addMember,
  asService,
  client,
  closeChannels,
  enabled,
  expectDenied,
  expectError,
  getWorld,
  listen,
  lit,
  newIssue,
  newTeam,
  newWorkspace,
  ok,
  ownerSql,
  signUp,
  testEmail,
  ulid,
  type Someone,
  type World,
} from './support'

// Notion: one connection per workspace (notion_connections), the page each issue came from (private.notion_pages),
// the two functions for admins and the two only the webhook may call
// (supabase/migrations/20261020160000_notion.sql, docs/notion.md).

type Applied = { issue?: string; new?: boolean; archived?: boolean; problem?: string }

const textArray = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/["\\]/g, '\\$&')}"`).join(',')}}`

const lookup = async (connection: string, hash: string, emails: string[] = [], team: string | null = null) =>
  (
    await asService<{ r: Lookup }>(
      `select public.notion_lookup(${lit(connection)}::uuid, ${lit(hash)}, ${lit(textArray(emails))}::text[], ${team === null ? 'null' : lit(team)}) as r`,
    )
  )[0].r

const apply = async (o: { connection: string; hash: string; page: unknown; actor?: string | null; issue: Record<string, unknown>; notes?: unknown[] }) =>
  (
    await asService<{ r: Applied }>(
      `select public.notion_apply(${lit(o.connection)}::uuid, ${lit(o.hash)}, ${lit(o.page)}::jsonb, ` +
        `${o.actor ? `${lit(o.actor)}::uuid` : 'null'}, ${lit({ id: ulid(), sort_order: 'a0', ...o.issue })}::jsonb, ${lit(o.notes ?? [])}::jsonb) as r`,
    )
  )[0].r

/** the lookup's answer with the right key */
async function found(...args: Parameters<typeof lookup>) {
  const r = await lookup(...args)
  if (r.state !== 'ok') throw new Error(`The lookup said ${r.state}.`)
  return r
}

/** the function exists, but this caller may not run it (Postgres refuses before it starts) */
async function expectNoGrant(call: PromiseLike<{ error: { message: string; code?: string } | null }>) {
  const { error } = await call
  expect(error?.message).toMatch(/permission denied for function/)
}

/** a Notion page id nobody has */
const pageId = () => crypto.randomUUID().replaceAll('-', '')

describe.skipIf(!enabled)('Notion', () => {
  let w: World
  let ana: Someone
  let bob: Someone

  /** a workspace of ana's with bob in it, connected to Notion */
  async function connected(label: string) {
    const { ws, team: eng } = await newWorkspace(ana, label)
    await addMember(ana, bob, ws)
    const made = await ok(ana.db.rpc('notion_connect', { p_workspace: ws, p_team: eng }))
    const { id, secret } = made as { id: string; secret: string }
    return { ws, eng, conn: id, secret, hash: await sha256Hex(secret) }
  }

  const issueByRef = async (ws: string, team: string, ref: string) =>
    ok(ana.db.from('issues').select().eq('workspace_id', ws).eq('team_id', team).eq('number', Number(ref.split('-')[1])).single())

  beforeAll(async () => {
    w = await getWorld()
    ana = w.ana
    bob = w.bob
  }, 60_000)
  afterAll(closeChannels)

  test('only admins see and connect it, once per workspace, and the key is kept as its sha256', async () => {
    const { ws, team: eng } = await newWorkspace(ana, 'notion-who')
    await addMember(ana, bob, ws)
    await expectDenied(bob.db.rpc('notion_connect', { p_workspace: ws, p_team: eng }))
    await expectDenied(w.cy.db.rpc('notion_connect', { p_workspace: ws, p_team: eng }))
    await expectError(ana.db.rpc('notion_connect', { p_workspace: ws, p_team: w.eng }), '23503')
    const made = (await ok(ana.db.rpc('notion_connect', { p_workspace: ws, p_team: eng }))) as { id: string; secret: string }
    expect(made.secret).toMatch(/^[0-9a-f]{64}$/)
    const row = await ok(ana.db.from('notion_connections').select().eq('id', made.id).single())
    expect(row.secret_hash).toBe(await sha256Hex(made.secret))
    expect(row.added_by).toBe(ana.profileId)
    expect(row.team_id).toBe(eng)
    expect(await ok(bob.db.from('notion_connections').select().eq('workspace_id', ws))).toEqual([])
    await expectError(ana.db.rpc('notion_connect', { p_workspace: ws, p_team: eng }), '23505')
    // nobody makes one by hand: the secret comes from notion_connect
    await expectDenied(ana.db.from('notion_connections').insert({ workspace_id: w.ws, secret_hash: '0'.repeat(64) }))
  })

  test('admins change its team and remove it; nobody changes the rest', async () => {
    const { ws, conn } = await connected('notion-change')
    const des = await newTeam(ana, ws, 'DES')
    expect(await ok(ana.db.from('notion_connections').update({ team_id: des }).eq('id', conn).select('team_id'))).toEqual([{ team_id: des }])
    await expectError(ana.db.from('notion_connections').update({ team_id: w.des }).eq('id', conn), '23503')
    expect(await ok(bob.db.from('notion_connections').update({ team_id: des }).eq('id', conn).select())).toEqual([])
    expect(await ok(bob.db.from('notion_connections').delete().eq('id', conn).select())).toEqual([])
    await expectError(ana.db.from('notion_connections').update({ secret_hash: '0'.repeat(64) }).eq('id', conn))
    await expectError(ana.db.from('notion_connections').update({ last_event: { problem: 'busy' } }).eq('id', conn))
    expect(await ok(ana.db.from('notion_connections').delete().eq('id', conn).select('id'))).toHaveLength(1)
  })

  test('people who are signed in, or not, can call neither webhook function', async () => {
    const anon = client()
    for (const db of [ana.db, anon]) {
      await expectNoGrant(db.rpc('notion_lookup', { p_connection: crypto.randomUUID(), p_secret_hash: '0'.repeat(64), p_emails: [], p_team: '' }))
      await expectNoGrant(
        db.rpc('notion_apply', { p_connection: crypto.randomUUID(), p_secret_hash: '0'.repeat(64), p_page: {}, p_actor: ana.profileId, p_issue: {}, p_notes: [] }),
      )
    }
    await expectNoGrant(anon.rpc('notion_connect', { p_workspace: w.ws, p_team: w.eng }))
    await expectNoGrant(anon.rpc('notion_new_secret', { p_connection: crypto.randomUUID() }))
  })

  test('the lookup: nothing without the right key; members, matching emails, labels and the team with it', async () => {
    const { ws, eng, conn, hash } = await connected('notion-lookup')
    const des = await newTeam(ana, ws, 'DES')
    await ok(ana.db.from('teams').update({ name: 'Design' }).eq('id', des))
    await ok(ana.db.from('labels').insert({ id: ulid(), workspace_id: ws, name: 'Bug', color: 'red' }))
    const first = await newIssue(ana, ws, eng, { sort_order: 'a3' })

    expect(await lookup(crypto.randomUUID(), hash)).toEqual({ state: 'unknown' })
    expect(await lookup(conn, '0'.repeat(64), [testEmail('ana')])).toEqual({ state: 'wrong_key' })

    // someone who left, someone outside, and an address nobody confirmed don't count
    const dee = w.dee
    await addMember(ana, dee, ws)
    await ok(ana.db.from('workspace_members').update({ removed_at: new Date().toISOString() }).eq('workspace_id', ws).eq('profile_id', dee.profileId))
    const una = await signUp('notion-unconfirmed')
    await addMember(ana, una, ws)
    await ownerSql(`update auth.users set email_confirmed_at = null where id = ${lit(una.userId)}`)

    const got = await found(conn, hash, [testEmail('ana').toUpperCase(), testEmail('bob'), testEmail('dee'), testEmail('cy'), testEmail('notion-unconfirmed')])
    expect(got.workspace).toBe(ws)
    expect(got.team).toEqual({ id: eng, key: 'ENG', first_sort: first.sort_order })
    expect(got.emails.map((e) => e.profile_id).sort()).toEqual([ana.profileId, bob.profileId].sort())
    expect(got.people.map((p) => p.id).sort()).toEqual([ana.profileId, bob.profileId, una.profileId].sort())
    expect(got.labels.map((l) => l.name)).toEqual(['Bug'])

    // the Team property: by key or name; never another workspace's; anything else is the connection's
    const teamFor = async (hint: string) => (await found(conn, hash, [], hint)).team?.id
    expect(await teamFor('des')).toBe(des)
    expect(await teamFor(' design ')).toBe(des)
    expect(await teamFor('Engineering')).toBe(eng)
    expect(await teamFor('Nope')).toBe(eng)
    const { ws: other } = await newWorkspace(w.cy, 'notion-other')
    await newTeam(w.cy, other, 'OTH')
    expect(await teamFor('OTH')).toBe(eng)
  })

  test('a new address: the old one stops working at once', async () => {
    const { eng, conn, hash } = await connected('notion-replace')
    const before = await ok(ana.db.from('notion_connections').select('secret_set_at').eq('id', conn).single())
    await expectDenied(bob.db.rpc('notion_new_secret', { p_connection: conn }))
    await Bun.sleep(20)
    const secret = await ok(ana.db.rpc('notion_new_secret', { p_connection: conn }))
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(await lookup(conn, hash)).toEqual({ state: 'wrong_key' })
    await expect(apply({ connection: conn, hash, page: { id: pageId() }, issue: { team_id: eng } })).rejects.toThrow(/SP020: This address was replaced/)
    await found(conn, await sha256Hex(secret))
    const after = await ok(ana.db.from('notion_connections').select('secret_set_at').eq('id', conn).single())
    expect(after.secret_set_at > before.secret_set_at).toBe(true)
  })

  test('a page with a member as its author: the issue is theirs, with labels, a note, history and the link back, live', async () => {
    const { ws, eng, conn, hash } = await connected('notion-author')
    const bug = ulid()
    await ok(ana.db.from('labels').insert({ id: bug, workspace_id: ws, name: 'Bug', color: 'red' }))
    const earlier = await newIssue(ana, ws, eng)
    const heard = await listen(ana, `ws:${ws}`)
    const page = pageId()
    const url = `https://www.notion.so/Fix-login-${page}`
    const id = ulid()
    const note = ulid()
    const r = await apply({
      connection: conn,
      hash,
      page: { id: page, url },
      actor: ana.profileId,
      issue: { id, team_id: eng, title: 'Fix login', description: `Hi\n\n[Notion page](${url})`, status: 'in_progress', priority: 2, assignee_id: bob.profileId, due_date: '2026-10-31', labels: [bug] },
      notes: [{ id: note, to: bob.profileId, type: 'assigned' }],
    })
    expect(r).toEqual({ issue: `ENG-${earlier.number + 1}`, new: true })
    const issue = await ok(ana.db.from('issues').select().eq('id', id).single())
    expect(issue).toMatchObject({ created_by: ana.profileId, title: 'Fix login', status: 'in_progress', priority: 2, assignee_id: bob.profileId, due_date: '2026-10-31' })
    expect(await heard.waitFor((m) => m.table === 'issues' && m.op === 'INSERT' && m.row?.id === id)).toBeDefined()

    const events = await ok(ana.db.from('issue_events').select('actor_id, changes').eq('issue_id', id).order('id'))
    expect(events).toEqual([
      { actor_id: ana.profileId, changes: { created: true, via: { notion: { url } } } },
      { actor_id: ana.profileId, changes: { labels: { added: [bug] } } },
    ])
    expect(await ok(ana.db.from('issue_labels').select('label_id').eq('issue_id', id))).toEqual([{ label_id: bug }])
    const notes = await ok(bob.db.from('inbox').select('id, actor_id, type, extra').eq('issue_id', id))
    expect(notes).toEqual([{ id: note, actor_id: ana.profileId, type: 'assigned', extra: { from: 'notion' } }])
    const rows = await ownerSql<{ issue_id: string; url: string }>(`select issue_id, url from private.notion_pages where page_id = ${lit(page)}`)
    expect(rows).toEqual([{ issue_id: id, url }])
    const saved = await ok(ana.db.from('notion_connections').select('last_event, last_event_at').eq('id', conn).single())
    expect(saved.last_event).toEqual({ title: 'Fix login', ref: r.issue, new: true, author: ana.login })
    expect(saved.last_event_at).not.toBeNull()

    // the author assigning themselves hears nothing
    const own = ulid()
    await apply({ connection: conn, hash, page: { id: pageId() }, actor: ana.profileId, issue: { id: own, team_id: eng, assignee_id: ana.profileId }, notes: [{ id: ulid(), to: ana.profileId, type: 'assigned' }] })
    expect(await ok(ana.db.from('inbox').select('id').eq('issue_id', own))).toEqual([])

    // a teammate's next change says nothing about Notion
    await ok(bob.db.from('issues').update({ status: 'done' }).eq('id', id))
    const later = await ok(ana.db.from('issue_events').select('actor_id, changes').eq('issue_id', id).order('id'))
    expect(later.at(-1)).toEqual({ actor_id: bob.profileId, changes: { status: ['in_progress', 'done'] } })
  })

  test('without a member as its author, nobody made it', async () => {
    const { eng, conn, hash } = await connected('notion-nobody')
    const id = ulid()
    const page = pageId()
    const r = await apply({ connection: conn, hash, page: { id: page }, issue: { id, team_id: eng, assignee_id: bob.profileId }, notes: [{ id: ulid(), to: bob.profileId, type: 'assigned' }] })
    expect(r.new).toBe(true)
    expect((await ok(ana.db.from('issues').select('created_by').eq('id', id).single())).created_by).toBeNull()
    expect(await ok(ana.db.from('issue_events').select('actor_id, changes').eq('issue_id', id))).toEqual([
      { actor_id: null, changes: { created: true, via: { notion: { url: `https://www.notion.so/${page}` } } } },
    ])
    expect(await ok(bob.db.from('inbox').select('actor_id, extra').eq('issue_id', id))).toEqual([{ actor_id: null, extra: { from: 'notion' } }])
    expect((await ok(ana.db.from('notion_connections').select('last_event').eq('id', conn).single())).last_event).toMatchObject({ new: true, author: null })
  })

  test('the same page again keeps its issue; after it’s deleted the page makes a new one', async () => {
    const { ws, eng, conn, hash } = await connected('notion-again')
    const page = pageId()
    const first = await apply({ connection: conn, hash, page: { id: page }, issue: { team_id: eng, title: 'Once' } })
    const number = async () => (await ok(ana.db.from('teams').select('last_number').eq('id', eng).single())).last_number
    const before = await number()
    // with dashes and capitals, as Notion may write it
    const dashed = `${page.slice(0, 8)}-${page.slice(8, 12)}-${page.slice(12, 16)}-${page.slice(16, 20)}-${page.slice(20)}`.toUpperCase()
    expect(await apply({ connection: conn, hash, page: { id: dashed }, issue: { team_id: eng, title: 'Twice' } })).toEqual({ issue: first.issue, new: false, archived: false })
    expect(await number()).toBe(before)
    expect(await ok(ana.db.from('issues').select('id').eq('workspace_id', ws))).toHaveLength(1)
    expect((await ok(ana.db.from('notion_connections').select('last_event').eq('id', conn).single())).last_event).toEqual({ title: 'Once', ref: first.issue, new: false })

    const issue = await issueByRef(ws, eng, first.issue ?? '')
    await ok(ana.db.from('issues').update({ archived_at: new Date().toISOString() }).eq('id', issue.id))
    expect(await apply({ connection: conn, hash, page: { id: page }, issue: { team_id: eng } })).toEqual({ issue: first.issue, new: false, archived: true })
    await ok(ana.db.from('issues').delete().eq('id', issue.id))
    const again = await apply({ connection: conn, hash, page: { id: page }, issue: { team_id: eng } })
    expect(again.new).toBe(true)
    expect(again.issue).not.toBe(first.issue)
  })

  test('when its team is deleted, pages wait for another one', async () => {
    const { ws, conn, hash } = await connected('notion-team')
    const des = await newTeam(ana, ws, 'DES')
    await ok(ana.db.from('notion_connections').update({ team_id: des }).eq('id', conn))
    await ok(ana.db.from('teams').delete().eq('id', des))
    expect((await ok(ana.db.from('notion_connections').select('team_id').eq('id', conn).single())).team_id).toBeNull()
    expect((await found(conn, hash)).team).toBeNull()
    expect(await apply({ connection: conn, hash, page: { id: pageId() }, issue: { team_id: null, title: 'Lost' } })).toEqual({ problem: 'team' })
    // a team of another workspace is no team
    expect(await apply({ connection: conn, hash, page: { id: pageId() }, issue: { team_id: w.eng, title: 'Lost' } })).toEqual({ problem: 'team' })
    expect((await ok(ana.db.from('notion_connections').select('last_event').eq('id', conn).single())).last_event).toEqual({ title: 'Lost', problem: 'team' })
    expect(await ok(ana.db.from('issues').select('id').eq('workspace_id', ws))).toEqual([])
  })

  test('someone who isn’t a member: as the author refused, as the assignee left out', async () => {
    const { ws, eng, conn, hash } = await connected('notion-strangers')
    await expect(apply({ connection: conn, hash, page: { id: pageId() }, actor: w.cy.profileId, issue: { team_id: eng } })).rejects.toThrow(/isn.t in this workspace/)
    expect(await ok(ana.db.from('issues').select('id').eq('workspace_id', ws))).toEqual([])
    const id = ulid()
    await apply({ connection: conn, hash, page: { id: pageId() }, issue: { id, team_id: eng, assignee_id: w.cy.profileId } })
    expect((await ok(ana.db.from('issues').select('assignee_id').eq('id', id).single())).assignee_id).toBeNull()
  })

  test('too many pages at once', async () => {
    const { ws, eng, conn, hash } = await connected('notion-busy')
    const issue = await newIssue(ana, ws, eng)
    await ownerSql(
      `insert into private.notion_pages (workspace_id, page_id, issue_id, connection_id, url)
       select ${lit(ws)}, md5(${lit(conn)} || n), ${lit(issue.id)}, ${lit(conn)}, 'https://www.notion.so/x' from generate_series(1, 100) n`,
    )
    expect(await apply({ connection: conn, hash, page: { id: pageId() }, issue: { team_id: eng } })).toEqual({ problem: 'busy' })
    expect((await ok(ana.db.from('notion_connections').select('last_event').eq('id', conn).single())).last_event).toEqual({ problem: 'busy' })
  })

  test('what doesn’t fit is tidied', async () => {
    const { eng, conn, hash } = await connected('notion-tidy')
    const id = ulid()
    await apply({
      connection: conn,
      hash,
      page: { id: pageId(), url: 'https://evil.example/x' },
      issue: { id, team_id: eng, title: '  \n ', description: 'x'.repeat(60_000), status: 'blocked', priority: 7, due_date: '2026-02-31' },
    })
    const issue = await ok(ana.db.from('issues').select('title, description, status, priority, due_date').eq('id', id).single())
    expect(issue).toEqual({ title: 'Untitled', description: 'x'.repeat(50_000), status: 'todo', priority: 0, due_date: null })
    const [event] = await ok(ana.db.from('issue_events').select('changes').eq('issue_id', id))
    expect(event.changes).toMatchObject({ via: { notion: { url: expect.stringMatching(/^https:\/\/www\.notion\.so\/[0-9a-f]{32}$/) } } })
  })

  test('disconnected and connected again, a page sent before keeps its issue', async () => {
    const { ws, eng, conn, hash } = await connected('notion-reconnect')
    const page = pageId()
    const first = await apply({ connection: conn, hash, page: { id: page }, issue: { team_id: eng } })
    await ok(ana.db.from('notion_connections').delete().eq('id', conn))
    expect(await lookup(conn, hash)).toEqual({ state: 'unknown' })
    const rows = await ownerSql<{ connection_id: string | null }>(`select connection_id from private.notion_pages where page_id = ${lit(page)}`)
    expect(rows).toEqual([{ connection_id: null }])
    const made = (await ok(ana.db.rpc('notion_connect', { p_workspace: ws, p_team: eng }))) as { id: string; secret: string }
    expect(await apply({ connection: made.id, hash: await sha256Hex(made.secret), page: { id: page }, issue: { team_id: eng } })).toEqual({
      issue: first.issue,
      new: false,
      archived: false,
    })
  })
})
