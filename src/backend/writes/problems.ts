/**
 * What a failed save means, and what the person reads. Pure, so every case is tested (tests/transport.test.ts).
 *
 * - network: no answer, or a busy or broken connection. Tried again; only the chip says so.
 * - auth: the sign-in ran out. Tried again (the client gets a new one); the chip says "Signed out" meanwhile.
 * - refused: the rules said no. Undone, with a message.
 * - gone: what it was about was deleted meanwhile. Undone, with a message (quiet when you deleted it yourself).
 * - bug: something we didn't expect. Undone, with a message, and written to the console.
 *
 * No message says database, server, row or sync (CLAUDE.md, writing).
 */
import { ownWords } from '../problem'

export type ProblemKind = 'network' | 'auth' | 'refused' | 'gone' | 'bug'
export interface Problem {
  kind: ProblemKind
  /** what the person reads ('' for network and auth: the chip says it) */
  message: string
}

/** an error as the database client gives it */
export interface ErrorLike {
  code?: string
  message?: string
  name?: string
}

/** what was being saved */
export interface What {
  table: string
  op: 'insert' | 'update' | 'delete' | 'call' | 'notes'
}

export const MESSAGES = {
  comment: 'Only the person who wrote a comment can change or delete it, so your change was undone.',
  deleteTeam: 'Only admins and owners can delete a team.',
  renameWorkspace: 'Only admins and owners can rename the workspace.',
  refused: "You can't change this, so your change was undone.",
  gone: "It was deleted meanwhile, so your change wasn't saved.",
  goneIssue: "This issue was deleted meanwhile, so your change wasn't saved.",
  goneComment: "This issue was deleted meanwhile, so your comment wasn't saved.",
  goneEditedComment: "This comment was deleted meanwhile, so your change wasn't saved.",
  goneLabel: "This label was deleted meanwhile, so your change wasn't saved.",
  goneLabelAdded: "This label was deleted meanwhile, so it wasn't added.",
  goneProject: "This project was deleted meanwhile, so your change wasn't saved.",
  goneView: "This view was deleted meanwhile, so your change wasn't saved.",
  goneTeam: "This team was deleted meanwhile, so your change wasn't saved.",
  labelName: "There's already a label with this name.",
  teamKey: 'Another team already uses this key.',
  notSaved: "This change couldn't be saved, so it was undone.",
  bug: 'Something went wrong, so this change was undone.',
} as const

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])
/** the constraint a Postgres error names: duplicate key value violates unique constraint "labels_name" */
export const constraintOf = (message: string | undefined): string | undefined => /constraint "([^"]+)"/.exec(message ?? '')?.[1]

/** the rules said no: an update or delete that came back empty while the row is still there */
export function refusedMessage(what: What): string {
  if (what.table === 'comments') return MESSAGES.comment
  if (what.table === 'teams' && what.op === 'delete') return MESSAGES.deleteTeam
  if (what.table === 'workspaces') return MESSAGES.renameWorkspace
  return MESSAGES.refused
}

/** what a row of each table is about, when it's gone */
const GONE: Record<string, string> = {
  issues: MESSAGES.goneIssue,
  issue_followers: MESSAGES.goneIssue,
  comments: MESSAGES.goneEditedComment,
  labels: MESSAGES.goneLabel,
  issue_labels: MESSAGES.goneLabelAdded,
  projects: MESSAGES.goneProject,
  project_teams: MESSAGES.goneProject,
  views: MESSAGES.goneView,
  teams: MESSAGES.goneTeam,
  team_members: MESSAGES.goneTeam,
}

/** the column a foreign key error names ("issue_labels_workspace_id_label_id_fkey"), as the thing that went */
const POINTS_AT: [RegExp, string][] = [
  [/_label_id_fkey$/, MESSAGES.goneLabelAdded],
  [/_project_id_fkey$/, MESSAGES.goneProject],
  [/_team_id_fkey$/, MESSAGES.goneTeam],
  [/_(issue_id|parent_id|duplicate_of)_fkey$/, MESSAGES.goneIssue],
]

/**
 * Something this change is about was deleted meanwhile, named for what it was. `constraint`: the foreign key that
 * said so, when there is one (a comment on an issue that went names the issue, not the comment).
 */
export function goneMessage(what: What, constraint?: string): string {
  if (what.table === 'comments' && what.op === 'insert') return MESSAGES.goneComment
  for (const [re, message] of POINTS_AT) if (constraint && re.test(constraint)) return message
  // a new issue in a team that went ("There is no such team.")
  if (what.table === 'issues' && what.op === 'insert') return MESSAGES.goneTeam
  return GONE[what.table] ?? MESSAGES.gone
}


export function classify(error: ErrorLike | null | undefined, status: number, what: What): Problem {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  if (status === 0 || error?.name === 'AbortError' || error?.name === 'TimeoutError' || /^(TypeError|AbortError|TimeoutError)\b/.test(message)) {
    return { kind: 'network', message: '' }
  }
  // the database's own code says more than the status (it answers "There is no such issue." with a 500)
  const fromDb = /^[0-9A-Z]{5}$/.test(code) && !code.startsWith('PGRST')
  // its connection, a timeout, a busy moment, two changes that crossed: worth another try
  if (fromDb && /^(08|40|53|57)/.test(code)) return { kind: 'network', message: '' }
  if ((!fromDb && RETRY_STATUS.has(status)) || /^PGRST00[0-3]$/.test(code)) return { kind: 'network', message: '' }
  if ((!fromDb && status === 401) || /^PGRST30[1-3]$/.test(code)) return { kind: 'auth', message: '' }
  if (code === '23503' || code === 'P0002') return { kind: 'gone', message: goneMessage(what, constraintOf(message)) }
  if (code === '23505') {
    const name = constraintOf(message)
    if (name === 'labels_name') return { kind: 'refused', message: MESSAGES.labelName }
    if (name === 'teams_workspace_id_key_key') return { kind: 'refused', message: MESSAGES.teamKey }
  }
  if (code === '42501') return { kind: 'refused', message: ownWords(message) ?? MESSAGES.refused }
  if (['23505', '23514', '23502', 'P0001'].includes(code) || /^(22|SP)/.test(code)) {
    return { kind: 'refused', message: ownWords(message) ?? MESSAGES.notSaved }
  }
  return { kind: 'bug', message: MESSAGES.bug }
}
