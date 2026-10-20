import { describe, expect, test } from 'bun:test'
import type { Db } from '@/backend/client'
import { ownWords } from '@/backend/problem'
import { classify, goneMessage, MESSAGES } from '@/backend/writes/problems'
import { parentsOf, plan, type Sendable } from '@/backend/writes/requests'
import { postgrest, type Answer } from '@/backend/writes/send'
import { FakeClock, FakeDb, profileIdOf, teamIdOf, WS } from './support/fakeDb'

type Call = [string, unknown[]]
interface Result {
  data: unknown
  error: { code?: string; message?: string } | null
  status: number
}

/** a pretend database client that writes down each chain of calls and answers what `answer` says */
function recorder(answer: (chain: Call[]) => Partial<Result> = () => ({})) {
  const chains: Call[][] = []
  const builder = (chain: Call[]): unknown =>
    new Proxy(() => {}, {
      get(_, prop) {
        if (prop === 'then') {
          chains.push(chain)
          const r = { data: [], error: null, status: 200, ...answer(chain) }
          return (resolve: (r: Result) => void) => resolve(r)
        }
        // every request gives up after a while; that isn't part of what it asks
        if (prop === 'abortSignal') return () => builder(chain)
        return (...args: unknown[]) => builder([...chain, [String(prop), args]])
      },
    })
  const db = { from: (t: string) => builder([['from', [t]]]), rpc: (fn: string, args: unknown) => builder([['rpc', [fn, args]]]) } as unknown as Db
  return { db, chains }
}

const names = (chain: Call[]) => chain.map(([m]) => m)
const outcome = (a: Answer, ks: string) => ('outcomes' in a ? a.outcomes.get(ks) : undefined)

