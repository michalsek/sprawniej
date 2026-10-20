/**
 * Everything the workspace holds, kept in memory as plain maps. Components read from here with selectors;
 * they never change it directly. All changes go through `actions.ts` (see CLAUDE.md, golden rules).
 */
import { create } from 'zustand'
import { TEAM_KEY, type ArchivedIssue, type Comment, type Favourite, type InboxItem, type Issue, type Label, type Member, type Person, type Project, type PullRequest, type ReadState, type Status, type Team, type View, type Workspace } from '@/model/schema'

export interface DataState {
  workspace: Workspace | null
  /** the signed-in person */
  me: Person | null
  people: Record<string, Person>
  /** by login: everyone's role in the workspace, and who left */
  members: Record<string, Member>
  labels: Record<string, Label>
  /** the workspace's own statuses by id, every kind, hidden ones too (src/data/statuses.ts) */
  statuses: Record<string, Status>
  teams: Record<string, Team>
  issues: Record<string, Issue>
  /** archived issues by id; empty until something needs them (loadArchive in src/backend) */
  archive: Record<string, ArchivedIssue>
  archiveLoaded: boolean
  projects: Record<string, Project>
  views: Record<string, View>
  /** by issue id, oldest first */
  comments: Record<string, Comment[]>
  /** by issue id (open or archived): the GitHub pull requests that mention it, by repository and number */
  pullRequests: Record<string, PullRequest[]>
  /** my inbox, newest first */
  inbox: InboxItem[]
  readState: ReadState
  /** my favourites in this workspace, in my order (sortOrder, then id); may name things that are gone (src/data/favourites.ts) */
  favourites: Favourite[]
}

export const EMPTY: DataState = {
  workspace: null,
  me: null,
  people: {},
  members: {},
  labels: {},
  statuses: {},
  teams: {},
  issues: {},
  archive: {},
  archiveLoaded: false,
  projects: {},
  views: {},
  comments: {},
  pullRequests: {},
  inbox: [],
  readState: { readUntil: null },
  favourites: [],
}

export const useData = create<DataState>()(() => ({ ...EMPTY }))

/** "ENG-12" */
export const issueRef = (issue: Pick<Issue, 'team' | 'number'>) => `${issue.team}-${issue.number}`

/** "ENG-12" → issue, built once per version of the issues (the store replaces the object on every change) */
const refIndex = new WeakMap<Record<string, Issue>, Map<string, Issue>>()

function refsOf(issues: Record<string, Issue>): Map<string, Issue> {
  let index = refIndex.get(issues)
  if (index) return index
  index = new Map()
  const all = Object.values(issues)
  for (const i of all) {
    const ref = issueRef(i)
    if (!index.has(ref)) index.set(ref, i)
  }
  // an issue that moved to another team answers to its old number too (numbers are never given out twice), unless
  // an issue has that number now
  for (const i of all) for (const ref of i.formerRefs ?? []) if (!index.has(ref)) index.set(ref, i)
  refIndex.set(issues, index)
  return index
}

/** "ENG-12": a team key, a dash and a number */
const REF = new RegExp(`^(${TEAM_KEY})-(\\d+)$`)

/** find an issue by its "ENG-12" reference */
export function findByRef(issues: Record<string, Issue>, ref: string): Issue | undefined {
  const m = REF.exec(ref.toUpperCase())
  return m ? refsOf(issues).get(`${m[1]}-${Number(m[2])}`) : undefined
}

/** an archived issue by its "ENG-12" reference (only once the archive is loaded); an active one with the same id wins */
export function findArchivedByRef(s: Pick<DataState, 'archive' | 'issues'>, ref: string): ArchivedIssue | undefined {
  const found = findByRef(s.archive, ref) as ArchivedIssue | undefined
  return found && !s.issues[found.id] ? found : undefined
}

declare global {
  interface Window {
    /** for scripted checks in tests: window.sprawniej.data.getState(), window.sprawniej.backend.catchUp() */
    sprawniej?: { data?: typeof useData; actions?: Record<string, unknown>; backend?: unknown; theme?: unknown }
  }
}
if (typeof window !== 'undefined') window.sprawniej = { ...window.sprawniej, data: useData }
