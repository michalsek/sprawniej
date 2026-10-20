/**
 * The Edge Function `notion-webhook`: one page sent from Notion in, one issue out (docs/notion.md). It talks to the
 * database only through the two functions only it may call (notion_lookup, notion_apply), with `fetch`, so tests hand
 * it a pretend one (tests/notion.test.ts). server.ts starts it in Supabase.
 *
 * Notion pauses an automation when an answer isn't 2xx. So "nothing to do" (a page sent before, a page in the trash)
 * is 200, and what someone has to fix (an old address, no team, too many pages) is not, so Notion shows "!".
 * Nothing here logs the address (it holds the key), the headers, the body, titles or emails.
 */
import { generateKeyBetween } from 'fractional-indexing'
import { ulid } from 'ulid'
import { plainName } from '@/lib/plain'
import { UUID } from '@/model/notion'
import { keyFrom, sha256Hex } from './key'
import { notesFor } from './notes'
import { hintsFrom, issueFromPage, readPage, type Page, type PageHints, type PageIssue } from './page'

export interface Env {
  /** the project's address and its service key, which Supabase gives every function */
  url: string | undefined
  key: string | undefined
  fetch?: typeof fetch
}

/** a page's properties are a few kB */
export const MAX_BODY = 1_000_000

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** what notion_lookup says */
export type Lookup =
  | { state: 'unknown' | 'wrong_key' }
  | {
      state: 'ok'
      connection: string
      workspace: string
      /** where the page goes, with the first place in its list (null: the team is gone) */
      team: { id: string; key: string; first_sort: string | null } | null
      /** the workspace's members now */
      people: { id: string; login: string }[]
      /** the members whose sign-in email the page names */
      emails: { email: string; profile_id: string }[]
      labels: { id: string; name: string }[]
    }

/** what notion_apply says */
type Applied = { issue: string; new: boolean; archived?: boolean } | { problem: 'team' | 'busy' }

/** a database call that failed, with Postgres's code (never its details: they can hold the page's title) */
class DbError extends Error {
  readonly code: string
  constructor(fn: string, status: number, code: string, message: string) {
    super(`${fn}: ${status} ${code} ${message}`.trim())
    this.code = code
  }
}

const WRONG_KEY = 'This address was replaced. Paste the new one from Settings › Notion.'

/** a place before every issue in the team, as a new issue made in the app gets */
function topOf(first: string | null): string {
  try {
    return generateKeyBetween(null, first)
  } catch {
    // a key fractional-indexing can't read (written by hand): the start will do
    return generateKeyBetween(null, null)
  }
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'This address takes pages from Notion (Send webhook).' })
  const connection = new URL(req.url).searchParams.get('c')
  if (!connection || !UUID.test(connection)) return json(404, { error: "This isn't a Sprawniej address for Notion." })
  const key = keyFrom(req)
  if (!key) return json(401, { error: 'This address is missing its key. Make a new one in Settings › Notion.' })
  if (!env.url || !env.key) return json(500, { error: 'The project settings are missing.' })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, { error: 'Too big.' })
  const body = new Uint8Array(await req.arrayBuffer())
  if (body.length > MAX_BODY) return json(413, { error: 'Too big.' })

  let payload: unknown = null
  try {
    payload = JSON.parse(new TextDecoder().decode(body))
  } catch {
    // said after the key is checked, so a stranger learns nothing
  }
  // only who and where before the key is checked: the rest (the description) is built once it's right
  let page: Page | null = null
  let hints: PageHints | null = null
  try {
    page = readPage(payload)
    hints = page && hintsFrom(page)
  } catch {
    // a page shaped like nothing Notion sends: "not a page", once the key is checked
    page = null
  }
  const notAPage = () => {
    console.log('notion', { refused: 'not a page' })
    return json(400, { error: "That isn't a Notion page." })
  }

  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const headers: Record<string, string> = { apikey: env.key ?? '', 'Content-Type': 'application/json' }
    // the older service role key is a JWT; the newer secret key goes as the apikey alone
    if (env.key?.startsWith('eyJ')) headers.Authorization = `Bearer ${env.key}`
    const res = await (env.fetch ?? fetch)(`${env.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) })
    if (!res.ok) {
      // the code and message only: the details can hold the page's title
      const e = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
      throw new DbError(fn, res.status, e.code ?? '', e.message ?? '')
    }
    return (await res.json()) as T
  }

  const hash = await sha256Hex(key)
  const found = await call<Lookup>('notion_lookup', {
    p_connection: connection,
    p_secret_hash: hash,
    p_emails: hints?.emails ?? [],
    p_team: hints?.teamHint ?? null,
  })
  if (found.state === 'unknown') return json(404, { error: "This address doesn't work any more: Notion was disconnected in Settings." })
  if (found.state !== 'ok') return json(401, { error: WRONG_KEY })
  if (!page || !hints) return notAPage()
  if (page.trashed) {
    console.log('notion', { skipped: 'trash' })
    return json(200, { skipped: 'The page is in the trash.' })
  }
  let fields: PageIssue
  try {
    fields = issueFromPage(page)
  } catch {
    return notAPage()
  }

  const member = new Map(found.emails.map((e) => [e.email.toLowerCase(), e.profile_id]))
  const actor = (fields.authorEmail && member.get(fields.authorEmail)) || null
  const assignee = fields.assigneeEmails.map((e) => member.get(e)).find((id) => !!id) ?? null
  const wanted = new Set(fields.labelNames.map(plainName))
  const labels = found.labels.filter((l) => wanted.has(plainName(l.name))).map((l) => l.id)

  const apply = call<Applied>('notion_apply', {
    p_connection: connection,
    p_secret_hash: hash,
    p_page: { id: page.id, url: page.url },
    p_actor: actor,
    p_issue: {
      id: ulid(),
      // no team: the database says so to Settings
      team_id: found.team?.id ?? null,
      title: fields.title,
      description: fields.description,
      status: fields.status,
      priority: fields.priority,
      assignee_id: assignee,
      due_date: fields.dueDate,
      sort_order: topOf(found.team?.first_sort ?? null),
      labels,
    },
    p_notes: notesFor({ description: fields.description, assignee, actor, people: found.people }),
  })
  let r: Applied
  try {
    r = await apply
  } catch (e) {
    // the address was replaced between the two calls: as for a wrong key. Anything else (the author left meanwhile)
    // fails, and resuming the automation sends the page again.
    if (e instanceof DbError && e.code === '42501' && /replaced/.test(e.message)) return json(401, { error: WRONG_KEY })
    throw e
  }
  if ('problem' in r) {
    console.log('notion', { problem: r.problem })
    return r.problem === 'team'
      ? json(409, { error: 'Pick a team for Notion pages in Settings › Notion.' })
      : json(429, { error: 'Too many pages at once. Resume the automation in a few minutes.' })
  }
  console.log('notion', { issue: r.issue, new: r.new })
  return json(200, { issue: r.issue, new: r.new })
}
