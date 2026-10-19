/**
 * Reading an issue's history events (the database writes them, src/data/history.ts reads them as lines). Only what
 * comes after the last one already known is asked for, so opening an issue again or after a change costs little.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventRow } from '@/data/history'
import type { Database } from './database.types'
import { iso } from './rows'

/** the most rows one answer brings */
const PAGE = 1000
/** ten thousand events for one issue is already far more than any issue has */
const MAX_PAGES = 10

/** an issue's events after `afterId`, oldest first; throws when they can't be read */
export async function fetchIssueEvents(db: SupabaseClient<Database>, workspaceId: string, issueId: string, afterId = 0): Promise<EventRow[]> {
  const out: EventRow[] = []
  let last = afterId
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db
      .from('issue_events')
      .select('id, actor_id, at, changes')
      .eq('workspace_id', workspaceId)
      .eq('issue_id', issueId)
      .gt('id', last)
      .order('id')
      .limit(PAGE)
    if (error) throw error
    for (const r of data) out.push({ id: Number(r.id), actorId: r.actor_id, at: iso(r.at), changes: r.changes })
    if (data.length < PAGE) break
    last = out.at(-1)!.id
  }
  return out
}
