/**
 * What to say when the database refuses something. Its own functions raise errors in plain words with a code
 * (supabase/migrations/20261019000006_functions.sql); those are shown as they are. Anything else (a rule that says
 * no, a broken connection) gets words of ours.
 */
const WORDED = new Set(['SP001', 'SP002', 'SP003', 'SP010', '42501', '22023', '23505', '23503', '23514', 'P0002'])
/** the database's own wording and inner names (private.wiring, table names), never shown */
export const TECHNICAL = /violates|permission denied|constraint|relation|column|syntax|function|row-level|private\.|public\.|wiring|\btable\b|jsonb?\b|uuid/i

/** the one wording for "no connection" */
export const UNREACHABLE = "Can't reach Sprawniej. Check your internet connection and try again."

/** no answer at all (offline, blocked): the browser calls it a TypeError, the database client a fetch error */
export function isUnreachable(e: unknown): boolean {
  const err = (e ?? {}) as { name?: unknown; message?: unknown; status?: unknown }
  const message = typeof err.message === 'string' ? err.message : ''
  return e instanceof TypeError || err.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed/i.test(message)
}

export function friendlyDbError(e: unknown, fallback: string): string {
  const err = (e ?? {}) as { code?: unknown; message?: unknown }
  const message = typeof err.message === 'string' ? err.message : ''
  if (isUnreachable(e)) return UNREACHABLE
  if (typeof err.code === 'string' && WORDED.has(err.code) && message && !TECHNICAL.test(message)) return message
  if (err.code === '42501') return "You aren't allowed to do that here."
  return fallback
}
