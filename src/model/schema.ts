/**
 * The shapes the app works with: a workspace, people, teams, issues, comments, projects, views and inbox notes.
 * src/backend/rows.ts turns the database's rows into these and back; docs/data-format.md describes the tables.
 *
 * `.loose()` keeps fields we don't know yet (rows.ts keeps them in each row's `extra`), so an older app never
 * deletes what a newer one wrote.
 */
import { z } from 'zod'
import { PRIORITY_IDS, STATUS_IDS } from './status'

const iso = z.string() // ISO 8601 date-time
const login = z.string() // @handle

/** a shape's own fields, without the "anything else" `.loose()` allows, so a misspelled field doesn't compile */
export type Known<T> = { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] }

/** a workspace (the workspaces table) */
export const workspaceSchema = z
  .object({
    name: z.string(),
    /** the workspace's id */
    id: z.string().optional(),
    createdAt: iso,
  })
  .loose()
export type Workspace = z.infer<typeof workspaceSchema>

/**
 * Someone with a profile: a name and an @handle (the profiles table). `linearIds` remembers who they were in Linear
 * once someone from Linear is linked to their account (Settings › People from Linear).
 */
export const personSchema = z
  .object({
    login,
    githubId: z.number().int(),
    name: z.string(),
    avatarUrl: z.string(),
    /** they typed their name in Sprawniej (Settings › Your account): their GitHub name doesn't replace it */
    nameSetHere: z.boolean().optional(),
  })
  .loose()
export type Person = z.infer<typeof personSchema>

/**
 * Someone the Linear import brought who isn't in the workspace yet (`~jan-kowalski`). Their issues, comments and
 * views keep pointing at them; inviting them or linking them to someone's account (Settings › People from Linear)
 * moves all of that over. A `~` can't start a handle, so they never clash, and they get no inbox notes.
 */
export const isGuest = (login: string | null | undefined): boolean => !!login && login.startsWith('~')

/** the Linear ids a person stands for: a guest's own (`linearId`), and the ones linked to an account (`linearIds`) */
export function linearIdsOf(p: Person | undefined): string[] {
  const x = p as { linearId?: unknown; linearIds?: unknown } | undefined
  const own = typeof x?.linearId === 'string' ? [x.linearId] : []
  const linked = Array.isArray(x?.linearIds) ? x.linearIds.filter((i): i is string => typeof i === 'string') : []
  return [...new Set([...own, ...linked])]
}

/** what someone may do in a workspace (src/data/roles.ts) */
export const ROLES = ['owner', 'admin', 'member'] as const
export type Role = (typeof ROLES)[number]
export const isRole = (v: unknown): v is Role => (ROLES as readonly unknown[]).includes(v)

/** someone's place in a workspace (the workspace_members table) */
export interface Member {
  role: Role
  /** when they left or were removed; their name still shows on old work */
  removedAt: string | null
}

/** a label (the labels table) */
export const labelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
  })
  .loose()
export type Label = z.infer<typeof labelSchema>

/** months after which finished issues are archived, unless a team says otherwise (team.autoArchive) */
export const AUTO_ARCHIVE_MONTHS = 6

/** a team key (ENG): a capital letter, then up to six capitals or digits; the database checks the same */
export const TEAM_KEY_PATTERN = /^[A-Z][A-Z0-9]{0,6}$/

/** an @handle: letters, digits and dashes, not starting with a dash, at most 39; the same rule as private.valid_login */
export const LOGIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/

/** a team (the teams table; `members` from team_members) */
export const teamSchema = z
  .object({
    key: z.string().regex(TEAM_KEY_PATTERN),
    name: z.string(),
    emoji: z.string(),
    members: z.array(login),
    createdAt: iso,
    /** the highest number a deleted, moved-away or archived issue had, so numbers are never given out twice */
    lastNumber: z.number().int().optional(),
    /** finished issues are archived this many months after they were finished; 0 = never; missing = 6 */
    autoArchive: z.number().int().nonnegative().optional(),
  })
  .loose()
export type Team = z.infer<typeof teamSchema>

