/**
 * Loads an issue's history (src/data/history.ts) when its page opens, and again whenever the issue changes: your own
 * changes once they're saved, and teammates' as they arrive. Only events newer than the ones already here are asked
 * for, except after catching up with teammates' changes: then it's read from the start, since a person linked to an
 * account meanwhile has their events moved over. Kept per issue while the workspace is open, so going back to an
 * issue shows its history at once.
 */
import { useEffect, useMemo, useState } from 'react'
import { backend, onForget, useBackend } from '@/backend'
import { registry } from '@/backend/registry'
import { useSaveStatus } from '@/backend/status'
import { historySignature, issueEvents, mergeFetched, type Fetched, type HistoryEvent } from '@/data/history'
import { useData } from '@/data/store'
import type { ArchivedIssue, Issue } from '@/model/schema'

/** `${workspace id}:${issue id}` → what was read; `caughtUp`: the catch-up it was read after */
const cache = new Map<string, Fetched & { caughtUp?: number }>()
onForget(() => cache.clear())

/** asks are numbered, so an answer that arrives after a newer one's doesn't undo it */
let asks = 0

/** changes coming one after another (typing) are asked about once, this long after the last */
const SETTLE = 1200

export function useIssueHistory(issue: Issue | ArchivedIssue): { events: HistoryEvent[] | null; failed: boolean } {
  const ws = useBackend((s) => (s.phase === 'open' ? s.workspaceId : undefined))
  // nothing of yours is still on its way: the events for your changes are there to read
  const quiet = useSaveStatus((s) => s.pending === 0)
  // catching up after the connection came back (or after a teammate's bigger change)
  const caughtUp = useSaveStatus((s) => s.caughtUpAt)
  const people = useData((s) => s.people)
  const [, redraw] = useState(0)
  /** the last read failed: tried again once something changes (the issue, or a catch-up: the connection is back) */
  const [failed, setFailed] = useState<{ key: string; sig: string; caughtUp?: number } | null>(null)
  const sig = historySignature(issue)
  const { id } = issue
  const key = ws ? `${ws}:${id}` : undefined

  useEffect(() => {
    if (!key) return
    if (failed?.key === key && failed.sig === sig && failed.caughtUp === caughtUp) return
    const known = cache.get(key)
    const fresh = !!known && known.caughtUp !== caughtUp
    if (known?.sig === sig && !fresh && failed?.key !== key) return
    // your change isn't saved yet, so its event may not be there
    if (known && !quiet) return
    let stale = false
    const t = setTimeout(() => {
      const ask = { sig, asked: ++asks }
      void backend.history(id, fresh ? 0 : cache.get(key)?.rows.at(-1)?.id).then(
        (rows) => {
          // kept even when this page moved on: what was read is still true, and it's shown next time
          cache.set(key, { ...mergeFetched(cache.get(key), rows, ask, fresh), caughtUp })
          setFailed(null)
          redraw((n) => n + 1)
        },
        (e: unknown) => {
          console.warn('Sprawniej couldn’t read the history', e)
          if (!stale) setFailed({ key, sig, caughtUp })
        },
      )
    }, known ? SETTLE : 0)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [key, id, sig, quiet, caughtUp, failed])

  const rows = key ? cache.get(key)?.rows : undefined
  const { createdBy, createdAt } = issue
  // `people`: someone who joined since shows by name on the next draw
  const events = useMemo(
    () => (rows ? issueEvents(rows, { login: (p) => registry.login(p), createdBy, createdAt }) : null),
    [rows, people, createdBy, createdAt], // oxlint-disable-line react-hooks/exhaustive-deps
  )
  return { events, failed: !!key && failed?.key === key }
}
