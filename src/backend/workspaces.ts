/** The workspaces you are in, making a new one, and who is in one: invites, members and roles. */
import type { TeamDraft } from '@/model/teamDraft'
import { requireClient, type Db } from './client'
import { friendlyDbError, isUnreachable, UNREACHABLE } from './problem'

export interface WorkspaceInfo {
  id: string
  name: string
  createdAt: string
}

/** the database rules show only the workspaces you are in */
export async function myWorkspaces(): Promise<WorkspaceInfo[]> {
  const { data, error } = await requireClient().from('workspaces').select('id,name,created_at').order('name')
  if (error) throw error
  return data.map((w) => ({ id: w.id, name: w.name, createdAt: w.created_at }))
}

/** a new workspace with you as its owner and its first team; returns its id (`db`: the database tests' own) */
export async function createWorkspace(name: string, team: TeamDraft, db: Db = requireClient()): Promise<string> {
  const { data, error } = await db.rpc('create_workspace', {
    p_name: name.trim(),
    p_team_key: team.key,
    p_team_name: team.name.trim(),
    p_team_emoji: team.emoji,
  })
  if (error) throw error
  return data
}

// ---------- invites, members and roles ----------
// These are awaited calls, not changes for the writer: they are rare, the database rules word their refusals
// precisely, and nothing should flicker back on a refusal. The store follows from the database's own echo.

export type Role = 'owner' | 'admin' | 'member'
export type InviteRole = 'admin' | 'member'
export type InviteState = 'open' | 'used' | 'expired' | 'member'

export interface InviteInfo {
  /** only when state is 'member' (you're already in) */
  workspaceId: string | null
  workspaceName: string
  invitedBy: { name: string; login: string | null; avatarUrl: string } | null
  /** the invite is for this person from Linear */
  forName: string | null
  role: InviteRole
  state: InviteState
  people: { name: string; avatarUrl: string }[]
}

const STATES: readonly string[] = ['open', 'used', 'expired', 'member']
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** a row of invite_info as the join page uses it (nulls kept: the generated types call every column a string) */
export function toInviteInfo(row: Record<string, unknown>): InviteInfo {
  const people = Array.isArray(row.people)
    ? row.people.flatMap((p: unknown) => {
        const x = (p ?? {}) as { name?: unknown; avatarUrl?: unknown }
        return typeof x.name === 'string' ? [{ name: x.name, avatarUrl: typeof x.avatarUrl === 'string' ? x.avatarUrl : '' }] : []
      })
    : []
  const by = text(row.invited_by_name) ?? text(row.invited_by_login)
  return {
    workspaceId: text(row.workspace_id),
    workspaceName: text(row.workspace_name) ?? '',
    invitedBy: by ? { name: by, login: text(row.invited_by_login), avatarUrl: text(row.invited_by_avatar) ?? '' } : null,
    forName: text(row.for_name),
    role: row.role === 'admin' ? 'admin' : 'member',
    // something new from a later version: treat it as a link that can't be used
    state: STATES.includes(String(row.state)) ? (row.state as InviteState) : 'used',
    people,
  }
}

/** null: no such invite (deleted, mistyped, or its person from Linear was linked meanwhile). Works signed out too. */
export async function inviteInfo(token: string): Promise<InviteInfo | null> {
  const { data, error } = await requireClient().rpc('invite_info', { p_token: token }).maybeSingle()
  if (error) throw error
  return data ? toInviteInfo(data) : null
}

export type JoinProblem = 'used' | 'expired' | 'unknown' | 'network' | 'other'

export class InviteError extends Error {
  readonly kind: JoinProblem
  constructor(kind: JoinProblem, message: string) {
    super(message)
    this.kind = kind
  }
}

/** what went wrong with joining, in plain words */
export function inviteProblem(e: unknown): InviteError {
  if (e instanceof InviteError) return e
  const code = (e as { code?: unknown } | null)?.code
  if (isUnreachable(e)) return new InviteError('network', UNREACHABLE)
  if (code === 'SP002') return new InviteError('used', 'This invite was already used. Ask for a new one.')
  if (code === 'SP003') return new InviteError('expired', 'This invite has expired. Ask for a new one.')
  if (code === 'P0002') return new InviteError('unknown', "This invite link doesn't work. Ask for a new one.")
  return new InviteError('other', friendlyDbError(e, "We couldn't add you to the workspace. Try again in a moment."))
}

/** makes you a member; returns the workspace's id. Throws an InviteError. */
export async function acceptInvite(token: string): Promise<string> {
  try {
    const { data, error } = await requireClient().rpc('accept_invite', { p_token: token })
    if (error || !data) throw inviteProblem(error)
    return data
  } catch (e) {
    throw inviteProblem(e)
  }
}