/** an issue's fields (the issues table; labels and followers come from their own tables) */
export const issueFieldsSchema = z
  .object({
    id: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
    status: z.enum(STATUS_IDS),
    priority: z.union(PRIORITY_IDS.map((p) => z.literal(p))),
    assignee: login.nullable(),
    labels: z.array(z.string()),
    project: z.string().nullable(),
    parent: z.string().nullable(),
    /** a day, "2026-10-31" (no time: it's the same day for everyone) */
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    /** how big it is, in points (see ESTIMATES) */
    estimate: z.number().nonnegative().nullable().optional(),
    /** fractional index (see fractional-indexing): a drag rewrites only the moved issue */
    sortOrder: z.string(),
    createdBy: login,
    createdAt: iso,
    updatedAt: iso,
    completedAt: iso.nullable().optional(),
    duplicateOf: z.string().nullable().optional(),
    /** people who asked to follow it, on top of those who follow it anyway (see notify.ts, followers) */
    subscribers: z.array(login).optional(),
    /** people who asked not to follow it */
    unsubscribed: z.array(login).optional(),
    /** the numbers it had before it moved to another team ("WEB-2"), so old links and mentions still find it */
    formerRefs: z.array(z.string()).optional(),
  })
  .loose()
export type IssueFields = z.infer<typeof issueFieldsSchema>

export interface Issue extends IssueFields {
  /** the team's key */
  team: string
  /** Markdown */
  description: string
}

/** a comment on an issue (the comments table), changed only by its author */
export const commentFieldsSchema = z
  .object({
    id: z.string(),
    issue: z.string(),
    author: login,
    createdAt: iso,
    editedAt: iso.nullable().optional(),
  })
  .loose()
export interface Comment extends z.infer<typeof commentFieldsSchema> {
  body: string
}

/** an archived issue with its comments, read only when something needs it (an old link, search, the Archived tab) */
export interface ArchivedIssue extends Issue {
  archivedAt: string
  archivedBy: string
  comments: Comment[]
}

export const PROJECT_STATUSES = ['backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled'] as const

/** a project (the projects table; `teams` from project_teams) */
export const projectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    emoji: z.string(),
    description: z.string(),
    status: z.enum(PROJECT_STATUSES),
    lead: login.nullable(),
    teams: z.array(z.string()),
    targetDate: z.string().nullable(),
    createdAt: iso,
  })
  .loose()
export type Project = z.infer<typeof projectSchema>

export const GROUPINGS = ['status', 'assignee', 'priority', 'project', 'none'] as const
export type Grouping = (typeof GROUPINGS)[number]
export const ORDERINGS = ['manual', 'priority', 'due', 'updated', 'created'] as const
export type Ordering = (typeof ORDERINGS)[number]

export const filtersSchema = z
  .object({
    teams: z.array(z.string()).optional(),
    statuses: z.array(z.enum(STATUS_IDS)).optional(),
    assignees: z.array(login.nullable()).optional(),
    /** people following the issue (see src/data/notify.ts, `followers`) */
    subscribers: z.array(login).optional(),
    priorities: z.array(z.number().int()).optional(),
    labels: z.array(z.string()).optional(),
    projects: z.array(z.string().nullable()).optional(),
  })
  .loose()
export type Filters = z.infer<typeof filtersSchema>

export const displaySchema = z
  .object({
    layout: z.enum(['list', 'board']),
    grouping: z.enum(GROUPINGS),
    ordering: z.enum(ORDERINGS),
    showCompleted: z.boolean(),
    showSubIssues: z.boolean(),
  })
  .loose()
export type Display = z.infer<typeof displaySchema>

/** a view: a saved filter with an emoji (the views table) */
export const viewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    emoji: z.string(),
    description: z.string(),
    owner: login,
    /** null = the whole workspace, otherwise a team key */
    team: z.string().nullable(),
    filters: filtersSchema,
    display: displaySchema,
    createdAt: iso,
  })
  .loose()
export type View = z.infer<typeof viewSchema>

/** an inbox note (the inbox table), made by whoever caused it */
export const inboxItemSchema = z
  .object({
    id: z.string(),
    type: z.enum(['assigned', 'mentioned', 'commented', 'status']),
    issue: z.string(),
    actor: login,
    at: iso,
    /** the comment it's about (mentioned in a comment, commented) */
    comment: z.string().optional(),
    /** the new status (status) */
    status: z.enum(STATUS_IDS).optional(),
    /** when it was read one by one */
    readAt: iso.nullable().optional(),
  })
  .loose()
export type InboxItem = z.infer<typeof inboxItemSchema>

/** how far you've read your inbox (the read_state table), changed only by you */
export const readStateSchema = z
  .object({
    /** everything at or before this moment counts as read */
    readUntil: iso.nullable(),
  })
  .loose()
export type ReadState = z.infer<typeof readStateSchema>
