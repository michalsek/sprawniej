/**
 * Saving a Linear import (docs/linear-import.md). linearMap.ts works out what is new or changed, in the model's own
 * shapes; here it becomes calls: planImport (pure, tested in tests/importRows.test.ts) turns it into steps of rows
 * for import_rows, deletes for what Linear took off, and the few function calls for people; runImport sends them one
 * after another and says how far it got.
 *
 * import_rows writes only the columns a batch has, and checks every required one before it finds the row that is
 * already there (supabase/migrations/20261019000006_functions.sql). So each step sends exactly its column list, every
 * row of a batch the same, required ones never empty. Every step can be sent again: a row already saved is left as
 * it is, so an import that stopped partway goes on where it stopped.
 *
 * The order matters:
 *   1. guests (people from Linear who haven't joined), so rows can name them;
 *   2. teams that let go of a Linear team, then new teams and their members, then teams that take one: a Linear team
 *      stands for one team here (unique linear_id), and Postgres refuses two rows with one key in one statement;
 *   3. labels, projects and their teams;
 *   4. issues without parents, then their parents (a parent may come in the same import), labels, followers;
 *   5. comments, views, guests' emails, and last the links that move a guest's work to their account.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Existing, ImportExtras, ImportResult } from '@/features/import/linearMap'
import type { Db } from './client'
import type { Json } from './database.types'
import { paged } from './load'
import { friendlyDbError, isUnreachable } from './problem'
import type { Registry } from './registry'
import { commentToRow, issueToRows, labelToRow, personToProfile, projectToRows, rowToPerson, teamToRows, viewToRow } from './rows'
import type { Row } from './tables'

/** rows per import_rows call (it takes up to 1000) */
export const IMPORT_BATCH = 500
/** a batch also stops at about this much JSON, so one call stays small enough to send */
export const IMPORT_BYTES = 2_000_000
/** a batch the database found too big or too slow is halved, down to about this many rows */
const MIN_SPLIT = 25
/** a failure worth another try waits these long first */
const RETRY_MS = [1_000, 3_000, 9_000]

export type ImportTable =
  | 'profiles'
  | 'teams'
  | 'team_members'
  | 'labels'
  | 'projects'
  | 'project_teams'
  | 'issues'
  | 'issue_labels'
  | 'issue_followers'
  | 'comments'
  | 'views'
type RemoveTable = 'issue_labels' | 'project_teams' | 'issue_followers' | 'views'
type Loose = Record<string, unknown>

export type ImportStep =
  /** one import_rows call; `part` names the pass (teams and issues have more than one) */
  | { kind: 'rows'; table: ImportTable; part: string; rows: Loose[] }
  /** what Linear took off since an earlier import */
  | { kind: 'remove'; table: RemoveTable; keys: Record<string, string>[] }
  /** set_guest_email */
  | { kind: 'email'; profile: string; email: string }
  /** link_person (profile ids) */
  | { kind: 'link'; guest: string; to: string }

export interface ImportPlan {
  workspaceId: string
  steps: ImportStep[]
  /** rows, keys and calls: what the progress bar counts */
  total: number
  /** new team key → id */
  newTeams: Record<string, string>
  /** archived issues (and comments on them) it brings: an archive already read is read again after */
  archived: number
}

/** a message ready to show */
export class ImportProblem extends Error {}

// ---------- columns ----------

/** the columns each step sends (workspace_id, and guest_of for profiles, come from import_rows itself) */
export const COLS = {
  profiles: ['id', 'login', 'name', 'avatar_url', 'linear_ids', 'extra'],
  /** a team letting go of a Linear team or taking one: name is required and has no default, so it goes too */
  teamLink: ['id', 'key', 'name', 'linear_id'],
  teams: ['id', 'key', 'name', 'emoji', 'auto_archive', 'linear_id', 'created_at', 'extra'],
  team_members: ['team_id', 'profile_id'],
  labels: ['id', 'name', 'color', 'linear_id', 'extra'],
  projects: ['id', 'name', 'emoji', 'description', 'status', 'lead_id', 'target_date', 'linear_id', 'created_at', 'extra'],
  project_teams: ['project_id', 'team_id'],
  /** without parent_id and duplicate_of, so a row that is already here keeps them until the next pass */
  issues: [
    'id', 'team_id', 'number', 'title', 'description', 'status', 'priority', 'assignee_id', 'project_id', 'due_date', 'estimate',
    'sort_order', 'former_refs', 'created_by', 'created_at', 'updated_at', 'completed_at', 'archived_at', 'archived_by', 'linear_id', 'extra',
  ],
  /** every required column, with the same values as the first pass, so only parent_id and duplicate_of change */
  issueParents: [
    'id', 'team_id', 'number', 'title', 'description', 'status', 'priority', 'sort_order', 'former_refs', 'created_at', 'updated_at', 'extra',
    'parent_id', 'duplicate_of',
  ],
  issue_labels: ['issue_id', 'label_id'],
  issue_followers: ['issue_id', 'profile_id', 'following'],
  comments: ['id', 'issue_id', 'author_id', 'body', 'created_at', 'edited_at', 'linear_id', 'extra'],
  views: ['id', 'team_id', 'owner_id', 'name', 'emoji', 'description', 'filters', 'display', 'created_at', 'linear_id', 'extra'],
} as const

