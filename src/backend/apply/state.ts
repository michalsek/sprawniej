/**
 * What applyRows keeps between calls, and what goes in and out of it.
 *
 * Your own changes show at once, on top of the database's rows. The rules:
 * - `{from:'local'}` adds an insert or an edit to `local` (or a delete to `localGone`). Each row keeps the writes still
 *   on their way, oldest first, and shows the database's row with all of them on top, in that order.
 * - `{from:'settled', ok:true}` takes that one write away (the oldest with the same columns and values): from then on
 *   the database's row, which the write returned or its echo brings, is the truth. A later write of the same column
 *   still shows, and the column stays pending until the last write that sends it is back.
 * - `{from:'settled', ok:false}` undoes it: a failed edit takes its write away, a failed insert takes everything for
 *   that row (edits of a row that was never made mean nothing), a failed delete shows the row again.
 * - Edits show only on top of a row the database has. A row with nothing from the database behind it shows only
 *   while it is your own insert, so an edit to something a teammate deleted disappears with it.
 * - A delete hides the row and drops your edits to it; once it is confirmed the row leaves the copy of the database.
 */
import type { AnyChange } from '../changes'
import type { Registry } from '../registry'
import type { DeletionRow, LiveTable, Message } from '../tables'
import type { Mirror } from './mirror'
import type { DataState } from '@/data/store'

export type StoreSlice = Pick<
  DataState,
  'workspace' | 'me' | 'people' | 'members' | 'labels' | 'teams' | 'issues' | 'archive' | 'projects' | 'views' | 'comments' | 'pullRequests' | 'inbox' | 'readState'
>

type Rec<V> = Readonly<Record<string, V>>

/** a kind of thing in the store made from rows */
export type Kind = 'person' | 'member' | 'team' | 'label' | 'project' | 'issue' | 'view' | 'inbox'
/** one such thing, by the id of its main row */
export interface Ref {
  kind: Kind
  id: string
}

/** your writes to one row that are still on their way */
export interface Pending {
  /** the row is your own insert: it shows even with nothing from the database behind it */
  insert: boolean
  /** the columns each write sends (and what it guesses the database fills in), oldest first */
  writes: readonly Readonly<Record<string, unknown>>[]
}

export interface LiveState {
  server: Mirror
  /** `${table}:${keyString}` → your writes still on their way */
  local: Rec<Pending>
  /** your own deletes not confirmed yet */
  localGone: Rec<true>
  /** deleted rows: `${table}:${keyString}` → the raw time they went ('' when unknown); a row not newer is ignored */
  gone: Rec<string>
  /** rows that came without description or body (too big to send), so the whole row is still to come */
  partial: Rec<true>
  /** a profile or team id we don't know yet → things to work out again once it arrives */
  waiting: Rec<readonly Ref[]>
  /** `${table}:${id}` of profiles and teams asked for and not back yet, so each is asked for once */
  asked: Rec<true>
  /** the highest changed_at or deleted_at seen from the database, raw (where catching up starts) */
  mark: string | null
}

export type Incoming =
  /** select results: whole rows. `keys`: what was asked for, so a key that didn't come back may be asked for again */
  | { from: 'fetch'; table: LiveTable; rows: readonly Record<string, unknown>[]; keys?: readonly Record<string, string>[] }
  | { from: 'message'; message: Message }
  | { from: 'deletions'; rows: readonly DeletionRow[] }
  /** an action's change, shown at once */
  | { from: 'local'; change: AnyChange }
  /** the write worked; `row` is the row as the database has it now (for a delete, the row it removed) */
  | { from: 'settled'; change: AnyChange; ok: true; row?: Record<string, unknown> }
  /** the write failed: the change is undone */
  | { from: 'settled'; change: AnyChange; ok: false }

export interface ApplyContext {
  workspaceId: string
  meId: string | null
  registry: Registry
}

export interface ApplyResult {
  state: LiveState
  /** only the store parts whose object changed; {} when nothing visible changed */
  patch: Partial<StoreSlice>
  /** rows to fetch by key, each once: an update for a row we don't have, a partial row, a missing team or person */
  fetch: { table: LiveTable; key: Record<string, string> }[]
  /** someone imported or linked people: read everything changed since `mark` */
  catchUp: boolean
  /** the open workspace was deleted */
  workspaceGone: boolean
}
