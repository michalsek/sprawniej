/** The workspaces you are in, making a new one, and who is in one: invites, members and roles. */
import { isRole, type Role } from '@/model/schema'
import type { TeamDraft } from '@/model/teamDraft'
import { useSession } from '@/session'
import { pruneCaches } from './cacheStore'
import { requireClient, type Db } from './client'
import { friendlyDbError, isUnreachable, UNREACHABLE } from './problem'

export interface WorkspaceInfo {
  id: string
  name: string
  createdAt: string
}

/** the database rules show only the workspaces you are in; the copies kept of the others go from this browser */
export async function myWorkspaces(): Promise<WorkspaceInfo[]> {
  const { data, error } = await requireClient().from('workspaces').select('id,name,created_at').order('name')
  if (error) throw error
  const me = useSession.getState().profileId
  if (me) void pruneCaches(me, data.map((w) => w.id))
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

export type { Role }
export type InviteRole = Exclude<Role, 'owner'>
const INVITE_STATES = ['open', 'used', 'ended', 'full', 'expired', 'left', 'member'] as const
export type InviteState = (typeof INVITE_STATES)[number]
const isInviteState = (v: unknown): v is InviteState => (INVITE_STATES as readonly unknown[]).includes(v)
/** invites are for admins and members; owners are made in Settings */
const inviteRole = (v: unknown): InviteRole => (isRole(v) && v !== 'owner' ? v : 'member')

const DAY = 86_400_000

/** how long a link works (the database's default) */
export const INVITE_DAYS = 14
/** the database takes 30 days after a link is made; 28 leaves room for a clock that is a little off */
export const MAX_INVITE_DAYS = 28
/** "up to N people": the most the app offers (the database takes up to 1000) */
export const MAX_INVITE_PEOPLE = 100

/**
 * The rules' own words (guard_members and keep_an_owner in supabase/migrations/20261019000003_triggers.sql, which
 * tests/roles.test.ts checks), and ours for what the rules refuse without words.
 */
export const RULES = {
  notAdmin: 'Only admins and owners can change roles or remove people.',
  owners: 'Only an owner can change who owns the workspace.',
  ownRole: "You can't change your own role.",
  lastOwner: 'A workspace needs at least one owner. Make someone else an owner first.',
  notInviter: 'Only admins and owners can invite people.',
  notEnder: 'Only admins and owners can end invite links.',
  notLinker: 'Only admins and owners can link people.',
  notGitHub: 'Only admins and owners can connect repositories.',
  notNotion: 'Only admins and owners can connect Notion.',
}

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
    role: inviteRole(row.role),
    // something new from a later version: treat it as a link that can't be used
    state: isInviteState(row.state) ? row.state : 'used',
    people,
  }
}

/** null: no such invite (deleted, mistyped, or its person from Linear was linked meanwhile). Works signed out too. */
export async function inviteInfo(token: string): Promise<InviteInfo | null> {
  const { data, error } = await requireClient().rpc('invite_info', { p_token: token }).maybeSingle()
  if (error) throw error
  return data ? toInviteInfo(data) : null
}

export type JoinProblem = 'used' | 'ended' | 'full' | 'expired' | 'left' | 'unknown' | 'network' | 'other'

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
  if (code === 'SP006') return new InviteError('ended', 'This invite link was ended. Ask for a new one.')
  if (code === 'SP007') return new InviteError('full', 'This invite link is full. Ask for a new one.')
  if (code === 'SP008') return new InviteError('left', 'This link was made before you left. Ask for a new one.')
  if (code === 'P0002') return new InviteError('unknown', "This invite link doesn't work. Ask for a new one.")
  return new InviteError('other', friendlyDbError(e, "We couldn't add you to the workspace. Try again in a moment."))
}

/** makes you a member; returns the workspace's id. Throws an InviteError. */
export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await requireClient()
    .rpc('accept_invite', { p_token: token })
    .then(
      (r) => r,
      (e: unknown) => ({ data: null, error: e }),
    )
  if (error || !data) throw inviteProblem(error)
  return data
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
  /** how many people may join with it: 1 is one person, null anyone with the link */
  maxUses: number | null
  /** an admin ended it early */
  endedAt: string | null
  /** who joined with it, and when */
  uses: { profileId: string; at: string }[]
}

const INVITE_COLUMNS = 'id,token,role,for_profile,for_email,invited_by,created_at,expires_at,max_uses,ended_at,invite_uses(profile_id,at)'

interface InviteRow {
  id: string
  token: string
  role: string
  for_profile: string | null
  for_email: string | null
  invited_by: string | null
  created_at: string
  expires_at: string
  max_uses: number | null
  ended_at: string | null
  invite_uses: { profile_id: string; at: string }[]
}