/** the columns that may never be empty (supabase/migrations/20261019000001_tables.sql) */
export const NOT_NULL: Record<ImportTable, readonly string[]> = {
  profiles: ['id', 'login', 'name', 'avatar_url', 'linear_ids', 'extra'],
  teams: ['id', 'key', 'name', 'emoji', 'auto_archive', 'created_at', 'extra'],
  team_members: ['team_id', 'profile_id'],
  labels: ['id', 'name', 'color', 'extra'],
  projects: ['id', 'name', 'emoji', 'description', 'status', 'created_at', 'extra'],
  project_teams: ['project_id', 'team_id'],
  issues: ['id', 'team_id', 'number', 'title', 'description', 'status', 'priority', 'sort_order', 'former_refs', 'created_at', 'updated_at', 'extra'],
  issue_labels: ['issue_id', 'label_id'],
  issue_followers: ['issue_id', 'profile_id', 'following'],
  comments: ['id', 'issue_id', 'body', 'created_at', 'extra'],
  views: ['id', 'name', 'emoji', 'description', 'filters', 'display', 'created_at', 'extra'],
}

const KEY_COLS: Record<ImportTable, readonly string[]> = {
  profiles: ['id'],
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
}

/** exactly these columns, undefined as null; a required one that is empty is a mistake in the code */
function shape(table: ImportTable, row: object, cols: readonly string[]): Loose {
  const out: Loose = {}
  for (const c of cols) {
    const v = (row as Loose)[c]
    out[c] = v === undefined ? null : v
    if (out[c] === null && NOT_NULL[table].includes(c)) throw new Error(`An import row of ${table} has no ${c}`)
  }
  return out
}

/** in order, at most `size` rows and about `bytes` of JSON each (a single bigger row goes alone) */
export function batches<T>(rows: readonly T[], size: number, bytes: number): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let weight = 0
  for (const row of rows) {
    const w = JSON.stringify(row).length + 1
    if (cur.length && (cur.length >= size || weight + w > bytes)) {
      out.push(cur)
      cur = []
      weight = 0
    }
    cur.push(row)
    weight += w
  }
  if (cur.length) out.push(cur)
  return out
}

// ---------- the plan ----------

export interface PlanContext {
  workspaceId: string
  registry: Registry
  /** an id for a new team */
  newTeamId: () => string
  batch?: number
  maxBytes?: number
  /**
   * an earlier try of this import that stopped partway: the members of the teams it made come again. Its teams are
   * here now, so this import doesn't see them as new and wouldn't give them members of its own
   */
  carry?: ImportPlan
}

