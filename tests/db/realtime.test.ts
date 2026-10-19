import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { closeChannels, enabled, getWorld, listen, newIssue, ok, ulid, type World } from './support'

describe.skipIf(!enabled)('realtime', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, 60_000)
  afterAll(closeChannels)

  test('members hear changes to their workspace within a moment, as small messages', async () => {
    const heard = await listen(w.bob, `ws:${w.ws}`)
    expect(heard.status).toBe('SUBSCRIBED')
    const issue = await newIssue(w.ana, w.ws, w.eng, { title: 'Before', description: 'Long words' })
    await ok(w.ana.db.from('issues').update({ title: 'After' }).eq('id', issue.id))
    const m = await heard.waitFor((m) => m.table === 'issues' && m.op === 'UPDATE' && m.row?.id === issue.id, 3000)
    expect(m).toBeDefined()
    expect(m?.row).toMatchObject({ id: issue.id, title: 'After' })
    expect(Object.keys(m?.row ?? {}).sort()).toEqual(['changed_at', 'id', 'title', 'updated_at'])
  })

  test('people outside the workspace, and topics that are not workspaces, are refused', async () => {
    expect((await listen(w.cy, `ws:${w.ws}`)).status).toBe('CHANNEL_ERROR')
    expect((await listen(w.bob, 'ws:not-a-uuid')).status).toBe('CHANNEL_ERROR')
    expect((await listen(w.cy, `me:${w.bob.profileId}`)).status).toBe('CHANNEL_ERROR')
  })

  test('your inbox comes on your own channel', async () => {
    const mine = await listen(w.bob, `me:${w.bob.profileId}`)
    expect(mine.status).toBe('SUBSCRIBED')
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const id = ulid()
    await ok(w.ana.db.from('inbox').insert({ id, workspace_id: w.ws, recipient_id: w.bob.profileId, type: 'mentioned', issue_id: issue.id }))
    expect(await mine.waitFor((m) => m.table === 'inbox' && m.op === 'INSERT' && m.row?.id === id)).toBeDefined()
  })

  test('invites are never broadcast (they hold the links)', async () => {
    const heard = await listen(w.bob, `ws:${w.ws}`)
    expect(heard.status).toBe('SUBSCRIBED')
    await ok(w.ana.db.from('invites').insert({ workspace_id: w.ws }))
    expect(await heard.waitFor((m) => m.table === 'invites', 2000)).toBeUndefined()
  })
})