const toInvite = (r: InviteRow): Invite => ({
  id: r.id,
  token: r.token,
  role: inviteRole(r.role),
  forProfile: r.for_profile,
  forEmail: r.for_email,
  invitedBy: r.invited_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  maxUses: r.max_uses,
  endedAt: r.ended_at,
  uses: r.invite_uses.map((u) => ({ profileId: u.profile_id, at: u.at })),
})

/**
 * links not used up yet (ended, full and expired ones too; a link for one person goes once it is accepted), newest
 * first; empty for members (the rules show them to admins only)
 */
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

/** a whole number of days from 1 to MAX_INVITE_DAYS (anything else is brought into that range; not a number: 14) */
export function expiresAtFor(days: number, now: number): string {
  const n = Number.isFinite(days) ? Math.min(MAX_INVITE_DAYS, Math.max(1, Math.round(days))) : INVITE_DAYS
  return new Date(now + n * DAY).toISOString()
}

/** null (anyone with the link) or a whole number of people from 1 to MAX_INVITE_PEOPLE */
export const maxUsesFor = (n: number | null): number | null =>
  n === null ? null : Number.isFinite(n) ? Math.min(MAX_INVITE_PEOPLE, Math.max(1, Math.round(n))) : 1

/**
 * `days`: how long it works (14 unless given); `maxUses`: how many people (1 unless given, null for anyone). A link for
 * a person from Linear is always for one person. Throws an Error whose message can be shown as it is.
 */
export async function createInvite(
  ws: string,
  o: { role: InviteRole; forProfile?: string; forEmail?: string; days?: number; maxUses?: number | null },
): Promise<Invite> {
  const email = o.forEmail?.trim()
  const { data, error } = await requireClient()
    .from('invites')
    .insert({
      workspace_id: ws,
      role: o.role,
      for_profile: o.forProfile ?? null,
      for_email: email ? email : null,
      // the database's clock sets the usual length; another one comes from here
      ...(o.days !== undefined && o.days !== INVITE_DAYS && { expires_at: expiresAtFor(o.days, Date.now()) }),
      max_uses: o.forProfile ? 1 : maxUsesFor(o.maxUses === undefined ? 1 : o.maxUses),
    })
    .select(INVITE_COLUMNS)
    .single()
  if (error?.code === '42501') throw new Error(RULES.notInviter)
  if (error || !data) throw new Error(friendlyDbError(error, "We couldn't make the link. Try again in a moment."))
  return toInvite(data)
}

/** throws an Error whose message can be shown as it is */
export async function deleteInvite(id: string): Promise<void> {
  const { data, error } = await requireClient().from('invites').delete().eq('id', id).select('id')
  if (error) throw new Error(friendlyDbError(error, "We couldn't delete the link. Try again in a moment."))
  if (!data.length) throw new Error('That link was already deleted.')
}

/** ends a link now; nobody new can join with it. Throws an Error whose message can be shown as it is. */
export async function endInvite(id: string): Promise<void> {
  const { error } = await requireClient().rpc('end_invite', { p_invite: id })
  if (error) throw new Error(friendlyDbError(error, "We couldn't end the link. Try again in a moment."))
}

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

const isExpired = (i: Pick<Invite, 'expiresAt'>, now: number): boolean => Date.parse(i.expiresAt) < now

/** whether a listed link still works, and if not, why (as the database decides, private.invite_state) */
export function inviteState(
  i: Pick<Invite, 'endedAt' | 'expiresAt' | 'maxUses' | 'uses'>,
  now: number,
): 'open' | 'used' | 'ended' | 'full' | 'expired' {
  if (i.maxUses === 1 && i.uses.length > 0) return 'used'
  if (i.endedAt) return 'ended'
  if (i.maxUses !== null && i.uses.length >= i.maxUses) return 'full'
  return isExpired(i, now) ? 'expired' : 'open'
}

async function changeMember(ws: string, profileId: string, patch: { role?: Role; removed_at?: string }): Promise<void> {
  const { data, error } = await requireClient()
    .from('workspace_members')
    .update(patch)
    .eq('workspace_id', ws)
    .eq('profile_id', profileId)
    .select('role,removed_at')
  if (error) throw new Error(friendlyDbError(error, "That change couldn't be made. Try again in a moment."))
  // the rules let only admins and owners change anyone: for others nothing changes, and there is no error
  if (!data.length) throw new Error(RULES.notAdmin)
}

/** admins and owners; refusals come back in the rules' own words */
export const setMemberRole = (ws: string, profileId: string, role: Role): Promise<void> => changeMember(ws, profileId, { role })

/** when is the database's time (guard_members): 'now' is read by the database, not this browser's clock */
export const removeMember = (ws: string, profileId: string): Promise<void> => changeMember(ws, profileId, { removed_at: 'now' })

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