/** every step the import takes, in order. Pure; a login or team key nobody knows is a mistake in the code, so it throws */
export function planImport(r: ImportResult, existing: Existing, ctx: PlanContext): ImportPlan {
  const { workspaceId: ws, batch = IMPORT_BATCH, maxBytes = IMPORT_BYTES } = ctx
  // the import's own ids go into a copy: the app's registry learns them as the rows come back
  const reg = ctx.registry.copy()
  for (const g of r.guests) if (g.id) reg.learnProfile(g.id, g.login)
  const newTeams: Record<string, string> = {}
  for (const t of r.teams) {
    const id = ctx.newTeamId()
    newTeams[t.key] = id
    reg.learnTeam(id, t.key)
  }
  const profileId = (login: string): string => {
    const id = reg.profileId(login)
    if (!id) throw new Error(`Unknown person: ${login}`)
    return id
  }
  const teamId = (key: string): string => {
    const id = reg.teamId(key)
    if (!id) throw new Error(`Unknown team: ${key}`)
    return id
  }

  const steps: ImportStep[] = []
  const rows = (table: ImportTable, part: string, list: readonly object[], cols: readonly string[]) => {
    const shaped = list.map((row) => shape(table, row, cols))
    const seen = new Set<string>()
    for (const row of shaped) {
      const key = KEY_COLS[table].map((c) => String(row[c])).join('|')
      if (seen.has(key)) throw new Error(`An import step of ${table} (${part}) names ${key} twice`)
      seen.add(key)
    }
    for (const b of batches(shaped, batch, maxBytes)) steps.push({ kind: 'rows', table, part, rows: b })
  }
  const remove = (table: RemoveTable, keys: Record<string, string>[]) => {
    if (keys.length) steps.push({ kind: 'remove', table, keys })
  }

  // 1. people from Linear who haven't joined (new ones, and ones whose name or picture changed)
  rows('profiles', 'guests', r.guests.map((g) => personToProfile(g, ws, reg)), COLS.profiles)

  // 2. teams: let go, new ones with their members, take
  const link = (l: ImportResult['teamLinks'][number]) => {
    const team = existing.teams[l.key]
    if (!team) throw new Error(`Unknown team: ${l.key}`)
    return { id: teamId(l.key), key: l.key, name: team.name, linear_id: l.linearId }
  }
  rows('teams', 'release', r.teamLinks.filter((l) => l.linearId === null).map(link), COLS.teamLink)
  const teams = r.teams.map((t) => teamToRows({ ...t, id: newTeams[t.key] } as typeof t, ws, reg))
  rows('teams', 'new', teams.map((t) => t.teams), COLS.teams)
  const members = teams.flatMap((t) => t.team_members as Loose[])
  const known = new Set(members.map((m) => `${m.team_id}|${m.profile_id}`))
  for (const s of ctx.carry?.steps ?? []) {
    if (s.kind !== 'rows' || s.table !== 'team_members') continue
    // only teams that were made (one that wasn't is made again now, with a new id)
    for (const m of s.rows) if (ctx.registry.teamKey(String(m.team_id)) !== undefined && !known.has(`${m.team_id}|${m.profile_id}`)) {
      known.add(`${m.team_id}|${m.profile_id}`)
      members.push(m)
    }
  }
  rows('team_members', 'team_members', members, COLS.team_members)
  rows('teams', 'take', r.teamLinks.filter((l) => l.linearId !== null).map(link), COLS.teamLink)

  // 3. labels, projects and their teams
  rows('labels', 'labels', r.labels.map((l) => labelToRow(l, ws)), COLS.labels)
  const projects = r.projects.map((p) => projectToRows(p, ws, reg))
  rows('projects', 'projects', projects.map((p) => p.projects), COLS.projects)
  rows('project_teams', 'project_teams', projects.flatMap((p) => p.project_teams), COLS.project_teams)
  remove('project_teams', r.removedProjectTeams.map((x) => ({ project_id: x.project, team_id: teamId(x.team) })))

  // 4. issues, then their parents, labels and followers
  const issues = r.issues.map((i) => ({ i, rows: issueToRows(i, ws, reg) }))
  rows('issues', 'first', issues.map((x) => x.rows.issues), COLS.issues)
  rows('issues', 'parents', issues.filter(({ i }) => i.parent || i.duplicateOf || existing.issues[i.id]).map((x) => x.rows.issues), COLS.issueParents)
  rows('issue_labels', 'issue_labels', issues.flatMap((x) => x.rows.issue_labels), COLS.issue_labels)
  remove('issue_labels', r.removedLabels.map((x) => ({ issue_id: x.issue, label_id: x.label })))
  rows('issue_followers', 'followers', issues.flatMap((x) => x.rows.issue_followers), COLS.issue_followers)
  remove('issue_followers', r.removedFollowers.map((x) => ({ issue_id: x.issue, profile_id: profileId(x.login) })))

  // 5. comments, views, emails, links
  rows('comments', 'comments', r.comments.map((c) => commentToRow(c, ws, reg)), COLS.comments)
  rows('views', 'views', r.views.map((v) => viewToRow(v, ws, reg)), COLS.views)
  remove('views', r.removedViews.map((id) => ({ id })))
  for (const e of r.guestEmails) steps.push({ kind: 'email', profile: e.id, email: e.email })
  for (const l of r.links) steps.push({ kind: 'link', guest: profileId(l.guest), to: profileId(l.to) })

  const archivedIds = new Set([...r.issues.filter((i) => i.archivedAt).map((i) => i.id), ...Object.values(existing.archivedByLinear).map((a) => a.id)])
  return {
    workspaceId: ws,
    steps,
    total: steps.reduce((n, s) => n + stepSize(s), 0),
    newTeams,
    archived: r.issues.filter((i) => i.archivedAt).length + r.comments.filter((c) => archivedIds.has(c.issue)).length,
  }
}

