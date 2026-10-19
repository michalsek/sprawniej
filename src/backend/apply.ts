/**
 * Rows from the database to the store. Everything that comes in goes through applyRows: first loads and fetched rows,
 * realtime messages, deletions found on catch-up, and your own changes (shown at once, then confirmed or undone; the
 * rules are in apply/state.ts).
 *
 * Pure: it never changes `state` or `data`. Its one side effect is teaching the registry new ids, which only ever
 * grows. It works in two steps: take.ts takes the inputs into a copy of the database (newer changed_at wins, column
 * by column for updates) and marks what they touch; derive.ts works those things out again for the store.
 */
import type { LiveTable } from './tables'
import { derive } from './apply/derive'
import { emptyMirror } from './apply/mirror'
import { Intake, localKey } from './apply/take'
import type { ApplyContext, ApplyResult, Incoming, LiveState, StoreSlice } from './apply/state'

export type { ApplyContext, ApplyResult, Incoming, LiveState, Pending, Ref, StoreSlice } from './apply/state'
export type { Mirror } from './apply/mirror'

export const emptyLive = (): LiveState => ({
  server: emptyMirror(),
  local: {},
  localGone: {},
  gone: {},
  partial: {},
  waiting: {},
  asked: {},
  mark: null,
})

export function applyRows(state: LiveState, data: StoreSlice, inputs: readonly Incoming[], ctx: ApplyContext): ApplyResult {
  const intake = new Intake(state, ctx)
  for (const input of inputs) intake.take(input)
  const patch = derive(intake, data, intake.dirty, ctx, intake.workspaceGone)
  return { state: intake.state(), patch, fetch: intake.fetch(), catchUp: intake.catchUp, workspaceGone: intake.workspaceGone }
}

/** the columns of a row your own changes are still saving (for the save chip) */
export function pendingFields(state: LiveState, table: LiveTable, key: Readonly<Record<string, unknown>>): string[] {
  const p = state.local[localKey(table, key)]
  return p ? [...new Set(p.writes.flatMap((w) => Object.keys(w)))] : []
}

/** your own delete of this row is still saving */
export const pendingDelete = (state: LiveState, table: LiveTable, key: Readonly<Record<string, unknown>>): boolean =>
  !!state.localGone[localKey(table, key)]