describe('requests, as sent', () => {
  test('every request gives up after a while', async () => {
    let signals = 0
    const db = { from: () => new Proxy(() => {}, { get: (_, p) => (p === 'then' ? (res: (r: unknown) => void) => res({ data: [], error: null, status: 200 }) : p === 'abortSignal' ? () => (signals++, db.from()) : () => db.from()) }) } as unknown as { from: () => unknown }
    await postgrest(db as unknown as Db).run({ kind: 'delete', table: 'views', keys: [{ id: 'v' }] }, { retry: false })
    expect(signals).toBe(2)
  })

  test('a new issue: insert with database defaults for what is left out, asking for the row back', async () => {
    const r = recorder(() => ({ data: [{ id: 'i1', number: 7 }] }))
    const a = await postgrest(r.db).run({ kind: 'insert', table: 'issues', rows: [{ id: 'i1', title: 'x' }] }, { retry: false })
    expect(r.chains[0]).toEqual([
      ['from', ['issues']],
      ['insert', [[{ id: 'i1', title: 'x' }], { defaultToNull: false }]],
      ['select', []],
    ])
    expect(outcome(a, 'i1')).toEqual({ ok: true, row: { id: 'i1', number: 7 } })
  })

  test('inbox notes: no select (E54)', async () => {
    const r = recorder(() => ({ data: null, status: 201 }))
    const note = { id: 'n1', workspace_id: 'w', recipient_id: 'p', type: 'assigned', issue_id: 'i', comment_id: null, status: null, status_id: null }
    const a = await postgrest(r.db).run({ kind: 'notes', rows: [note] }, { retry: false })
    expect(names(r.chains[0])).toEqual(['from', 'insert'])
    expect(outcome(a, 'notes')).toEqual({ ok: true })
  })

  test('join rows: added unless there; one already there is read back', async () => {
    const r = recorder((c) => (names(c).includes('upsert') ? { data: [] } : { data: [{ issue_id: 'i', label_id: 'l', changed_at: 'x' }] }))
    const a = await postgrest(r.db).run({ kind: 'insert', table: 'issue_labels', rows: [{ workspace_id: 'w', issue_id: 'i', label_id: 'l' }] }, { retry: false })
    expect(r.chains[0][1]).toEqual(['upsert', [[{ workspace_id: 'w', issue_id: 'i', label_id: 'l' }], { onConflict: 'issue_id,label_id', ignoreDuplicates: true, defaultToNull: false }]])
    expect(names(r.chains[0])).toEqual(['from', 'upsert', 'select'])
    expect(r.chains[1]).toEqual([
      ['from', ['issue_labels']],
      ['select', ['*']],
      ['eq', ['issue_id', 'i']],
      ['in', ['label_id', ['l']]],
    ])
    expect(outcome(a, 'i|l')).toMatchObject({ ok: true, row: { label_id: 'l' } })
  })

  test('a follower there the other way round is changed', async () => {
    const r = recorder((c) => (names(c).includes('upsert') ? { data: [] } : { data: [{ issue_id: 'i', profile_id: 'p', following: false }] }))
    const a = await postgrest(r.db).run({ kind: 'insert', table: 'issue_followers', rows: [{ workspace_id: 'w', issue_id: 'i', profile_id: 'p', following: false }] }, { retry: false })
    expect(r.chains[1]).toEqual([
      ['from', ['issue_followers']],
      ['update', [{ following: false }]],
      ['eq', ['issue_id', 'i']],
      ['eq', ['profile_id', 'p']],
      ['select', []],
    ])
    expect(outcome(a, 'i|p')).toMatchObject({ ok: true, row: { following: false } })
  })

  test('read marks: an upsert on the person and workspace', async () => {
    const r = recorder(() => ({ data: [{ profile_id: 'p', workspace_id: 'w' }] }))
    await postgrest(r.db).run({ kind: 'insert', table: 'read_state', rows: [{ profile_id: 'p', workspace_id: 'w', read_until: 't' }] }, { retry: false })
    expect(r.chains[0][1]).toEqual(['upsert', [[{ profile_id: 'p', workspace_id: 'w', read_until: 't' }], { onConflict: 'profile_id,workspace_id', defaultToNull: false }]])
  })

  test('an update of several rows: one request; a row that did not come back is looked up', async () => {
    const r = recorder((c) => (names(c).includes('update') ? { data: [{ id: 'a' }] } : { data: [{ id: 'b' }] }))
    const a = await postgrest(r.db).run({ kind: 'update', table: 'comments', fields: { body: 'x' }, keys: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, { retry: false })
    expect(r.chains[0]).toEqual([
      ['from', ['comments']],
      ['update', [{ body: 'x' }]],
      ['in', ['id', ['a', 'b', 'c']]],
      ['select', ['*']],
    ])
    expect(r.chains[1]).toEqual([
      ['from', ['comments']],
      ['select', ['id']],
      ['in', ['id', ['b', 'c']]],
    ])
    expect(outcome(a, 'a')).toEqual({ ok: true, row: { id: 'a' } })
    expect(outcome(a, 'b')).toEqual({ ok: false, why: 'refused', message: MESSAGES.comment })
    expect(outcome(a, 'c')).toEqual({ ok: false, why: 'gone', message: MESSAGES.goneEditedComment })
  })

  test('a delete: refused when it is still there, fine when it is gone', async () => {
    const r = recorder((c) => (names(c).includes('delete') ? { data: [] } : { data: [{ id: 't1' }] }))
    const a = await postgrest(r.db).run({ kind: 'delete', table: 'teams', keys: [{ id: 't1' }, { id: 't2' }] }, { retry: false })
    expect(r.chains[0]).toEqual([
      ['from', ['teams']],
      ['delete', []],
      ['in', ['id', ['t1', 't2']]],
      ['select', ['id,changed_at']],
    ])
    expect(outcome(a, 't1')).toEqual({ ok: false, why: 'refused', message: MESSAGES.deleteTeam })
    expect(outcome(a, 't2')).toEqual({ ok: true })
  })

  test('a move: the database function, with the row it returns', async () => {
    const r = recorder(() => ({ data: { id: 'i', number: 3 } }))
    const a = await postgrest(r.db).run({ kind: 'call', fn: 'move_issue_to_team', args: { p_issue: 'i', p_team: 't' }, key: { id: 'i' } }, { retry: false })
    expect(r.chains[0]).toEqual([['rpc', ['move_issue_to_team', { p_issue: 'i', p_team: 't' }]]])
    expect(outcome(a, 'i')).toEqual({ ok: true, row: { id: 'i', number: 3 } })
  })

  test('trying again a request where only some rows landed: those are read back, the rest sent again', async () => {
    const db = new FakeDb(() => profileIdOf('ana'), new FakeClock())
    db.put('workspace_members', { workspace_id: WS, profile_id: profileIdOf('ana'), role: 'owner' })
    db.put('teams', { id: teamIdOf('ENG'), workspace_id: WS, key: 'ENG', name: 'Eng', last_number: 0 })
    db.put('statuses', { id: 'status-todo', workspace_id: WS, kind: 'issue', category: 'todo', name: 'Todo', color: '#c4c6cc', position: 'a0', hidden: false })
    const row = (id: string) => ({ id, workspace_id: WS, team_id: teamIdOf('ENG'), title: id, sort_order: 'a0' })
    const t = postgrest(db.client())
    await t.run({ kind: 'insert', table: 'issues', rows: [row('A')] }, { retry: false })
    const a = await t.run({ kind: 'insert', table: 'issues', rows: [row('A'), row('B')] }, { retry: true })
    expect(outcome(a, 'A')).toMatchObject({ ok: true, row: { id: 'A', number: 1 } })
    expect(outcome(a, 'B')).toMatchObject({ ok: true, row: { id: 'B', number: 2 } })
    expect(db.rows('issues')).toHaveLength(2)
  })

  test('inbox notes tried again after a lost answer: one by one, so the ones that never landed still go', async () => {
    const db = new FakeDb(() => profileIdOf('ana'), new FakeClock())
    for (const l of ['ana', 'bob']) db.put('workspace_members', { workspace_id: WS, profile_id: profileIdOf(l), role: 'member' })
    for (const l of ['ana', 'bob']) db.put('profiles', { id: profileIdOf(l), login: l })
    db.put('teams', { id: teamIdOf('ENG'), workspace_id: WS, key: 'ENG', name: 'Eng', last_number: 0 })
    db.put('issues', { id: 'I', workspace_id: WS, team_id: teamIdOf('ENG'), number: 1, title: 'x' })
    const note = (id: string, type: string) => ({ id, workspace_id: WS, recipient_id: profileIdOf('bob'), type, issue_id: 'I', comment_id: null, status: null, status_id: null })
    const t = postgrest(db.client())
    await t.run({ kind: 'notes', rows: [note('n1', 'assigned')] }, { retry: false })
    const again = await t.run({ kind: 'notes', rows: [note('n1', 'assigned'), note('n2', 'mentioned')] }, { retry: true })
    expect(outcome(again, 'notes')).toEqual({ ok: true })
    expect(db.notesFor('bob').map((n) => n.id).sort()).toEqual(['n1', 'n2'])
  })

  test('the same new row again, when trying again: it landed, so it is read back', async () => {
    const dup = { code: '23505', message: 'duplicate key value violates unique constraint "issues_pkey"' }
    const r = recorder((c) => (names(c).includes('insert') ? { data: null, error: dup, status: 409 } : { data: [{ id: 'i1', number: 4 }] }))
    const again = await postgrest(r.db).run({ kind: 'insert', table: 'issues', rows: [{ id: 'i1' }] }, { retry: true })
    expect(outcome(again, 'i1')).toEqual({ ok: true, row: { id: 'i1', number: 4 } })
    const first = await postgrest(r.db).run({ kind: 'insert', table: 'issues', rows: [{ id: 'i1' }] }, { retry: false })
    expect('problem' in first && first.problem.kind).toBe('refused')
  })
})

describe('what an answer means', () => {
  const what = { table: 'issues', op: 'update' } as const
  const k = (code: string, message = '', status = 400) => classify({ code, message }, status, what)

  test('no answer, a busy moment or a broken connection: try again', () => {
    expect(classify({ code: '', message: 'TypeError: Failed to fetch' }, 0, what).kind).toBe('network')
    expect(classify({ name: 'AbortError', message: 'aborted' }, 0, what).kind).toBe('network')
    for (const s of [408, 425, 429, 500, 502, 503, 504, 520, 524]) expect(classify({ message: 'x' }, s, what).kind).toBe('network')
    expect(k('PGRST000', '', 503).kind).toBe('network')
    expect(k('57014', 'canceling statement due to statement timeout', 500).kind).toBe('network')
    expect(k('40001', '', 500).kind).toBe('network')
  })

  test('the sign-in ran out', () => {
    expect(classify({ message: 'JWT expired' }, 401, what).kind).toBe('auth')
    expect(k('PGRST301', 'JWT expired', 401).kind).toBe('auth')
  })

  test('gone, named for what went', () => {
    const fk = (col: string, table = 'issue_labels') => `insert or update on table "${table}" violates foreign key constraint "${table}_workspace_id_${col}_fkey"`
    expect(classify({ code: '23503', message: fk('label_id') }, 409, { table: 'issue_labels', op: 'insert' }).message).toBe(MESSAGES.goneLabelAdded)
    expect(classify({ code: '23503', message: fk('issue_id') }, 409, { table: 'issue_labels', op: 'insert' }).message).toBe(MESSAGES.goneIssue)
    expect(classify({ code: '23503', message: fk('project_id', 'issues') }, 409, { table: 'issues', op: 'update' }).message).toBe(MESSAGES.goneProject)
    expect(classify({ code: '23503', message: 'There is no such team.' }, 409, { table: 'issues', op: 'insert' }).message).toBe(MESSAGES.goneTeam)
    expect(k('P0002', 'There is no such issue.', 500)).toEqual({ kind: 'gone', message: MESSAGES.goneIssue })
    expect(classify({ code: '23503', message: fk('issue_id', 'comments') }, 409, { table: 'comments', op: 'insert' }).message).toBe(MESSAGES.goneComment)
    expect(goneMessage({ table: 'comments', op: 'update' })).toBe(MESSAGES.goneEditedComment)
    expect(goneMessage({ table: 'views', op: 'update' })).toBe(MESSAGES.goneView)
    expect(goneMessage({ table: 'read_state', op: 'update' })).toBe(MESSAGES.gone)
  })

  test('refused, in our words or the database’s own when they read as a sentence', () => {
    expect(k('23505', 'duplicate key value violates unique constraint "labels_name"', 409)).toEqual({ kind: 'refused', message: MESSAGES.labelName })
    expect(k('23505', 'duplicate key value violates unique constraint "teams_workspace_id_key_key"', 409)).toEqual({ kind: 'refused', message: MESSAGES.teamKey })
    expect(k('42501', "That person isn't in this workspace.", 403)).toEqual({ kind: 'refused', message: "That person isn't in this workspace." })
    expect(k('42501', 'new row violates row-level security policy for table "issues"', 403)).toEqual({ kind: 'refused', message: MESSAGES.refused })
    expect(k('23514', 'new row for relation "issues" violates check constraint "issues_number_check"')).toEqual({ kind: 'refused', message: MESSAGES.notSaved })
    expect(k('23505', 'Number 3 is already used in this team.', 409)).toEqual({ kind: 'refused', message: 'Number 3 is already used in this team.' })
    expect(k('22P02', 'invalid input syntax for type uuid: "x"').kind).toBe('refused')
    expect(k('SP001', 'This invite has expired.').message).toBe('This invite has expired.')
    expect(k('P0001', 'Nope.').kind).toBe('refused')
  })

  test("the database's own words, only when they read as a sentence", () => {
    expect(ownWords("That person isn't in this workspace.")).toBe("That person isn't in this workspace.")
    expect(ownWords('duplicate key value violates unique constraint "x"')).toBeUndefined()
    expect(ownWords('Use "this" instead.')).toBeUndefined()
    expect(ownWords('')).toBeUndefined()
  })

  test('anything else is a mistake of ours', () => {
    expect(k('PGRST204', "Could not find the 'x' column")).toEqual({ kind: 'bug', message: MESSAGES.bug })
    expect(k('XX000', 'internal error', 500).kind).toBe('bug')
  })

  test('no message says database, server, row or sync', () => {
    for (const m of Object.values(MESSAGES)) expect(m).not.toMatch(/database|server|\brows?\b|sync|commit|push|pull|merge|repo|token|supabase/i)
  })
})

describe('which changes wait, and which go together', () => {
  const s = (seq: number, more: Partial<Sendable>): Sendable => ({ seq, table: 'issues', key: { id: `i${seq}` }, op: 'update', fields: {}, tries: 0, ...more })

  test('a row points at the rows it needs first', () => {
    expect(parentsOf({ table: 'issue_labels', key: { issue_id: 'i', label_id: 'l' }, fields: {} })).toEqual(['issues:i', 'labels:l'])
    expect(parentsOf({ table: 'issues', key: { id: 'i' }, fields: { team_id: 't', project_id: 'p', parent_id: null } })).toEqual(['teams:t', 'projects:p'])
    expect(parentsOf({ table: 'issues', key: { id: 'i' }, fields: {}, call: { fn: 'move_issue_to_team', args: { p_issue: 'i', p_team: 't2' } } })).toEqual(['teams:t2'])
  })

  test('the same update of many rows is one request; different ones are not; a move goes on its own', () => {
    const out = plan([
      s(1, { fields: { archived_at: 'x' } }),
      s(2, { fields: { archived_at: 'x' } }),
      s(3, { fields: { title: 'y' } }),
      s(4, { op: 'call', call: { fn: 'move_issue_to_team', args: { p_issue: 'i4', p_team: 't' } } }),
      s(5, { table: 'issue_followers', key: { issue_id: 'i', profile_id: 'p' }, fields: { following: true } }),
      s(6, { table: 'issue_followers', key: { issue_id: 'i', profile_id: 'q' }, fields: { following: true } }),
    ])
    expect(out.map((o) => o.items.map((i) => i.seq))).toEqual([[1, 2], [3], [4], [5], [6]])
    expect(out[0].req).toEqual({ kind: 'update', table: 'issues', fields: { archived_at: 'x' }, keys: [{ id: 'i1' }, { id: 'i2' }] })
  })

  test('an insert or notes tried before never go with new ones (they may have landed, and fail the request)', () => {
    const out = plan([s(1, { op: 'insert', tries: 1 }), s(2, { op: 'insert' }), s(3, { op: 'insert', tries: 2 }), s(4, { op: 'notes', notes: [], tries: 1 }), s(5, { op: 'notes', notes: [] })])
    expect(out.map((o) => o.items.map((i) => i.seq))).toEqual([[1, 3], [2], [4], [5]])
  })

  test('inserts into one table together, a hundred at most; one batch’s notes stay together', () => {
    const many = Array.from({ length: 150 }, (_, n) => s(n + 1, { op: 'insert', table: 'issue_labels', key: { issue_id: 'i', label_id: `l${n}` }, fields: { workspace_id: 'w' } }))
    expect(plan(many).map((o) => o.items.length)).toEqual([100, 50])
    const note = { id: 'n', workspace_id: 'w', recipient_id: 'p', type: 'assigned', issue_id: 'i', comment_id: null, status: null, status_id: null }
    const notes = plan([s(1, { op: 'notes', notes: Array(60).fill(note) }), s(2, { op: 'notes', notes: Array(60).fill(note) })])
    expect(notes.map((o) => (o.req.kind === 'notes' ? o.req.rows.length : 0))).toEqual([60, 60])
  })
})
