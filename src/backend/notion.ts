/**
 * The workspace's Notion connection: pages sent from Notion become issues (Settings › Notion, admins only;
 * docs/notion.md). Like the GitHub repositories, these are awaited calls, read when Settings opens: they aren't live.
 * The secret in the address is shown once, when it's made; only its sha256 is kept, so it can't be read again.
 */
import { backendConfig, requireClient } from './client'
import { friendlyDbError } from './problem'
import { registry } from './registry'
import { RULES } from './workspaces'

/** what happened with the latest page (notion_apply writes it) */
export interface LastPage {
  /** the page's title, when it said */
  title: string
  /** the issue it became, or already was */
  ref: string | null
  /** a new issue; false: the page had made it before */
  isNew: boolean
  /** the author's login, when they are a member */
  author: string | null
  /** nothing was made: no team to put it in, or too many pages at once */
  problem: 'team' | 'busy' | null
}

export interface NotionConnection {
  id: string
  /** where pages become issues; null once that team was deleted */
  teamId: string | null
  /** that team's key, when this workspace knows it */
  teamKey: string | null
  addedBy: string | null
  createdAt: string
  /** when the address was made or last replaced */
  secretSetAt: string
  lastAt: string | null
  last: LastPage | null
}

/** never the secret's hash: there is no use for it here */
const COLUMNS = 'id, team_id, added_by, created_at, secret_set_at, last_event_at, last_event'

/** reads what notion_apply wrote, whatever shape it has */
export function readLast(v: unknown): LastPage | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  return {
    title: typeof e.title === 'string' ? e.title : '',
    ref: typeof e.ref === 'string' ? e.ref : null,
    isNew: e.new === true,
    author: typeof e.author === 'string' ? e.author : null,
    problem: e.problem === 'team' || e.problem === 'busy' ? e.problem : null,
  }
}

/** the address to paste into Notion's "Send webhook": the function's, with the connection and its secret */
export function notionAddress(base: string, id: string, secret: string): string {
  return `${base.replace(/\/+$/, '')}/functions/v1/notion-webhook?c=${encodeURIComponent(id)}&k=${encodeURIComponent(secret)}`
}

const addressOf = (id: string, secret: string) => notionAddress(backendConfig()?.url ?? '', id, secret)

/** errors in words that can be shown as they are */
function problem(error: { code?: string } | null, fallback: string): Error {
  if (error?.code === '42501') return new Error(RULES.notNotion)
  if (error?.code === '23505') return new Error('Notion is already connected.')
  if (error?.code === '23503') return new Error('That team is gone. Pick another.')
  if (error?.code === 'P0002') return new Error('Notion isn’t connected.')
  return new Error(friendlyDbError(error, fallback))
}

/** null when Notion isn't connected, and for members (the rules show it to admins only) */
export async function getNotion(ws: string): Promise<NotionConnection | null> {
  const { data, error } = await requireClient().from('notion_connections').select(COLUMNS).eq('workspace_id', ws).maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id,
    teamId: data.team_id,
    teamKey: (data.team_id && registry.teamKey(data.team_id)) || null,
    addedBy: data.added_by,
    createdAt: data.created_at,
    secretSetAt: data.secret_set_at,
    lastAt: data.last_event_at,
    last: readLast(data.last_event),
  }
}

/** connects the workspace; gives the address, which can't be read again. Throws an Error whose message can be shown. */
export async function connectNotion(ws: string, teamId: string): Promise<{ id: string; address: string }> {
  const { data, error } = await requireClient().rpc('notion_connect', { p_workspace: ws, p_team: teamId })
  const made = data as { id?: unknown; secret?: unknown } | null
  if (error || typeof made?.id !== 'string' || typeof made.secret !== 'string') {
    throw problem(error, "We couldn't connect Notion. Try again in a moment.")
  }
  return { id: made.id, address: addressOf(made.id, made.secret) }
}

/** a new address; the old one stops working. Throws an Error whose message can be shown. */
export async function newNotionAddress(id: string): Promise<string> {
  const { data, error } = await requireClient().rpc('notion_new_secret', { p_connection: id })
  if (error || typeof data !== 'string') throw problem(error, "We couldn't make a new address. Try again in a moment.")
  return addressOf(id, data)
}

/** throws an Error whose message can be shown as it is */
export async function setNotionTeam(id: string, teamId: string): Promise<void> {
  const { data, error } = await requireClient().from('notion_connections').update({ team_id: teamId }).eq('id', id).select('id')
  if (error) throw problem(error, "We couldn't change the team. Try again in a moment.")
  if (!data.length) throw new Error('Notion isn’t connected.')
}

/** throws an Error whose message can be shown as it is */
export async function disconnectNotion(id: string): Promise<void> {
  const { data, error } = await requireClient().from('notion_connections').delete().eq('id', id).select('id')
  if (error) throw problem(error, "We couldn't disconnect Notion. Try again in a moment.")
  if (!data.length) throw new Error('Notion was already disconnected.')
}
