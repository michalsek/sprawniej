/**
 * The app's copy of what the database has, one record per table. Join tables and comments are kept in groups by
 * their parent (an issue's labels, a team's members), so working out one issue reads only its own rows.
 *
 * MirrorDraft changes it without touching the original: each record is copied the first time it changes in a call.
 */
import { keyString } from '../changes'
import type { LiveTable, Row } from '../tables'

type Rec<V> = Readonly<Record<string, V>>

export interface Mirror {
  workspaces: Rec<Row<'workspaces'>>
  profiles: Rec<Row<'profiles'>>
  /** by keyString */
  workspace_members: Rec<Row<'workspace_members'>>
  teams: Rec<Row<'teams'>>
  /** team_id → profile_id → row */
  team_members: Rec<Rec<Row<'team_members'>>>
  labels: Rec<Row<'labels'>>
  projects: Rec<Row<'projects'>>
  /** project_id → team_id → row */
  project_teams: Rec<Rec<Row<'project_teams'>>>
  issues: Rec<Row<'issues'>>
  /** issue_id → label_id → row */
  issue_labels: Rec<Rec<Row<'issue_labels'>>>
  /** issue_id → profile_id → row */
  issue_followers: Rec<Rec<Row<'issue_followers'>>>
  /** issue_id → comment id → row */
  comments: Rec<Rec<Row<'comments'>>>
  /** comment id → issue_id (an update or delete carries only the id) */
  commentIssue: Rec<string>
  views: Rec<Row<'views'>>
  inbox: Rec<Row<'inbox'>>
  /** by keyString */
  read_state: Rec<Row<'read_state'>>
}

export const emptyMirror = (): Mirror => ({
  workspaces: {},
  profiles: {},
  workspace_members: {},
  teams: {},
  team_members: {},
  labels: {},
  projects: {},
  project_teams: {},
  issues: {},
  issue_labels: {},
  issue_followers: {},
  comments: {},
  commentIssue: {},
  views: {},
  inbox: {},
  read_state: {},
})

/** tables kept in groups by their parent: [the parent column, the column within the group] */
export const GROUPED = {
  team_members: ['team_id', 'profile_id'],
  project_teams: ['project_id', 'team_id'],
  issue_labels: ['issue_id', 'label_id'],
  issue_followers: ['issue_id', 'profile_id'],
  comments: ['issue_id', 'id'],
} as const
export type Grouped = keyof typeof GROUPED
export const isGrouped = (t: LiveTable): t is Grouped => t in GROUPED

/** the parent a grouped row belongs to (its issue, team or project) */
export const parentOf = (t: Grouped, row: Readonly<Record<string, unknown>>): unknown => row[GROUPED[t][0]]

/** copies an object the first time it changes within one call, and hands out the same copy after that */
export class Copier {
  private own = new WeakSet<object>()

  copy<T extends object>(o: T): T {
    if (this.own.has(o)) return o
    const c = { ...o }
    this.own.add(c)
    return c
  }
}

type Loose = Record<string, unknown>

export class MirrorDraft {
  current: Mirror
  private copier: Copier

  constructor(mirror: Mirror, copier: Copier) {
    this.current = mirror
    this.copier = copier
  }

  /** the record behind one table (read only) */
  private table(t: keyof Mirror): Rec<unknown> {
    return this.current[t]
  }

  /** the record behind one table, copied for changing */
  private edit(t: keyof Mirror): Loose {
    this.current = this.copier.copy(this.current)
    const table = this.copier.copy(this.current[t] as Loose)
    Object.assign(this.current, { [t]: table })
    return table
  }

  /** the issue a comment we have belongs to */
  issueOf(commentId: string): string | undefined {
    return this.current.commentIssue[commentId]
  }

  private groupOf(t: Grouped, key: Readonly<Record<string, unknown>>): string | undefined {
    const p = parentOf(t, key)
    if (typeof p === 'string') return p
    return t === 'comments' && typeof key.id === 'string' ? this.issueOf(key.id) : undefined
  }

  get<N extends LiveTable>(t: N, key: Readonly<Record<string, unknown>>): Row<N> | undefined {
    if (!isGrouped(t)) return this.table(t)[keyString(t, key)] as Row<N> | undefined
    const p = this.groupOf(t, key)
    const group = p === undefined ? undefined : (this.table(t)[p] as Rec<Row<N>> | undefined)
    return group?.[String(key[GROUPED[t][1]])]
  }

  /** a parent's join rows or comments */
  group<N extends Grouped>(t: N, parent: string): Row<N>[] {
    return Object.values((this.table(t)[parent] ?? {}) as Rec<Row<N>>)
  }

  put<N extends LiveTable>(t: N, row: Row<N>) {
    const r: Readonly<Loose> = row
    if (!isGrouped(t)) {
      this.edit(t)[keyString(t, r)] = row
      return
    }
    const parent = String(parentOf(t, r))
    const sub = String(r[GROUPED[t][1]])
    if (t === 'comments') {
      const was = this.issueOf(sub)
      if (was !== parent) {
        if (was !== undefined) this.dropOne(t, was, sub)
        this.edit('commentIssue')[sub] = parent
      }
    }
    const outer = this.edit(t)
    const group = outer[parent] ? this.copier.copy(outer[parent] as Loose) : this.copier.copy<Loose>({})
    outer[parent] = group
    group[sub] = row
  }

  remove(t: LiveTable, key: Readonly<Record<string, unknown>>) {
    if (!isGrouped(t)) {
      const k = keyString(t, key)
      if (k in this.table(t)) delete this.edit(t)[k]
      return
    }
    const parent = this.groupOf(t, key)
    if (parent === undefined) return
    const sub = String(key[GROUPED[t][1]])
    this.dropOne(t, parent, sub)
    if (t === 'comments' && sub in this.current.commentIssue) delete this.edit('commentIssue')[sub]
  }

  /** a parent went: takes its join rows (or comments) away and returns them */
  dropGroup<N extends Grouped>(t: N, parent: string): Row<N>[] {
    const rows = this.group(t, parent)
    if (!rows.length) return rows
    if (t === 'comments') for (const row of rows) delete this.edit('commentIssue')[String((row as Readonly<Loose>).id)]
    delete this.edit(t)[parent]
    return rows
  }

  private dropOne(t: Grouped, parent: string, sub: string) {
    const group = this.table(t)[parent] as Rec<unknown> | undefined
    if (!group || !(sub in group)) return
    const outer = this.edit(t)
    const g = this.copier.copy(group as Loose)
    delete g[sub]
    if (Object.keys(g).length) outer[parent] = g
    else delete outer[parent]
  }
}
