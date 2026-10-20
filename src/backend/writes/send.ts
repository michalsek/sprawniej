/**
 * Sending one request of saved changes to the database, and reading its answer per row. Never throws: every way it
 * can go wrong comes back as a Problem (problems.ts).
 *
 * Two things the rules do that shape it (docs/supabase-work.md, phase 5):
 * - An update or delete the rules refuse is not an error: it simply changes nothing and comes back empty. So every
 *   update and delete asks for its rows back, and a row that didn't come back is looked up (a probe): still there
 *   means refused, gone means someone deleted it.
 * - Join tables (an issue's labels, a team's members…) may only be added to, never changed, so "add unless it's
 *   there" is ON CONFLICT DO NOTHING (ignoreDuplicates), which needs only the right to add.
 * Inbox notes for teammates never ask for rows back: you can't read other people's notes (E54).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { keyString } from '../changes'
import type { Db } from '../client'
import { isUnreachable } from '../problem'
import { KEYS, type LiveTable } from '../tables'
import { classify, constraintOf, goneMessage, MESSAGES, refusedMessage, type ErrorLike, type Problem, type What } from './problems'

type Loose = Record<string, unknown>

/** an inbox note for a teammate */
export interface NoteRow {
  id: string
  workspace_id: string
  recipient_id: string
  type: string
  issue_id: string
  comment_id: string | null
  /** the new status's category, for older versions */
  status: string | null
  /** the new status (status notes) */
  status_id: string | null
}

export type Request =
  | { kind: 'insert'; table: LiveTable; rows: Loose[] }
  | { kind: 'update'; table: LiveTable; fields: Loose; keys: Record<string, string>[] }
  | { kind: 'delete'; table: LiveTable; keys: Record<string, string>[] }
  | { kind: 'call'; fn: 'move_issue_to_team'; args: { p_issue: string; p_team: string }; key: { id: string } }
  | { kind: 'notes'; rows: NoteRow[] }

/** how one row did; `row` is the row as the database has it now (a delete: the keys and changed_at it had) */
export type Outcome = { ok: true; row?: Loose } | { ok: false; why: 'refused' | 'gone'; message: string }
/** a problem for the whole request, or an outcome per row (by keyString; notes: 'notes') */
export type Answer = { problem: Problem } | { outcomes: Map<string, Outcome> }

export interface Transport {
  /** `retry`: this was sent before and may have landed, only its answer lost */
  run(req: Request, opts: { retry: boolean }): Promise<Answer>
}

/** join tables: added unless already there */
export const ADD_UNLESS_THERE: ReadonlySet<LiveTable> = new Set(['issue_labels', 'team_members', 'project_teams', 'issue_followers'])

export const whatOf = (req: Request): What => ({ table: req.kind === 'notes' ? 'inbox' : req.kind === 'call' ? 'issues' : req.table, op: req.kind })

/** keys grouped by every key column but the last, so each group is one `eq…in` filter */
function byFirst(table: LiveTable, keys: readonly Record<string, string>[]): { eq: Record<string, string>; col: string; values: string[] }[] {
  const cols = KEYS[table]
  const last = cols[cols.length - 1]
  const groups = new Map<string, { eq: Record<string, string>; col: string; values: string[] }>()
  for (const key of keys) {
    const eq = Object.fromEntries(cols.slice(0, -1).map((c) => [c, key[c]]))
    const id = JSON.stringify(eq)
    const g = groups.get(id) ?? { eq, col: last, values: [] }
    g.values.push(key[last])
    groups.set(id, g)
  }
  return [...groups.values()]
}

interface Result {
  data: unknown
  error: ErrorLike | null
  status: number
}

/** a request being built on a table picked at run time (one row type per table can't be named here) */
interface Built extends PromiseLike<Result> {
  eq(col: string, value: string): Built
  in(col: string, values: string[]): Built
  select(cols?: string): Built
  abortSignal(signal: AbortSignal): Built
}

/** a request with no answer by then is given up on and tried again (a connection that died quietly would wait forever) */
export const TIMEOUT = 30_000
const timed = (q: Built): Built => q.abortSignal(AbortSignal.timeout(TIMEOUT))