export const stepSize = (s: ImportStep): number => (s.kind === 'rows' ? s.rows.length : s.kind === 'remove' ? s.keys.length : 1)

// ---------- reading what the store doesn't hold ----------

/** archived issues and their comments from Linear, every number used, and the workspace's guests as they are now */
export async function readExisting(db: Db, ws: string, registry: Registry): Promise<ImportExtras> {
  const [archived, comments, numbers, guests] = await Promise.all([
    paged(db, 'issues', ['id'], 'id, linear_id, team_id, number', (q) => q.eq('workspace_id', ws).not('archived_at', 'is', null).not('linear_id', 'is', null)),
    paged(db, 'comments', ['id'], 'id, issue_id, linear_id, issues!inner(archived_at)', (q) =>
      q.eq('workspace_id', ws).not('linear_id', 'is', null).not('issues.archived_at', 'is', null),
    ),
    paged(db, 'issue_numbers', ['team_id', 'number'], 'team_id, number', (q) => q.eq('workspace_id', ws)),
    paged(db, 'profiles', ['id'], '*', (q) => q.eq('guest_of', ws)),
  ])
  const usedNumbers: Record<string, number[]> = {}
  for (const n of numbers) {
    const key = registry.teamKey(String(n.team_id))
    if (key) (usedNumbers[key] ??= []).push(Number(n.number))
  }
  // a guest someone else's import made a moment ago may not have reached this tab yet
  for (const g of guests) registry.learnProfile(String(g.id), String(g.login))
  return {
    archived: archived.flatMap((a) => {
      const team = registry.teamKey(String(a.team_id))
      return team ? [{ id: String(a.id), linearId: String(a.linear_id), team, number: Number(a.number) }] : []
    }),
    archivedComments: comments.map((c) => ({ id: String(c.id), issue: String(c.issue_id), linearId: String(c.linear_id) })),
    usedNumbers,
    guests: guests.map((g) => rowToPerson(g as unknown as Row<'profiles'>)),
  }
}

// ---------- sending ----------

const NETWORK = "We couldn't reach Sprawniej, so the import stopped partway. Check your internet connection."
const SIGNED_OUT = 'You were signed out, so the import stopped partway. Sign in again, then press Try again.'
const NUMBER_TAKEN = 'Someone added an issue to one of these teams while you were importing, so a number was taken.'
const CHANGED = 'Something here changed while you were importing.'
const WENT_WRONG = 'Something went wrong, so the import stopped partway.'

interface Answer {
  data: unknown
  error: { code?: string; message?: string; details?: string; name?: string } | null
  status: number
}

type Verdict = 'ok' | 'retry' | 'auth' | 'split' | 'stop'

function verdict(a: Answer): Verdict {
  if (!a.error) return 'ok'
  const code = a.error.code ?? ''
  const message = a.error.message ?? ''
  if (a.status === 0 || isUnreachable(a.error) || /^(TypeError|AbortError|TimeoutError|FetchError)\b/.test(message)) return 'retry'
  const fromDb = /^[0-9A-Z]{5}$/.test(code) && !code.startsWith('PGRST')
  if (code === '57014' || (!fromDb && a.status === 413)) return 'split'
  if (fromDb) return /^(08|40|53)/.test(code) ? 'retry' : 'stop'
  if (/^PGRST00[0-3]$/.test(code) || a.status === 408 || a.status === 429 || a.status >= 500) return 'retry'
  if (a.status === 401 || /^PGRST30[1-3]$/.test(code)) return 'auth'
  return 'stop'
}

