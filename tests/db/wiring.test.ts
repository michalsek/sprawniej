import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { closeChannels, DISPLAY, enabled, getWorld, type Listener, listen, newIssue, newTeam, ok, ulid, type World } from './support'

// Every shared table gets the same triggers from one list (private.wiring, P22). This checks them by what they do:
// changed_at moves on every write, a delete leaves a note in deletions, and members hear every change.

interface Case {
  table: string
  /** makes the row's parents and returns the row to insert (without workspace_id) */
  make: () => Promise<Record<string, unknown>>
  keys: string[]
  /** a change people may make, or nothing for tables that are only added and removed */
  update?: Record<string, unknown>
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

  const insert = async (table: string, row: Record<string, unknown>) => {
    await ok(w.ana.db.from(table).insert({ workspace_id: w.ws, ...row }))
  }
  const issueId = async () => (await newIssue(w.ana, w.ws, team)).id as string
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
      const match = (q: any) => c.keys.reduce((q2, k) => q2.eq(k, row[k]), q)
      await insert(c.table, row)
      const first = await ok(match(w.ana.db.from(c.table).select('changed_at')).single())
      if (c.update) {
        await ok(match(w.ana.db.from(c.table).update(c.update)))
        const second = await ok(match(w.ana.db.from(c.table).select('changed_at')).single())
        expect((second as any).changed_at > (first as any).changed_at).toBe(true)
      }
      await ok(match(w.ana.db.from(c.table).delete()))

      const notes = await ok(w.ana.db.from('deletions').select('row_key').eq('workspace_id', w.ws).eq('table_name', c.table))
      expect(notes.map((n) => n.row_key)).toContainEqual(key)
      const about = (op: string) => (m: Record<string, any>) =>
        m.table === c.table && m.op === op && c.keys.every((k) => m.row?.[k] === row[k])
      expect(await heard.waitFor(about('INSERT'))).toBeDefined()
      if (c.update) expect(await heard.waitFor(about('UPDATE'))).toBeDefined()
      expect(await heard.waitFor(about('DELETE'))).toBeDefined()
    })
  }

  test('a new name reaches the workspaces the person is in', async () => {
    await ok(w.bob.db.from('profiles').update({ name: 'Bob Renamed' }).eq('id', w.bob.profileId))
    const m = await heard.waitFor((m) => m.table === 'profiles' && m.op === 'UPDATE' && m.row?.id === w.bob.profileId)
    expect(m?.row.name).toBe('Bob Renamed')
  })

  test('read marks reach their owner', async () => {
    const mine = await listen(w.bob, `me:${w.bob.profileId}`)
    expect(mine.status).toBe('SUBSCRIBED')
    await ok(w.bob.db.from('read_state').update({ read_until: new Date().toISOString() }).eq('profile_id', w.bob.profileId).eq('workspace_id', w.ws))
    expect(await mine.waitFor((m) => m.table === 'read_state' && m.op === 'UPDATE')).toBeDefined()
  })
})
