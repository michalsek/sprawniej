/**
 * The database tables the app reads, as TypeScript sees them (docs/supabase-plan.md, section 2). The row types come
 * from database.types.ts; the keys here must match private.wiring (supabase/migrations/20261020000002_helpers.sql).
 */
import type { Database } from './database.types'

type T = Database['public']['Tables']

/** tables whose rows the app applies (broadcast on ws: or me:) */
export const LIVE_TABLES = [
  'workspaces',
  'profiles',
  'workspace_members',
  'teams',
  'team_members',
  'labels',
  'projects',
  'project_teams',
  'issues',
  'issue_labels',
  'issue_followers',
  'comments',
  'views',
  'inbox',
  'read_state',
] as const
export type LiveTable = (typeof LIVE_TABLES)[number]
export const isLiveTable = (name: unknown): name is LiveTable => (LIVE_TABLES as readonly unknown[]).includes(name)

export type Row<N extends keyof T> = T[N]['Row']
export type Insert<N extends keyof T> = T[N]['Insert']
export type Update<N extends keyof T> = T[N]['Update']

/** primary key columns, in the order of private.wiring (deletions.row_key and DELETE messages use the same) */
export const KEYS = {
  workspaces: ['id'],
  profiles: ['id'],
  workspace_members: ['workspace_id', 'profile_id'],
  teams: ['id'],
  team_members: ['team_id', 'profile_id'],
  labels: ['id'],
  projects: ['id'],
  project_teams: ['project_id', 'team_id'],
  issues: ['id'],
  issue_labels: ['issue_id', 'label_id'],
  issue_followers: ['issue_id', 'profile_id'],
  comments: ['id'],
  views: ['id'],
  inbox: ['id'],
  read_state: ['profile_id', 'workspace_id'],
} as const satisfies Record<LiveTable, readonly string[]>
export type KeyOf<N extends LiveTable> = { [K in (typeof KEYS)[N][number]]: string }

/**
 * What arrives on a channel (private.broadcast in 20261020000006_realtime.sql). An UPDATE carries only the changed
 * columns plus the keys and changed_at; a DELETE only the keys; a row too big to send comes without description or
 * body and with `partial`. `table` is a plain string: a message for a table we don't know is skipped, not an error.
 */
export type Message =
  | { table: string; op: 'INSERT' | 'UPDATE' | 'DELETE'; row: Record<string, unknown> & { partial?: true } }
  | { op: 'catch_up'; table?: string }

/** {id, workspace_id, table_name, row_key, deleted_at} */
export type DeletionRow = Row<'deletions'>
