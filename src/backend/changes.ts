/**
 * One change to one row, as an action makes it. The app shows it at once (apply.ts, `local`) and sends it to the
 * database (phase 5, writes.ts).
 */
import { KEYS, type Insert, type KeyOf, type LiveTable, type Row } from './tables'

export type Op = 'insert' | 'update' | 'delete'

export interface Change<N extends LiveTable = LiveTable> {
  table: N
  op: Op
  key: KeyOf<N>
  /** sent to the database: insert = the new row (only columns people may write); update = only changed columns; delete = {} */
  fields: Partial<Insert<N>>
  /**
   * shown at once, never sent: what the database fills in (issues.number, created_at, created_by, updated_at…).
   * Kept apart so writes.ts never sends a column only the database may set.
   */
  guess?: Partial<Row<N>>
}
export type AnyChange = { [N in LiveTable]: Change<N> }[LiveTable]

/** the key columns joined with "|", in KEYS order: "01J…" or "<issue id>|<label id>" */
export const keyString = (table: LiveTable, key: Readonly<Record<string, unknown>>): string =>
  KEYS[table].map((k) => String(key[k])).join('|')

/** the key columns of a row, or undefined when one is missing */
export function keyOf<N extends LiveTable>(table: N, row: Readonly<Record<string, unknown>>): KeyOf<N> | undefined {
  const key: Record<string, string> = {}
  for (const k of KEYS[table]) {
    const v = row[k]
    if (typeof v !== 'string' || !v) return undefined
    key[k] = v
  }
  return key as KeyOf<N>
}

/** the other way round from keyString (ids never hold a "|") */
export function parseKey<N extends LiveTable>(table: N, ks: string): KeyOf<N> {
  const parts = ks.split('|')
  return Object.fromEntries(KEYS[table].map((k, n) => [k, parts[n]])) as KeyOf<N>
}
