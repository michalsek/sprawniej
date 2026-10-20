/**
 * The Edge Function `github-webhook`: one delivery from GitHub in, the issues it mentions moved (docs/github-app.md).
 * It talks to the database only through the two functions only it may call (github_lookup, github_apply), with
 * `fetch`, so tests hand it a pretend one (tests/github.test.ts). server.ts starts it in Supabase.
 */
import { ulid } from 'ulid'
import { findRefs, movesFor, moveFor, notesFor, pullState, signatureOk, SHOWN_ACTIONS, type Lookup } from './webhook'

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
    id?: number
    number?: number
    html_url?: string
    title?: string | null
    body?: string | null
    draft?: boolean
    merged?: boolean
    state?: string
    updated_at?: string
    user?: { id?: number; login?: string }
    head?: { ref?: string }
  }
  changes?: Record<string, unknown>
  repository?: { id?: number; full_name?: string }
}

/** the events the App may send that mean something here; every other one is answered at once */
export const HANDLED = ['pull_request', 'ping']

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'GitHub sends POST.' })
  // issues, comments, reviews and the rest: not read, not checked, not logged
  const event = req.headers.get('x-github-event')
  if (!event || !HANDLED.includes(event)) return new Response(null, { status: 204 })
  if (!env.secret || !env.url || !env.key) return json(500, { error: 'The webhook secret or the project settings are missing.' })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, { error: 'Too big.' })
  const body = new Uint8Array(await req.arrayBuffer())
  if (body.length > MAX_BODY) return json(413, { error: 'Too big.' })
  if (!(await signatureOk(env.secret, body, req.headers.get('x-hub-signature-256')))) return json(401, { error: 'Wrong signature.' })

  if (event === 'ping') return json(200, { ok: true })

  let p: Payload
  try {
    p = JSON.parse(new TextDecoder().decode(body)) as Payload
  } catch {
    return json(400, { error: 'Not JSON.' })
  }
  const pr = p.pull_request
  const repo = p.repository
  if (!pr || !repo?.id || !repo.full_name || !pr.user?.id) return json(400, { error: 'Not a pull request event.' })

  const action = p.action ?? ''
  const move = moveFor({ action, draft: pr.draft, merged: pr.merged, state: pr.state, changes: p.changes })
  // labels, reviews, new commits and the rest change neither the issues nor how the pull request shows on them
  const shown = SHOWN_ACTIONS.includes(action) && !!pr.id && !!pr.number && !!pr.html_url
  if (!move && !shown) return json(200, { moved: [], action })
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
    // nothing moves and nothing shows for an author who isn't a member here
    if (!move && !w.actor) continue
    const event = move && {
      number: pr.number,
      url: pr.html_url,
      title: (pr.title ?? '').slice(0, 200),
      login: pr.user.login,
      to: move.to,
      refs,
      ...(!w.actor && { skipped: 'author' }),
    }
    const moves = move && w.actor ? movesFor(w.issues, refs, move) : []
    const notes = move && w.actor
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
      // without a move the connection keeps its last one, for Settings
      p_event: event || null,
      p_pull: shown && w.actor
        ? {
            id: String(pr.id),
            repo: repo.full_name,
            number: pr.number,
            title: (pr.title ?? '').slice(0, 300),
            url: pr.html_url,
            state: pullState(pr),
            updated_at: pr.updated_at ?? new Date().toISOString(),
            issues: w.issues.map((i) => i.id),
          }
        : null,
    })
    moved.push(...r.moved)
  }
  return json(200, { workspaces: found.length, moved })
}
