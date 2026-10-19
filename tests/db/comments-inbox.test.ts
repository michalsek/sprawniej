import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { addMember, closeChannels, enabled, expectDenied, getWorld, newIssue, newWorkspace, ok, ulid, type World } from './support'

describe.skipIf(!enabled)('comments, inbox and read marks', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, 60_000)
  afterAll(closeChannels)

  test('only the author edits and deletes a comment', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const id = ulid()
    const made = await ok(w.bob.db.from('comments').insert({ id, workspace_id: w.ws, issue_id: issue.id, body: 'Hi' }).select().single())
    expect(made.author_id).toBe(w.bob.profileId)
    expect(made.edited_at).toBeNull()
    expect(await ok(w.ana.db.from('comments').update({ body: 'Not mine' }).eq('id', id).select())).toEqual([])
    expect(await ok(w.ana.db.from('comments').delete().eq('id', id).select())).toEqual([])
    const edited = await ok(w.bob.db.from('comments').update({ body: 'Hello' }).eq('id', id).select().single())
    expect(edited.body).toBe('Hello')
    expect(edited.edited_at).not.toBeNull()
    await expectDenied(w.bob.db.from('comments').insert({ id: ulid(), workspace_id: w.ws, issue_id: issue.id, body: 'x', author_id: w.ana.profileId }))
  })

  test('someone removed from a workspace can no longer edit or delete their comments', async () => {
    const { ws, team } = await newWorkspace(w.ana, 'removed')
    await addMember(w.ana, w.dee, ws)
    const issue = await newIssue(w.ana, ws, team)
    const id = ulid()
    await ok(w.dee.db.from('comments').insert({ id, workspace_id: ws, issue_id: issue.id, body: 'Mine' }))
    await ok(w.ana.db.from('workspace_members').update({ removed_at: new Date().toISOString() }).eq('workspace_id', ws).eq('profile_id', w.dee.profileId))
    expect(await ok(w.dee.db.from('comments').update({ body: 'Still mine?' }).eq('id', id).select())).toEqual([])
    expect(await ok(w.dee.db.from('comments').delete().eq('id', id).select())).toEqual([])
    expect(await ok(w.dee.db.from('workspaces').select().eq('id', ws))).toEqual([])
    expect(await ok(w.dee.db.from('issues').select().eq('workspace_id', ws))).toEqual([])
  })

  test('your inbox is yours alone', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const id = ulid()
    await ok(w.ana.db.from('inbox').insert({ id, workspace_id: w.ws, recipient_id: w.bob.profileId, type: 'assigned', issue_id: issue.id }))
    const mine = await ok(w.bob.db.from('inbox').select().eq('id', id).single())
    expect(mine.actor_id).toBe(w.ana.profileId)
    expect(await ok(w.ana.db.from('inbox').select().eq('id', id))).toEqual([])
    expect(await ok(w.cy.db.from('inbox').select().eq('id', id))).toEqual([])
    const read = await ok(w.bob.db.from('inbox').update({ read_at: new Date().toISOString() }).eq('id', id).select('read_at'))
    expect(read).toHaveLength(1)
    await expectDenied(w.bob.db.from('inbox').update({ type: 'mentioned' }).eq('id', id))
  })

  test('notes to people outside the workspace are skipped quietly, and repeats within ten minutes too', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const note = (to: string, type: string, more: { comment_id?: string } = {}) => ({
      id: ulid(),
      workspace_id: w.ws,
      recipient_id: to,
      type,
      issue_id: issue.id,
      comment_id: null,
      status: null,
      ...more,
    })
    // ana can't read notes she sends (they are bob's), so no .select() on these inserts
    const bobs = async (type: string) =>
      (await ok(w.bob.db.from('inbox').select('id').eq('issue_id', issue.id).eq('type', type))).length
    await ok(w.ana.db.from('inbox').insert([note(w.cy.profileId, 'assigned'), note(w.guest, 'assigned'), note(w.bob.profileId, 'assigned'), note(w.ana.profileId, 'assigned')]))
    expect(await bobs('assigned')).toBe(1)
    expect(await ok(w.cy.db.from('inbox').select('id').eq('issue_id', issue.id))).toEqual([])
    expect(await ok(w.ana.db.from('inbox').select('id').eq('issue_id', issue.id))).toEqual([])
    await ok(w.ana.db.from('inbox').insert(note(w.bob.profileId, 'assigned')))
    expect(await bobs('assigned')).toBe(1)

    const comment = ulid()
    await ok(w.ana.db.from('comments').insert({ id: comment, workspace_id: w.ws, issue_id: issue.id, body: 'Look' }))
    await ok(w.ana.db.from('inbox').insert(note(w.bob.profileId, 'commented', { comment_id: comment })))
    await ok(w.ana.db.from('inbox').insert(note(w.bob.profileId, 'commented', { comment_id: comment })))
    expect(await bobs('commented')).toBe(2)
  })

  test('read marks are private', async () => {
    expect(await ok(w.bob.db.from('read_state').select().eq('workspace_id', w.ws))).toHaveLength(1)
    expect(await ok(w.ana.db.from('read_state').select().eq('profile_id', w.bob.profileId))).toEqual([])
    await expectDenied(w.ana.db.from('read_state').insert({ profile_id: w.bob.profileId, workspace_id: w.ws }))
    const marked = await ok(
      w.bob.db.from('read_state').upsert({ profile_id: w.bob.profileId, workspace_id: w.ws, read_until: new Date().toISOString() }).select(),
    )
    expect(marked).toHaveLength(1)
  })
})
