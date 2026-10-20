import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  addMember,
  anyTable,
  type Change,
  closeChannels,
  DISPLAY,
  enabled,
  getWorld,
  type Listener,
  listen,
  newIssue,
  newTeam,
  newWorkspace,
  ok,
  ownerSql,
  RUN,
  type TableName,
  lit,
  ulid,
  type World,
} from './support'
import type { Json } from '@/backend/database.types'

// Every shared table gets the same rules and triggers from one list (private.wiring, P22). This checks them by what
// they do: changed_at moves on every write, a delete leaves a note in deletions, and members hear every change.
// tests/wiringList.test.ts checks that every table in the list is covered here.

interface Case {
  table: TableName
  /** makes the row's parents and returns the row to insert (without workspace_id) */
  make: () => Promise<Record<string, Json>>
  keys: string[]
  /** a change people may make, or nothing for tables that are only added and removed */
  update?: Record<string, Json>
}

describe.skipIf(!enabled)('every shared table is wired the same way', () => {
  let w: World
  let heard: Listener
  let team: string
  beforeAll(async () => {
    w = await getWorld()
    heard = await listen(w.bob, `ws:${w.ws}`)
    team = await newTeam(w.ana, w.ws, 'WIRE')
  }, 60_000)
  afterAll(closeChannels)

  const insert = async (table: TableName, row: Record<string, Json>) => {
    await ok(anyTable(w.ana.db, table).insert({ workspace_id: w.ws, ...row }))
  }
  const issueId = async () => (await newIssue(w.ana, w.ws, team)).id
  const labelId = async () => {
    const id = ulid()
    await insert('labels', { id, name: `W ${id}`, color: '#000' })
    return id
  }
  const projectId = async () => {
    const id = ulid()
    await insert('projects', { id, name: 'Wired' })
    return id
  }
  const changedAt = async (table: TableName, key: Record<string, unknown>) =>
    (await ok(anyTable(w.ana.db, table).select('changed_at').match(key).single<{ changed_at: string }>())).changed_at
  const about = (table: string, op: string, key: Record<string, unknown>) => (m: Change) =>
    m.table === table && m.op === op && Object.entries(key).every(([k, v]) => m.row?.[k] === v)

  const cases: Case[] = [
    { table: 'teams', keys: ['id'], make: async () => ({ id: crypto.randomUUID(), key: 'WT', name: 'Wired team' }), update: { name: 'Renamed' } },
    { table: 'team_members', keys: ['team_id', 'profile_id'], make: async () => ({ team_id: team, profile_id: w.bob.profileId }) },
    { table: 'labels', keys: ['id'], make: async () => ({ id: ulid(), name: `Wired ${ulid()}`, color: '#000' }), update: { color: '#fff' } },
    { table: 'projects', keys: ['id'], make: async () => ({ id: ulid(), name: 'Wired' }), update: { name: 'Renamed' } },
    { table: 'project_teams', keys: ['project_id', 'team_id'], make: async () => ({ project_id: await projectId(), team_id: team }) },
    { table: 'issues', keys: ['id'], make: async () => ({ id: ulid(), team_id: team, title: 'Wired', sort_order: 'a0' }), update: { title: 'Renamed' } },
    { table: 'issue_labels', keys: ['issue_id', 'label_id'], make: async () => ({ issue_id: await issueId(), label_id: await labelId() }) },
    {
      table: 'issue_followers',
      keys: ['issue_id', 'profile_id'],
      make: async () => ({ issue_id: await issueId(), profile_id: w.bob.profileId, following: true }),
      update: { following: false },
    },
    { table: 'comments', keys: ['id'], make: async () => ({ id: ulid(), issue_id: await issueId(), body: 'Wired' }), update: { body: 'Rewired' } },
    { table: 'views', keys: ['id'], make: async () => ({ id: ulid(), name: 'Wired', display: DISPLAY }), update: { name: 'Renamed' } },
  ]

  for (const c of cases) {
    test(c.table, async () => {
      const row = await c.make()
      const key = Object.fromEntries(c.keys.map((k) => [k, row[k]]))
      await insert(c.table, row)
      const first = await changedAt(c.table, key)
      if (c.update) {
        await ok(anyTable(w.ana.db, c.table).update(c.update).match(key))
        expect((await changedAt(c.table, key)) > first).toBe(true)
      }
      await ok(anyTable(w.ana.db, c.table).delete().match(key))

      const notes = await ok(w.ana.db.from('deletions').select('row_key').eq('workspace_id', w.ws).eq('table_name', c.table))
      expect(notes.map((n) => n.row_key)).toContainEqual(key)
      expect(await heard.waitFor(about(c.table, 'INSERT', key))).toBeDefined()
      if (c.update) expect(await heard.waitFor(about(c.table, 'UPDATE', key))).toBeDefined()
      expect(await heard.waitFor(about(c.table, 'DELETE', key))).toBeDefined()
    })
  }

  // written only by github_apply (the GitHub webhook), so this writes it as the database's owner
  test('issue_pull_requests', async () => {
    const key = { issue_id: await issueId(), pull_request_id: String(Date.now()) }
    const where = `issue_id = ${lit(key.issue_id)} and pull_request_id = ${lit(key.pull_request_id)}`
    await ownerSql(
      `insert into public.issue_pull_requests (workspace_id, issue_id, pull_request_id, repo, number, title, url, state, github_updated_at)
       values (${lit(w.ws)}, ${lit(key.issue_id)}, ${lit(key.pull_request_id)}, 'acme/web', 7, 'Wired', 'https://github.com/acme/web/pull/7', 'open', now())`,
    )
    const first = await changedAt('issue_pull_requests', key)
    await ownerSql(`update public.issue_pull_requests set state = 'merged' where ${where}`)
    expect((await changedAt('issue_pull_requests', key)) > first).toBe(true)
    await ownerSql(`delete from public.issue_pull_requests where ${where}`)

    const notes = await ok(w.ana.db.from('deletions').select('row_key').eq('workspace_id', w.ws).eq('table_name', 'issue_pull_requests'))
    expect(notes.map((n) => n.row_key)).toContainEqual(key)
    for (const op of ['INSERT', 'UPDATE', 'DELETE']) expect(await heard.waitFor(about('issue_pull_requests', op, key))).toBeDefined()
  })

  test('workspaces, members and read marks', async () => {
    const mine = await listen(w.ana, `me:${w.ana.profileId}`)
    expect(mine.status).toBe('SUBSCRIBED')
    const { ws } = await newWorkspace(w.ana, 'wired')
    expect(await mine.waitFor(about('read_state', 'INSERT', { workspace_id: ws }))).toBeDefined()

    const there = await listen(w.ana, `ws:${ws}`)
    expect(there.status).toBe('SUBSCRIBED')
    const first = await changedAt('workspaces', { id: ws })
    await ok(w.ana.db.from('workspaces').update({ name: `dbtest ${RUN} rewired` }).eq('id', ws))
    expect((await changedAt('workspaces', { id: ws })) > first).toBe(true)
    expect(await there.waitFor(about('workspaces', 'UPDATE', { id: ws }))).toBeDefined()

    const member = { workspace_id: ws, profile_id: w.bob.profileId }
    await addMember(w.ana, w.bob, ws)
    expect(await there.waitFor(about('workspace_members', 'INSERT', member))).toBeDefined()
    const joined = await changedAt('workspace_members', member)
    await ok(w.ana.db.from('workspace_members').update({ role: 'admin' }).match(member))
    expect((await changedAt('workspace_members', member)) > joined).toBe(true)
    expect(await there.waitFor(about('workspace_members', 'UPDATE', member))).toBeDefined()

    // a workspace that goes says so once, on its own channel, and leaves no notes (nobody could read them)
    await ok(w.ana.db.from('workspaces').delete().eq('id', ws))
    expect(await there.waitFor(about('workspaces', 'DELETE', { id: ws }))).toBeDefined()
    expect(there.got.filter((m) => m.op === 'DELETE' && m.table !== 'workspaces' && m.table !== 'profiles')).toEqual([])
    expect(await ok(w.ana.db.from('deletions').select().eq('workspace_id', ws))).toEqual([])
  })

  test('inbox notes come and go on their owner’s channel, without deletion notes', async () => {
    const mine = await listen(w.bob, `me:${w.bob.profileId}`)
    expect(mine.status).toBe('SUBSCRIBED')
    const issue = await issueId()
    const id = ulid()
    await ok(w.ana.db.from('inbox').insert({ id, workspace_id: w.ws, recipient_id: w.bob.profileId, type: 'mentioned', issue_id: issue }))
    await ok(w.bob.db.from('inbox').update({ read_at: new Date().toISOString() }).eq('id', id))
    await ok(w.bob.db.from('inbox').delete().eq('id', id))
    for (const op of ['INSERT', 'UPDATE', 'DELETE']) expect(await mine.waitFor(about('inbox', op, { id }))).toBeDefined()
    expect(await ok(w.ana.db.from('deletions').select().eq('workspace_id', w.ws).eq('table_name', 'inbox'))).toEqual([])
  })

  test('a person from Linear who goes leaves a note in their workspace', async () => {
    const guest = crypto.randomUUID()
    await ok(w.ana.db.rpc('import_rows', { p_ws: w.ws, p_table: 'profiles', p_rows: [{ id: guest, login: `~dbt-${RUN}-g5`, name: 'Guest Five' }] }))
    await ok(w.ana.db.rpc('link_person', { p_ws: w.ws, p_guest: guest, p_to: w.ana.profileId }))
    const notes = await ok(w.ana.db.from('deletions').select('row_key').eq('workspace_id', w.ws).eq('table_name', 'profiles'))
    expect(notes.map((n) => n.row_key)).toContainEqual({ id: guest })
    expect(await heard.waitFor((m) => m.op === 'catch_up')).toBeDefined()
  })

  test('a new name reaches the workspaces the person is in', async () => {
    await ok(w.bob.db.from('profiles').update({ name: 'Bob Renamed' }).eq('id', w.bob.profileId))
    const m = await heard.waitFor(about('profiles', 'UPDATE', { id: w.bob.profileId }))
    expect(m?.row?.name).toBe('Bob Renamed')
  })

  test('read marks reach their owner', async () => {
    const mine = await listen(w.bob, `me:${w.bob.profileId}`)
    expect(mine.status).toBe('SUBSCRIBED')
    await ok(w.bob.db.from('read_state').update({ read_until: new Date().toISOString() }).eq('profile_id', w.bob.profileId).eq('workspace_id', w.ws))
    expect(await mine.waitFor(about('read_state', 'UPDATE', { profile_id: w.bob.profileId, workspace_id: w.ws }))).toBeDefined()
  })
})