/** the same row sent again: it landed the first time, only the answer was lost */
const landedBefore = (error: ErrorLike, table: string) => error.code === '23505' && constraintOf(error.message) === `${table}_pkey`

export function postgrest(db: Db): Transport {
  const from = (t: string) => (db as unknown as SupabaseClient).from(t) as unknown as Built & {
    insert(rows: Loose[], o: object): Built
    upsert(rows: Loose[], o: object): Built
    update(fields: Loose): Built
    delete(): Built
  }

  /** where every key column matches, for one group of keys */
  const filtered = (q: Built, g: ReturnType<typeof byFirst>[number]): Built => {
    let r = q
    for (const [c, v] of Object.entries(g.eq)) r = r.eq(c, v)
    return r.in(g.col, g.values)
  }

  const isProblem = <T>(x: T | Problem): x is Problem => !(x instanceof Map)
  const rowsOf = (table: LiveTable, data: unknown, into = new Map<string, Loose>()) => {
    for (const row of (data ?? []) as Loose[]) into.set(keyString(table, row), row)
    return into
  }
  const keysOf = (table: LiveTable, rows: readonly Loose[]) => rows.map((r) => Object.fromEntries(KEYS[table].map((k) => [k, String(r[k])])))

  /** the rows that are there, of these keys (one request per group); a problem if a request failed */
  async function lookUp(table: LiveTable, keys: readonly Record<string, string>[], what: What, cols = '*'): Promise<Map<string, Loose> | Problem> {
    const found = new Map<string, Loose>()
    for (const g of byFirst(table, keys)) {
      const r = await timed(filtered(from(table).select(cols), g))
      if (r.error) return classify(r.error, r.status, what)
      rowsOf(table, r.data, found)
    }
    return found
  }

  /** every key: ok with its row when it came back; `missing` decides the rest */
  function outcomes(table: LiveTable, keys: readonly Record<string, string>[], rows: Map<string, Loose>, missing: (ks: string) => Outcome): Map<string, Outcome> {
    const out = new Map<string, Outcome>()
    for (const key of keys) {
      const ks = keyString(table, key)
      const row = rows.get(ks)
      out.set(ks, row ? { ok: true, row } : missing(ks))
    }
    return out
  }
  const fine = (): Outcome => ({ ok: true })

  async function insert(table: LiveTable, rows: Loose[], retry: boolean): Promise<Answer> {
    const what: What = { table, op: 'insert' }
    const keys = keysOf(table, rows)
    if (table === 'read_state') {
      const r = await timed(from(table).upsert(rows, { onConflict: 'profile_id,workspace_id', defaultToNull: false }).select())
      if (r.error) return { problem: classify(r.error, r.status, what) }
      return { outcomes: outcomes(table, keys, rowsOf(table, r.data), fine) }
    }
    if (ADD_UNLESS_THERE.has(table)) {
      const r = await timed(from(table).upsert(rows, { onConflict: KEYS[table].join(','), ignoreDuplicates: true, defaultToNull: false }).select())
      if (r.error) return { problem: classify(r.error, r.status, what) }
      const got = rowsOf(table, r.data)
      const missing = keys.filter((k) => !got.has(keyString(table, k)))
      if (!missing.length) return { outcomes: outcomes(table, keys, got, fine) }
      // already there. A follower may be there the other way round (unsubscribed): that one is changed
      if (table === 'issue_followers') {
        for (const key of missing) {
          const following = rows.find((r) => keyString(table, r) === keyString(table, key))?.following
          const u = await timed(from(table).update({ following }).eq('issue_id', key.issue_id).eq('profile_id', key.profile_id).select())
          if (u.error) return { problem: classify(u.error, u.status, what) }
          rowsOf(table, u.data, got)
        }
      } else {
        const there = await lookUp(table, missing, what)
        if (isProblem(there)) return { problem: there }
        for (const [ks, row] of there) got.set(ks, row)
      }
      return { outcomes: outcomes(table, keys, got, fine) }
    }
    const r = await timed(from(table).insert(rows, { defaultToNull: false }).select())
    if (!r.error) return { outcomes: outcomes(table, keys, rowsOf(table, r.data), fine) }
    if (!retry || !landedBefore(r.error, table)) return { problem: classify(r.error, r.status, what) }
    // sent before: what landed then is read back, and anything that didn't is sent again
    const there = await lookUp(table, keys, what)
    if (isProblem(there)) return { problem: there }
    const rest = rows.filter((row) => !there.has(keyString(table, row)))
    if (!rest.length) return { outcomes: outcomes(table, keys, there, fine) }
    const again = await insert(table, rest, false)
    if ('problem' in again) return again
    return { outcomes: new Map([...outcomes(table, keys, there, fine), ...again.outcomes]) }
  }

  /** rows that didn't come back from an update or delete: still there means refused, else gone */
  async function probe(table: LiveTable, missing: Record<string, string>[], what: What): Promise<Map<string, Outcome> | Problem> {
    const there = await lookUp(table, missing, what, KEYS[table].join(','))
    if (isProblem(there)) return there
    const out = new Map<string, Outcome>()
    for (const key of missing) {
      const ks = keyString(table, key)
      if (there.has(ks)) out.set(ks, { ok: false, why: 'refused', message: refusedMessage(what) })
      // a delete of something already gone did what it was meant to
      else out.set(ks, what.op === 'delete' ? { ok: true } : { ok: false, why: 'gone', message: goneMessage(what) })
    }
    return out
  }

  async function change(req: Extract<Request, { kind: 'update' | 'delete' }>): Promise<Answer> {
    const { table, keys } = req
    const what: What = { table, op: req.kind }
    const got = new Map<string, Loose>()
    const back = req.kind === 'delete' ? `${KEYS[table].join(',')},changed_at` : '*'
    for (const g of byFirst(table, keys)) {
      const q = req.kind === 'update' ? from(table).update(req.fields) : from(table).delete()
      const r = await timed(filtered(q, g).select(back))
      if (r.error) return { problem: classify(r.error, r.status, what) }
      rowsOf(table, r.data, got)
    }
    const missing = keys.filter((k) => !got.has(keyString(table, k)))
    const probed = missing.length ? await probe(table, missing, what) : new Map<string, Outcome>()
    if (isProblem(probed)) return { problem: probed }
    return { outcomes: outcomes(table, keys, got, (ks) => probed.get(ks) ?? { ok: true }) }
  }

  /** inbox notes; tried again after a lost answer, one by one, since the ones that landed can't be read back */
  async function notes(rows: NoteRow[], retry: boolean): Promise<Answer> {
    const what: What = { table: 'inbox', op: 'notes' }
    const r = await timed(from('inbox').insert(rows as unknown as Loose[], { defaultToNull: false }))
    if (!r.error) return { outcomes: new Map([['notes', fine()]]) }
    if (!retry || !landedBefore(r.error, 'inbox')) return { problem: classify(r.error, r.status, what) }
    if (rows.length > 1) {
      for (const row of rows) {
        const one = await notes([row], true)
        if ('problem' in one) return one
      }
    }
    return { outcomes: new Map([['notes', fine()]]) }
  }

  async function runOnce(req: Request, retry: boolean): Promise<Answer> {
    switch (req.kind) {
      case 'insert':
        return insert(req.table, req.rows, retry)
      case 'update':
      case 'delete':
        return change(req)
      case 'call': {
        const r = await timed(db.rpc(req.fn, req.args) as unknown as Built)
        if (r.error) return { problem: classify(r.error, r.status, whatOf(req)) }
        return { outcomes: new Map([[req.key.id, { ok: true, row: r.data as Loose }]]) }
      }
      case 'notes':
        return notes(req.rows, retry)
    }
  }

  return {
    async run(req, { retry }) {
      try {
        return await runOnce(req, retry)
      } catch (e) {
        const name = (e as { name?: unknown } | null)?.name
        if (isUnreachable(e) || name === 'AbortError' || name === 'TimeoutError') return { problem: { kind: 'network', message: '' } }
        console.error('Sprawniej couldn’t save a change', e)
        return { problem: { kind: 'bug', message: MESSAGES.bug } }
      }
    },
  }
}