/** one call, tried again (after 1, 3 and 9 seconds) while the failure is the connection's */
async function attempt(call: () => PromiseLike<Answer>, sleep: (ms: number) => Promise<void>): Promise<{ answer: Answer; verdict: Verdict }> {
  for (let n = 0; ; n++) {
    let answer: Answer
    try {
      answer = await call()
    } catch (e) {
      answer = { data: null, error: e as Answer['error'], status: 0 }
    }
    const v = verdict(answer)
    if ((v !== 'retry' && v !== 'auth') || n >= RETRY_MS.length) return { answer, verdict: v }
    await sleep(RETRY_MS[n])
  }
}

function problem(step: ImportStep, a: { answer: Answer; verdict: Verdict }): ImportProblem {
  const { error } = a.answer
  const table = step.kind === 'rows' || step.kind === 'remove' ? step.table : step.kind
  console.error('Sprawniej couldn’t finish the import', { table, part: step.kind === 'rows' ? step.part : step.kind, code: error?.code, details: error?.details ?? error?.message })
  if (a.verdict === 'retry') return new ImportProblem(NETWORK)
  if (a.verdict === 'auth') return new ImportProblem(SIGNED_OUT)
  const code = error?.code
  if (code === '23505') return new ImportProblem(table === 'issues' && !/linear_id/.test(error?.message ?? '') ? NUMBER_TAKEN : CHANGED)
  if (code === '42501' || code === '22023') return new ImportProblem(friendlyDbError(error, WENT_WRONG))
  return new ImportProblem(WENT_WRONG)
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** a delete on a table picked at run time (one row type per table can't be named here) */
interface Deleting extends PromiseLike<Answer> {
  eq(col: string, value: string): Deleting
  in(col: string, values: string[]): Deleting
}

/**
 * Sends the plan, step by step. `progress` hears how much is saved after every step. Returns how many rows
 * import_rows changed (0 when everything was already here). Throws ImportProblem when it stops partway.
 */
export async function runImport(
  db: Db,
  ws: string,
  plan: ImportPlan,
  progress: (saved: number, total: number) => void,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<number> {
  let saved = 0
  let changed = 0
  progress(0, plan.total)

  const sendRows = async (step: Extract<ImportStep, { kind: 'rows' }>, rows: Loose[]): Promise<number> => {
    const a = await attempt(() => db.rpc('import_rows', { p_ws: ws, p_table: step.table, p_rows: rows as Json }), sleep)
    if (a.verdict === 'ok') return Number(a.answer.data ?? 0)
    if (a.verdict === 'split' && rows.length > MIN_SPLIT) {
      const half = Math.ceil(rows.length / 2)
      return (await sendRows(step, rows.slice(0, half))) + (await sendRows(step, rows.slice(half)))
    }
    throw problem(step, a)
  }

  const from = (table: string) => (db as unknown as SupabaseClient).from(table).delete() as unknown as Deleting
  const removeKeys = async (step: Extract<ImportStep, { kind: 'remove' }>) => {
    const groups = new Map<string, { first?: [string, string]; col: string; values: string[] }>()
    for (const key of step.keys) {
      const cols = Object.keys(key)
      const last = cols[cols.length - 1]
      const first = cols.length > 1 ? ([cols[0], key[cols[0]]] as [string, string]) : undefined
      const id = first ? first.join('|') : ''
      const g = groups.get(id) ?? { first, col: last, values: [] }
      g.values.push(key[last])
      groups.set(id, g)
    }
    for (const g of groups.values()) {
      for (let n = 0; n < g.values.length; n += 100) {
        const ids = g.values.slice(n, n + 100)
        const a = await attempt(() => {
          let q = from(step.table).eq('workspace_id', ws)
          if (g.first) q = q.eq(g.first[0], g.first[1])
          return q.in(g.col, ids)
        }, sleep)
        if (a.verdict !== 'ok') throw problem(step, a)
      }
    }
  }

  for (const step of plan.steps) {
    if (step.kind === 'rows') changed += await sendRows(step, step.rows)
    else if (step.kind === 'remove') await removeKeys(step)
    else if (step.kind === 'email') {
      const a = await attempt(() => db.rpc('set_guest_email', { p_profile: step.profile, p_email: step.email }), sleep)
      if (a.verdict !== 'ok') throw problem(step, a)
    } else {
      const a = await attempt(() => db.rpc('link_person', { p_ws: ws, p_guest: step.guest, p_to: step.to }), sleep)
      // already linked: an earlier try got this far, only its answer was lost
      if (a.verdict !== 'ok' && a.answer.error?.code !== 'P0002') throw problem(step, a)
    }
    saved += stepSize(step)
    progress(saved, plan.total)
  }
  return changed
}
