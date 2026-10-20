/**
 * One change to one row, as an action makes it. The app shows it at once (apply.ts, `local`) and sends it to the
 * database (writes.ts).
 */
import { KEYS, type Insert, type KeyOf, type LiveTable, type Row, type Update } from './tables'

/**
 * The columns a signed-in person may write, as the database grants them (supabase/migrations/*_rls.sql). Everything
 * else (changed_at, numbers, authors, times, linear_id) is filled in by the database. Keep in step with the grants.
 */
interface Grants {
  workspaces: { insert: never; update: 'name' | 'extra' }
  profiles: { insert: never; update: 'name' | 'avatar_url' | 'name_set_here' | 'extra' }
  workspace_members: { insert: never; update: 'role' | 'removed_at' }
  teams: { insert: 'id' | 'workspace_id' | 'key' | 'name' | 'emoji' | 'auto_archive' | 'extra'; update: 'name' | 'emoji' | 'auto_archive' | 'extra' }
  team_members: { insert: 'workspace_id' | 'team_id' | 'profile_id'; update: never }
  labels: { insert: 'id' | 'workspace_id' | 'name' | 'color' | 'extra'; update: 'name' | 'color' | 'extra' }
  /** kind and category never change; nobody deletes one (they are hidden) */
  statuses: {
    insert: 'id' | 'workspace_id' | 'kind' | 'category' | 'name' | 'color' | 'position' | 'hidden' | 'extra'
    update: 'name' | 'color' | 'position' | 'hidden' | 'extra'
  }
  projects: {
    insert: 'id' | 'workspace_id' | 'name' | 'emoji' | 'description' | 'status' | 'lead_id' | 'target_date' | 'extra'
    update: 'name' | 'emoji' | 'description' | 'status' | 'lead_id' | 'target_date' | 'extra'
  }
  project_teams: { insert: 'workspace_id' | 'project_id' | 'team_id'; update: never }
  issues: {
    insert:
      | 'id' | 'workspace_id' | 'team_id' | 'title' | 'description' | 'status' | 'status_id' | 'priority' | 'assignee_id'
      | 'project_id' | 'parent_id' | 'due_date' | 'estimate' | 'sort_order' | 'duplicate_of' | 'extra'
    update:
      | 'title' | 'description' | 'status' | 'status_id' | 'priority' | 'assignee_id' | 'project_id' | 'parent_id'
      | 'due_date' | 'estimate' | 'sort_order' | 'duplicate_of' | 'archived_at' | 'extra'
  }
  issue_labels: { insert: 'workspace_id' | 'issue_id' | 'label_id'; update: never }
  issue_followers: { insert: 'workspace_id' | 'issue_id' | 'profile_id' | 'following'; update: 'following' }
  comments: { insert: 'id' | 'workspace_id' | 'issue_id' | 'body' | 'extra'; update: 'body' | 'extra' }
  /** written only by the GitHub webhook */
  issue_pull_requests: { insert: never; update: never }
  views: {
    insert: 'id' | 'workspace_id' | 'team_id' | 'name' | 'emoji' | 'description' | 'filters' | 'display' | 'extra'
    update: 'name' | 'emoji' | 'description' | 'filters' | 'display' | 'extra'
  }
  inbox: { insert: 'id' | 'workspace_id' | 'recipient_id' | 'type' | 'issue_id' | 'comment_id' | 'status' | 'status_id' | 'extra'; update: 'read_at' }
  read_state: { insert: 'profile_id' | 'workspace_id' | 'read_until' | 'extra'; update: 'profile_id' | 'workspace_id' | 'read_until' | 'extra' }
  favourites: { insert: 'profile_id' | 'workspace_id' | 'kind' | 'item_id' | 'sort_order' | 'extra'; update: 'sort_order' | 'extra' }
}

/** what a signed-in person may send for this table */
export type Writable<N extends LiveTable, O extends 'insert' | 'update'> = Partial<
  O extends 'insert' ? Pick<Insert<N>, Grants[N]['insert'] & keyof Insert<N>> : Pick<Update<N>, Grants[N]['update'] & keyof Update<N>>
>

/** a change the database makes through one of its functions, not a plain update (writes.ts sends it as a call) */
export interface Call {
  fn: 'move_issue_to_team'
  args: { p_issue: string; p_team: string }
}

interface Base<N extends LiveTable> {
  table: N
  key: KeyOf<N>
  /** shown at once, never sent: what the database fills in (issues.number, created_at, created_by, updated_at…) */
  guess?: Partial<Row<N>>
  /** sent as this call instead of the fields (applying ignores it: the guess shows what it does) */
  call?: Call
}
export type Change<N extends LiveTable = LiveTable> =
  /** the new row, only the columns people may write */
  | (Base<N> & { op: 'insert'; fields: Writable<N, 'insert'> })
  /** only the changed columns */
  | (Base<N> & { op: 'update'; fields: Writable<N, 'update'> })
  | (Base<N> & { op: 'delete'; fields?: Record<string, never> })
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
