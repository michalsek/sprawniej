/**
 * Loads an issue's history (src/data/history.ts) when its page opens, and again whenever the issue changes: your own
 * changes once they're saved, and teammates' as they arrive. Only events newer than the ones already here are asked
 * for. Kept per issue while the workspace is open, so going back to an issue shows its history at once.
 */
import { useEffect, useMemo, useState } from 'react'
import { backend, useBackend } from '@/backend'
import { registry } from '@/backend/registry'
import { useSaveStatus } from '@/backend/status'
import { historySignature, issueEvents, type EventRow, type HistoryEvent } from '@/data/history'
import { useData } from '@/data/store'
import type { ArchivedIssue, Issue } from '@/model/schema'

/** `${workspace id}:${issue id}` → the events read so far, and the issue as it was when they were asked for */
const cache = new Map<string, { rows: EventRow[]; sig: string; asked: number }>()
/** which ask came later: an answer that arrives after a newer one's keeps the newer one's signature */
let asks = 0

// another workspace, or signed out: nothing here belongs to what opens next
useBackend.subscribe((s) => {
  if (s.phase === 'closed') cache.clear()
})

/** changes coming one after another (typing) are asked about once, this long after the last */
const SETTLE = 1200

function dedupe(rows: EventRow[]): EventRow[] {
  const seen = new Set<number>()
  return rows.filter((r) => !seen.has(r.id) && !!seen.add(r.id))
}

export function useIssueHistory(issue: Issue | ArchivedIssue): { events: HistoryEvent[] | null; failed: boolean } {
  const ws = useBackend((s) => (s.phase === 'open' ? s.workspaceId : undefined))
  // nothing of yours is still on its way: the events for your changes are there to read
  const quiet = useSaveStatus((s) => s.pending === 0)
  const people = useData((s) => s.people)
  const [, redraw] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const sig = historySignature(issue)
  const { id } = issue
  const key = ws ? `${ws}:${id}` : undefined

  useEffect(() => {
    if (!key) return
    const known = cache.get(key)
    if (known?.sig === sig) return
    // your change isn't saved yet, so its event may not be there
    if (known && !quiet) return
    let stale = false
    const t = setTimeout(() => {
      const asked = ++asks
      void backend.history(id, cache.get(key)?.rows.at(-1)?.id).then(
        (rows) => {
          // the issue as it was when this was asked for: a change that came meanwhile asks again
          const now = cache.get(key)
          const newer = now && now.asked > asked
          cache.set(key, {
            rows: dedupe([...(now?.rows ?? []), ...rows]).sort((a, b) => a.id - b.id),
            sig: newer ? now.sig : sig,
            asked: newer ? now.asked : asked,
          })
          setFailed(null)
          redraw((n) => n + 1)
        },
        (e: unknown) => {
          console.warn('Sprawniej couldn’t read the history', e)
          if (!stale) setFailed(key)
        },
      )
    }, known ? SETTLE : 0)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [key, id, sig, quiet])

  const rows = key ? cache.get(key)?.rows : undefined
  const { createdBy, createdAt } = issue
  // `people`: someone who joined since shows by name on the next draw
  const events = useMemo(
    () => (rows ? issueEvents(rows, { login: (p) => registry.login(p), createdBy, createdAt }) : null),
    [rows, people, createdBy, createdAt], // oxlint-disable-line react-hooks/exhaustive-deps
  )
  return { events, failed: !!key && failed === key }
}
