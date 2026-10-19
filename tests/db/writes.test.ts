/** Saving through src/backend/writes/send.ts against the real rules: what each kind of request answers. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { MESSAGES } from '@/backend/writes/problems'
import { postgrest, type Answer, type Outcome } from '@/backend/writes/send'
import { createWorkspace } from '@/backend/workspaces'
import { closeChannels, enabled, getWorld, newIssue, newTeam, ok, RUN, ulid, type World } from './support'

const outcome = (a: Answer, ks: string): Outcome | undefined => ('outcomes' in a ? a.outcomes.get(ks) : undefined)
const problem = (a: Answer) => ('problem' in a ? a.problem : undefined)

describe.skipIf(!enabled)('saving changes', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, 60_000)
  afterAll(closeChannels)

  test('a join row is added unless it is there, with only the right to add', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const label = ulid()
    await ok(w.ana.db.from('labels').insert({ id: label, workspace_id: w.ws, name: `L ${label}`, color: '#000' }))
    const row = { workspace_id: w.ws, issue_id: issue.id, label_id: label }
    const bob = postgrest(w.bob.db)
    const first = await bob.run({ kind: 'insert', table: 'issue_labels', rows: [row] }, { retry: false })
    expect(outcome(first, `${issue.id}|${label}`)).toMatchObject({ ok: true, row: { issue_id: issue.id, label_id: label } })
    // the duplicate is ignored (an empty answer), then read back
    const raw = await ok(w.bob.db.from('issue_labels').upsert([row], { onConflict: 'issue_id,label_id', ignoreDuplicates: true }).select())
    expect(raw).toEqual([])
    const again = await bob.run({ kind: 'insert', table: 'issue_labels', rows: [row] }, { retry: true })
    expect(outcome(again, `${issue.id}|${label}`)).toMatchObject({ ok: true, row: { label_id: label } })
    expect(await ok(w.ana.db.from('issue_labels').select().eq('issue_id', issue.id))).toHaveLength(1)
  })

  test('following again the other way round changes the row that is there', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const bob = postgrest(w.bob.db)
    const row = (following: boolean) => ({ workspace_id: w.ws, issue_id: issue.id, profile_id: w.bob.profileId, following })
    await bob.run({ kind: 'insert', table: 'issue_followers', rows: [row(true)] }, { retry: false })
    const off = await bob.run({ kind: 'insert', table: 'issue_followers', rows: [row(false)] }, { retry: false })
    expect(outcome(off, `${issue.id}|${w.bob.profileId}`)).toMatchObject({ ok: true, row: { following: false } })
  })

  test('notes for teammates are sent without asking for them back (E54)', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const note = () => ({ id: ulid(), workspace_id: w.ws, recipient_id: w.bob.profileId, type: 'commented', issue_id: issue.id, comment_id: null, status: null })
    const sent = await postgrest(w.ana.db).run({ kind: 'notes', rows: [note()] }, { retry: false })
    expect(outcome(sent, 'notes')).toEqual({ ok: true })
    const { error } = await w.ana.db.from('inbox').insert(note()).select()
    expect(error?.code).toBe('42501')
    expect(await ok(w.bob.db.from('inbox').select('id').eq('issue_id', issue.id))).toHaveLength(1)
  })

  test("someone else's comment: the change comes back empty, and the probe tells it was refused", async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const id = ulid()
    await ok(w.ana.db.from('comments').insert({ id, workspace_id: w.ws, issue_id: issue.id, body: 'Mine' }))
    const bob = postgrest(w.bob.db)
    const edit = await bob.run({ kind: 'update', table: 'comments', fields: { body: 'hacked' }, keys: [{ id }] }, { retry: false })
    expect(outcome(edit, id)).toEqual({ ok: false, why: 'refused', message: MESSAGES.comment })
    const del = await bob.run({ kind: 'delete', table: 'comments', keys: [{ id }] }, { retry: false })
    expect(outcome(del, id)).toEqual({ ok: false, why: 'refused', message: MESSAGES.comment })
    expect((await ok(w.ana.db.from('comments').select('body').eq('id', id).single())).body).toBe('Mine')
  })

  test('a member deleting a team is refused; deleting what is already gone is fine; editing it is not', async () => {
    const team = await newTeam(w.ana, w.ws, 'WRT')
    const bob = postgrest(w.bob.db)
    const del = await bob.run({ kind: 'delete', table: 'teams', keys: [{ id: team }] }, { retry: false })
    expect(outcome(del, team)).toEqual({ ok: false, why: 'refused', message: MESSAGES.deleteTeam })
    const ana = postgrest(w.ana.db)
    expect(outcome(await ana.run({ kind: 'delete', table: 'teams', keys: [{ id: team }] }, { retry: false }), team)).toMatchObject({ ok: true })
    expect(outcome(await ana.run({ kind: 'delete', table: 'teams', keys: [{ id: team }] }, { retry: true }), team)).toEqual({ ok: true })
    const edit = await ana.run({ kind: 'update', table: 'teams', fields: { name: 'Gone' }, keys: [{ id: team }] }, { retry: false })
    expect(outcome(edit, team)).toEqual({ ok: false, why: 'gone', message: MESSAGES.gone })
  })

  test('the same issue twice: refused the first time, found when it was a retry (a lost answer)', async () => {
    const id = ulid()
    const row = { id, workspace_id: w.ws, team_id: w.eng, title: 'Twice', sort_order: 'a0' }
    const ana = postgrest(w.ana.db)
    const made = await ana.run({ kind: 'insert', table: 'issues', rows: [row] }, { retry: false })
    const number = (outcome(made, id) as unknown as { row: { number: number } }).row.number
    expect(number).toBeGreaterThan(0)
    const { error } = await w.ana.db.from('issues').insert(row)
    expect(error?.code).toBe('23505')
    expect(error?.message).toContain('issues_pkey')
    expect(problem(await ana.run({ kind: 'insert', table: 'issues', rows: [row] }, { retry: false }))?.kind).toBe('refused')
    expect(outcome(await ana.run({ kind: 'insert', table: 'issues', rows: [row] }, { retry: true }), id)).toMatchObject({ ok: true, row: { id, number } })
  })

  test('a label name that is taken is refused with a message', async () => {
    const name = `Dup ${RUN}`
    const ana = postgrest(w.ana.db)
    await ana.run({ kind: 'insert', table: 'labels', rows: [{ id: ulid(), workspace_id: w.ws, name, color: '#000' }] }, { retry: false })
    const again = await ana.run({ kind: 'insert', table: 'labels', rows: [{ id: ulid(), workspace_id: w.ws, name: name.toLowerCase(), color: '#000' }] }, { retry: false })
    expect(problem(again)).toEqual({ kind: 'refused', message: MESSAGES.labelName })
  })

  test('an assignee from outside the workspace is refused in plain words', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const a = await postgrest(w.ana.db).run({ kind: 'update', table: 'issues', fields: { assignee_id: w.cy.profileId }, keys: [{ id: issue.id }] }, { retry: false })
    expect(problem(a)).toEqual({ kind: 'refused', message: "That person isn't in this workspace." })
  })

  test('moving an issue twice to the same team moves it once', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const ana = postgrest(w.ana.db)
    const req = { kind: 'call', fn: 'move_issue_to_team', args: { p_issue: issue.id, p_team: w.des }, key: { id: issue.id } } as const
    const first = outcome(await ana.run(req, { retry: false }), issue.id) as unknown as { row: { number: number; former_refs: string[] } }
    const second = outcome(await ana.run(req, { retry: true }), issue.id) as unknown as { row: { number: number; former_refs: string[] } }
    expect(second.row.number).toBe(first.row.number)
    expect(second.row.former_refs).toEqual([`ENG-${issue.number}`])
    const missing = await ana.run({ ...req, args: { p_issue: ulid(), p_team: w.des } }, { retry: false })
    expect(problem(missing)?.kind).toBe('gone')
  })

  test('several issues archived in one request, with their rows back', async () => {
    const a = await newIssue(w.ana, w.ws, w.eng)
    const b = await newIssue(w.ana, w.ws, w.eng)
    const at = new Date().toISOString()
    const r = await postgrest(w.bob.db).run({ kind: 'update', table: 'issues', fields: { archived_at: at }, keys: [{ id: a.id }, { id: b.id }] }, { retry: false })
    expect(outcome(r, a.id)).toMatchObject({ ok: true, row: { archived_by: w.bob.profileId } })
    expect(outcome(r, b.id)).toMatchObject({ ok: true })
  })

  test('mark all as read writes your read mark', async () => {
    const at = new Date().toISOString()
    const r = await postgrest(w.bob.db).run({ kind: 'insert', table: 'read_state', rows: [{ profile_id: w.bob.profileId, workspace_id: w.ws, read_until: at }] }, { retry: false })
    expect(outcome(r, `${w.bob.profileId}|${w.ws}`)).toMatchObject({ ok: true, row: { profile_id: w.bob.profileId } })
  })

  test('a new workspace comes back as its id', async () => {
    const id = await createWorkspace(`dbtest ${RUN} started`, { key: 'ENG', name: 'Engineering', emoji: '' }, w.dee.db)
    expect(await ok(w.dee.db.from('workspaces').select('id').eq('id', id))).toHaveLength(1)
  })
})
