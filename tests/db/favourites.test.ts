import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  addMember,
  type Change,
  closeChannels,
  DISPLAY,
  enabled,
  expectDenied,
  expectError,
  getWorld,
  listen,
  newTeam,
  newWorkspace,
  ok,
  projectInsert,
  type Someone,
  ulid,
  type World,
} from './support'

// Favourites are yours alone: nobody else reads or changes them, and they go with the project or view they star,
// quietly (no deletion notes, nothing on the workspace's channel).

describe.skipIf(!enabled)('favourites', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, 60_000)
  afterAll(closeChannels)

  const project = async (who: Someone, ws: string) => {
    const id = ulid()
    await ok(who.db.from('projects').insert(projectInsert({ id, workspace_id: ws, name: 'Starred' })))
    return id
  }
  const view = async (who: Someone, ws: string, team: string | null = null) => {
    const id = ulid()
    await ok(who.db.from('views').insert({ id, workspace_id: ws, team_id: team, name: 'Starred', display: DISPLAY }))
    return id
  }
  const star = (who: Someone, ws: string, kind: string, item: string, sort = 'a0') =>
    who.db.from('favourites').insert({ profile_id: who.profileId, workspace_id: ws, kind, item_id: item, sort_order: sort })
  const mine = async (who: Someone, item: string) => ok(who.db.from('favourites').select('item_id').eq('item_id', item))
  const about = (op: string, item: string) => (m: Change) => m.table === 'favourites' && m.op === op && m.row?.item_id === item

  test('only you read and change yours', async () => {
    const p = await project(w.ana, w.ws)
    const v = await view(w.ana, w.ws)
    await ok(star(w.bob, w.ws, 'project', p))
    await ok(star(w.bob, w.ws, 'view', v, 'a1'))

    expect(await ok(w.ana.db.from('favourites').select().eq('workspace_id', w.ws).eq('profile_id', w.bob.profileId))).toEqual([])
    await expectDenied(w.ana.db.from('favourites').insert({ profile_id: w.bob.profileId, workspace_id: w.ws, kind: 'project', item_id: await project(w.ana, w.ws), sort_order: 'a0' }))
    expect(await ok(w.ana.db.from('favourites').update({ sort_order: 'z' }).eq('profile_id', w.bob.profileId).select())).toEqual([])
    expect(await ok(w.ana.db.from('favourites').delete().eq('profile_id', w.bob.profileId).select())).toEqual([])
    expect(await mine(w.bob, p)).toHaveLength(1)
    expect(await mine(w.bob, v)).toHaveLength(1)
    // someone outside the workspace sees none of them either
    expect(await ok(w.cy.db.from('favourites').select().eq('profile_id', w.bob.profileId))).toEqual([])

    // only the order (and extra) changes: the kind, the item and the workspace stay
    expect(await ok(w.bob.db.from('favourites').update({ sort_order: 'a5' }).eq('profile_id', w.bob.profileId).eq('item_id', p).select('sort_order'))).toEqual([
      { sort_order: 'a5' },
    ])
    await expectDenied(w.bob.db.from('favourites').update({ kind: 'view' }).eq('item_id', p))
    await expectDenied(w.bob.db.from('favourites').update({ item_id: v }).eq('item_id', p))
    await expectDenied(w.bob.db.from('favourites').update({ workspace_id: w.ws }).eq('item_id', p))
  })

  test('a favourite stars something of its own kind, in its own workspace, where you are a member', async () => {
    const elsewhere = await newWorkspace(w.bob, 'favourites elsewhere')
    const theirs = await project(w.bob, elsewhere.ws)
    await expectError(star(w.bob, w.ws, 'project', theirs), '23503')
    await expectError(star(w.bob, w.ws, 'view', await project(w.ana, w.ws)), '23503')
    await expectError(star(w.bob, w.ws, 'issue', await project(w.ana, w.ws)), '23514')

    const closed = await newWorkspace(w.ana, 'favourites closed')
    await expectDenied(star(w.bob, closed.ws, 'project', await project(w.ana, closed.ws)))
  })

  test('starring again leaves one', async () => {
    const p = await project(w.ana, w.ws)
    const row = { profile_id: w.bob.profileId, workspace_id: w.ws, kind: 'project', item_id: p, sort_order: 'a0' }
    await ok(w.bob.db.from('favourites').upsert(row, { onConflict: 'profile_id,item_id', ignoreDuplicates: true }))
    await ok(w.bob.db.from('favourites').upsert({ ...row, sort_order: 'b0' }, { onConflict: 'profile_id,item_id', ignoreDuplicates: true }))
    expect(await ok(w.bob.db.from('favourites').select('sort_order').eq('item_id', p))).toEqual([{ sort_order: 'a0' }])
  })

  test('deleting the project, the view or its team takes the favourite with it, telling only you', async () => {
    const own = await listen(w.bob, `me:${w.bob.profileId}`)
    const theirs = await listen(w.ana, `ws:${w.ws}`)
    expect([own.status, theirs.status]).toEqual(['SUBSCRIBED', 'SUBSCRIBED'])
    const team = await newTeam(w.ana, w.ws, 'FAV')
    const p = await project(w.ana, w.ws)
    const v = await view(w.ana, w.ws)
    const tv = await view(w.ana, w.ws, team)
    for (const [kind, item] of [['project', p], ['view', v], ['view', tv]]) await ok(star(w.bob, w.ws, kind, item))

    await ok(w.ana.db.from('projects').delete().eq('id', p))
    await ok(w.ana.db.from('views').delete().eq('id', v))
    await ok(w.ana.db.from('teams').delete().eq('id', team))

    for (const item of [p, v, tv]) {
      expect(await mine(w.bob, item)).toEqual([])
      expect(await own.waitFor(about('DELETE', item))).toBeDefined()
    }
    expect(await ok(w.bob.db.from('deletions').select().eq('workspace_id', w.ws).eq('table_name', 'favourites'))).toEqual([])
    expect(theirs.got.filter((m) => m.table === 'favourites')).toEqual([])
  })

  test('after leaving they are out of reach, and rejoining brings them back', async () => {
    const { ws } = await newWorkspace(w.ana, 'favourites leave')
    await addMember(w.ana, w.dee, ws)
    const p = await project(w.ana, ws)
    await ok(star(w.dee, ws, 'project', p))

    await ok(w.dee.db.rpc('leave_workspace', { p_ws: ws }))
    expect(await ok(w.dee.db.from('favourites').select().eq('workspace_id', ws))).toEqual([])
    await expectDenied(star(w.dee, ws, 'project', await project(w.ana, ws), 'b0'))

    await addMember(w.ana, w.dee, ws)
    expect(await mine(w.dee, p)).toHaveLength(1)
  })
})
