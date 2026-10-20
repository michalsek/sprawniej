/**
 * Which saved changes wait for which (a row waits for the rows it points at to be made first), and how the changes
 * ready to go are put into as few requests as possible. Pure, so the writer's tests can check it.
 */
import { keyString, type Call } from '../changes'
import { KEYS, type LiveTable } from '../tables'
import type { NoteRow, Request } from './send'

type Loose = Readonly<Record<string, unknown>>

/** the columns that point at another row a person may make in the same moment: [column, its table] */
export const PARENTS: Partial<Record<LiveTable, readonly (readonly [string, LiveTable])[]>> = {
  team_members: [['team_id', 'teams']],
  project_teams: [
    ['project_id', 'projects'],
    ['team_id', 'teams'],
  ],
  issues: [
    ['team_id', 'teams'],
    ['status_id', 'statuses'],
    ['project_id', 'projects'],
    ['parent_id', 'issues'],
    ['duplicate_of', 'issues'],
  ],
  issue_labels: [
    ['issue_id', 'issues'],
    ['label_id', 'labels'],
  ],
  issue_followers: [['issue_id', 'issues']],
  comments: [['issue_id', 'issues']],
  views: [['team_id', 'teams']],
  // a favourite is a project or a view: only the one being made holds it
  favourites: [
    ['item_id', 'projects'],
    ['item_id', 'views'],
  ],
}

/** one row's waiting work, as far as making requests goes */
export interface Sendable {
  seq: number
  table: LiveTable
  key: Record<string, string>
  op: 'insert' | 'update' | 'delete' | 'call' | 'notes'
  fields: Loose
  call?: Call
  notes?: NoteRow[]
  /** notes that go on their own (a request with others' notes failed) */
  solo?: boolean
  /** sent before without an answer: it may have landed, so it never shares a request with new rows */
  tries: number
}

/** the rows it points at, as `${table}:${keyString}` (a move waits for the team it moves to) */
export function parentsOf(s: Pick<Sendable, 'table' | 'key' | 'fields' | 'call'>): string[] {
  const out: string[] = []
  for (const [col, table] of PARENTS[s.table] ?? []) {
    const v = s.fields[col] ?? s.key[col]
    if (typeof v === 'string' && v) out.push(`${table}:${v}`)
  }
  if (s.call) out.push(`teams:${s.call.args.p_team}`)
  return out
}

/** rows, keys or ids per request, so the address and the body stay small */
export const PER_REQUEST = 100

/** the same plain value, whatever the key order */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

function chunks<T>(list: readonly T[], size = PER_REQUEST): T[][] {
  const out: T[][] = []
  for (let n = 0; n < list.length; n += size) out.push(list.slice(n, n + size))
  return out
}

/**
 * The requests for these changes (each the first of its row, and ready): inserts into one table together, the same
 * update of many rows together (archiving three issues), deletes of one table together, and every move on its own.
 * Inserts and notes tried before go together only with others tried before: a row that may have landed makes its
 * request fail as a whole ("already there"), and new rows must not go down with it. Oldest first.
 */
export function plan<S extends Sendable>(ready: readonly S[]): { req: Request; items: S[] }[] {
  const groups = new Map<string, S[]>()
  const add = (id: string, s: S) => {
    const g = groups.get(id)
    if (g) g.push(s)
    else groups.set(id, [s])
  }
  for (const s of ready) {
    const again = s.tries > 0 ? ':again' : ''
    if (s.op === 'notes') add(s.solo ? `notes:${s.seq}` : `notes${again}`, s)
    else if (s.op === 'call') add(`call:${s.seq}`, s)
    else if (s.op === 'insert') add(`insert:${s.table}${again}`, s)
    else if (s.op === 'update') add(KEYS[s.table].length === 1 ? `update:${s.table}:${stable(s.fields)}` : `update:${s.table}:${s.seq}`, s)
    else add(`${s.op}:${s.table}`, s)
  }
  const out: { req: Request; items: S[] }[] = []
  for (const items of groups.values()) {
    const first = items[0]
    if (first.op === 'notes') {
      // an item's notes stay together
      let batch: S[] = []
      let count = 0
      const push = () => batch.length && out.push({ req: { kind: 'notes', rows: batch.flatMap((s) => s.notes ?? []) }, items: batch })
      for (const s of items) {
        const n = s.notes?.length ?? 0
        if (batch.length && count + n > PER_REQUEST) {
          push()
          batch = []
          count = 0
        }
        batch.push(s)
        count += n
      }
      push()
      continue
    }
    for (const part of chunks(items)) {
      const s = part[0]
      if (s.op === 'call' && s.call) out.push({ req: { kind: 'call', fn: s.call.fn, args: s.call.args, key: { id: s.key.id } }, items: part })
      else if (s.op === 'insert') out.push({ req: { kind: 'insert', table: s.table, rows: part.map((p) => ({ ...p.fields, ...p.key })) }, items: part })
      else if (s.op === 'update') out.push({ req: { kind: 'update', table: s.table, fields: { ...s.fields }, keys: part.map((p) => p.key) }, items: part })
      else if (s.op === 'delete') out.push({ req: { kind: 'delete', table: s.table, keys: part.map((p) => p.key) }, items: part })
    }
  }
  return out.sort((a, b) => Math.min(...a.items.map((s) => s.seq)) - Math.min(...b.items.map((s) => s.seq)))
}

/** how an answer names this item's row */
export const answerKey = (s: Pick<Sendable, 'table' | 'key' | 'op'>): string => (s.op === 'notes' ? 'notes' : keyString(s.table, s.key))