export interface Invite {
  id: string
  token: string
  role: InviteRole
  forProfile: string | null
  forEmail: string | null
  invitedBy: string | null
  createdAt: string
  expiresAt: string
}

const INVITE_COLUMNS = 'id,token,role,for_profile,for_email,invited_by,created_at,expires_at'

interface InviteRow {
  id: string
  token: string
  role: string
  for_profile: string | null
  for_email: string | null
  invited_by: string | null
  created_at: string
  expires_at: string
}

const toInvite = (r: InviteRow): Invite => ({
  id: r.id,
  token: r.token,
  role: r.role === 'admin' ? 'admin' : 'member',
  forProfile: r.for_profile,
  forEmail: r.for_email,
  invitedBy: r.invited_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
})

/** links not used yet (expired ones too), newest first; empty for members (the rules show them to admins only) */
export async function listInvites(ws: string): Promise<Invite[]> {
  const { data, error } = await requireClient()
    .from('invites')
    .select(INVITE_COLUMNS)
    .eq('workspace_id', ws)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map(toInvite)
}

/** throws an Error whose message can be shown as it is */
export async function createInvite(ws: string, o: { role: InviteRole; forProfile?: string; forEmail?: string }): Promise<Invite> {
  const { data, error } = await requireClient()
    .from('invites')
    .insert({ workspace_id: ws, role: o.role, for_profile: o.forProfile ?? null, for_email: o.forEmail?.trim() || null })
    .select(INVITE_COLUMNS)
    .single()
  if (error?.code === '42501') throw new Error('Only admins and owners can invite people.')
  if (error || !data) throw new Error(friendlyDbError(error, "We couldn't make the link. Try again in a moment."))
  return toInvite(data)
}

/** throws an Error whose message can be shown as it is */
export async function deleteInvite(id: string): Promise<void> {
  const { data, error } = await requireClient().from('invites').delete().eq('id', id).select('id')
  if (error) throw new Error(friendlyDbError(error, "We couldn't delete the link. Try again in a moment."))
  if (!data.length) throw new Error('That link was already deleted.')
}

const DAY = 86_400_000

/** "expires today", "expires tomorrow", "expires in 3 days", "expired" (by calendar days here) */
export function expiresText(expiresAt: string, now: number): string {
  const at = Date.parse(expiresAt)
  if (!(at >= now)) return 'expired'
  const startOf = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((startOf(at) - startOf(now)) / DAY)
  return days <= 0 ? 'expires today' : days === 1 ? 'expires tomorrow' : `expires in ${days} days`
}

export const isExpired = (i: Pick<Invite, 'expiresAt'>, now: number): boolean => Date.parse(i.expiresAt) < now

export const NOT_ADMIN = 'Only admins and owners can change roles or remove people.'

async function changeMember(ws: string, profileId: string, patch: { role?: Role; removed_at?: string }): Promise<void> {
  const { data, error } = await requireClient()
    .from('workspace_members')
    .update(patch)
    .eq('workspace_id', ws)
    .eq('profile_id', profileId)
    .select('role,removed_at')
  if (error) throw new Error(friendlyDbError(error, "That change couldn't be made. Try again in a moment."))
  // the rules let only admins and owners change anyone: for others nothing changes, and there is no error
  if (!data.length) throw new Error(NOT_ADMIN)
}

/** admins and owners; refusals come back in the rules' own words */
export const setMemberRole = (ws: string, profileId: string, role: Role): Promise<void> => changeMember(ws, profileId, { role })

export const removeMember = (ws: string, profileId: string): Promise<void> => changeMember(ws, profileId, { removed_at: new Date().toISOString() })

/** throws an Error whose message can be shown as it is (the last owner can't leave) */
export async function leaveWorkspace(ws: string): Promise<void> {
  const { error } = await requireClient().rpc('leave_workspace', { p_ws: ws })
  if (error) throw new Error(friendlyDbError(error, "We couldn't take you out of the workspace. Try again in a moment."))
}

/** a person from Linear is this member: everything of theirs moves over */
export async function linkPerson(ws: string, guestId: string, toId: string): Promise<void> {
  const { error } = await requireClient().rpc('link_person', { p_ws: ws, p_guest: guestId, p_to: toId })
  if (error) throw new Error(friendlyDbError(error, "We couldn't link them. Try again in a moment."))
}

/** the emails people from Linear had there, by profile id (admins only; empty for others) */
export async function guestEmails(ws: string): Promise<Record<string, string>> {
  const { data, error } = await requireClient().rpc('guest_emails', { p_ws: ws })
  if (error) throw error
  return Object.fromEntries(data.map((r) => [r.profile_id, r.email]))
}
