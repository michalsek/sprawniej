/**
 * The Edge Function `github-webhook`: one delivery from GitHub in, the issues it mentions moved (docs/github-app.md).
 * It talks to the database only through the two functions only it may call (github_lookup, github_apply), with
 * `fetch`, so tests hand it a pretend one (tests/github.test.ts). server.ts starts it in Supabase.
 */
import { ulid } from 'ulid'
import { findRefs, movesFor, moveFor, notesFor, signatureOk, type Lookup } from './webhook'

export interface Env {
  /** the webhook secret GitHub signs with (`supabase secrets set GITHUB_WEBHOOK_SECRET=…`) */
  secret: string | undefined
  /** the project's address and its service key, which Supabase gives every function */
  url: string | undefined
  key: string | undefined
  fetch?: typeof fetch
}

/** GitHub sends up to 25 MB; a pull request event is a few kB */
export const MAX_BODY = 1_000_000

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Payload {
  action?: string
  pull_request?: {
    number?: number
    html_url?: string
    title?: string | null
    body?: string | null
    draft?: boolean
    merged?: boolean
    state?: string
    user?: { id?: number; login?: string }
    head?: { ref?: string }
  }
  changes?: Record<string, unknown>
  repository?: { id?: number; full_name?: string }
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'GitHub sends POST.' })
  if (!env.secret || !env.url || !env.key) return json(500, { error: 'The webhook secret or the project settings are missing.' })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, { error: 'Too big.' })
  const body = new Uint8Array(await req.arrayBuffer())
  if (body.length > MAX_BODY) return json(413, { error: 'Too big.' })
  if (!(await signatureOk(env.secret, body, req.headers.get('x-hub-signature-256')))) return json(401, { error: 'Wrong signature.' })

  const event = req.headers.get('x-github-event')
  if (event === 'ping') return json(200, { ok: true })
  if (event !== 'pull_request') return json(200, { ignored: event })

  let p: Payload
  try {
    p = JSON.parse(new TextDecoder().decode(body)) as Payload
  } catch {
    return json(400, { error: 'Not JSON.' })
  }
  const pr = p.pull_request
  const repo = p.repository
  if (!pr || !repo?.id || !repo.full_name || !pr.user?.id) return json(400, { error: 'Not a pull request event.' })

  const move = moveFor({ action: p.action ?? '', draft: pr.draft, merged: pr.merged, state: pr.state, changes: p.changes })
  if (!move) return json(200, { moved: [], action: p.action })
  const refs = findRefs({ branch: pr.head?.ref, title: pr.title, body: pr.body })

  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const headers: Record<string, string> = { apikey: env.key ?? '', 'Content-Type': 'application/json' }
    // the older service role key is a JWT; the newer secret key goes as the apikey alone
    if (env.key?.startsWith('eyJ')) headers.Authorization = `Bearer ${env.key}`
    const res = await (env.fetch ?? fetch)(`${env.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) })
    if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`)
    return (await res.json()) as T
  }

  const found = await call<Lookup[]>('github_lookup', {
    p_repository_id: repo.id,
    p_repo: repo.full_name,
    p_author: pr.user.id,
    p_refs: refs,
  })
  const moved: string[] = []
  for (const w of found) {
    const event = {
      number: pr.number,
      url: pr.html_url,
      title: (pr.title ?? '').slice(0, 200),
      login: pr.user.login,
      to: move.to,
      refs,
      ...(!w.actor && { skipped: 'author' }),
    }
    const moves = w.actor ? movesFor(w.issues, refs, move) : []
    const notes = w.actor
      ? w.issues
          .filter((i) => moves.some((m) => m.issue === i.id))
          .flatMap((i) => notesFor(i, move.to, w.actor ?? '', w.people).map((n) => ({ id: ulid(), ...n })))
      : []
    const r = await call<{ moved: string[] }>('github_apply', {
      p_connection: w.connection,
      p_repository_id: repo.id,
      p_repo: repo.full_name,
      p_actor: w.actor,
      p_via: { pullRequest: { repo: repo.full_name, number: pr.number, url: pr.html_url } },
      p_moves: moves,
      p_notes: notes,
      p_event: event,
    })
    moved.push(...r.moved)
  }
  return json(200, { workspaces: found.length, moved })
}
