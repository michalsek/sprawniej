import { describe, expect, test } from 'bun:test'
import { handle, MAX_BODY, type Env } from '@/github/handler'
import { findRefs, MAX_REFS, moveFor, movesFor, notesFor, pullState, signatureOk, TO_DONE, TO_REVIEW, type Lookup, type LookupIssue } from '@/github/webhook'

const SECRET = "It's a Secret to Everybody"

async function sign(body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return `sha256=${Buffer.from(mac).toString('hex')}`
}

describe('the signature', () => {
  const body = new TextEncoder().encode('Hello, World!')

  test("GitHub's own example passes", async () => {
    // from GitHub's guide to validating webhook deliveries
    expect(await signatureOk(SECRET, body, 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17')).toBe(true)
  })

  test('anything else fails', async () => {
    const right = await sign('Hello, World!')
    expect(await signatureOk(SECRET, body, right.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).toBe(false)
    expect(await signatureOk('another secret', body, right)).toBe(false)
    expect(await signatureOk(SECRET, body, null)).toBe(false)
    expect(await signatureOk(SECRET, body, right.slice(7))).toBe(false)
    expect(await signatureOk(SECRET, body, `${right}00`)).toBe(false)
    expect(await signatureOk('', body, right)).toBe(false)
  })
})

describe('finding refs', () => {
  test('in the branch name, in any case', () => {
    expect(findRefs({ branch: 'eng-12-fix-login' })).toEqual(['ENG-12'])
    expect(findRefs({ branch: 'feature/Web-3_and-des-04' })).toEqual(['WEB-3', 'DES-4'])
  })

  test('in the title and the description as written, skipping code', () => {
    expect(findRefs({ title: '[ENG-12] Fix login', body: 'Fixes ENG-13 and DES-2.\n`ENG-99` and\n```\nENG-98\n```' })).toEqual([
      'ENG-12',
      'ENG-13',
      'DES-2',
    ])
    // lower case outside the branch name is ordinary text
    expect(findRefs({ title: 'eng-12', body: 'covid-19' })).toEqual([])
  })

  test('not inside longer words, and each once, branch first', () => {
    expect(findRefs({ title: 'xENG-12 ABCDEFGHENG-1 ENG-12a ENG-12-ish ab-1', body: 'See https://x.y/#/issue/ENG-7' })).toEqual(['ENG-12', 'ENG-7'])
    expect(findRefs({ branch: 'eng-5', title: 'ENG-5 ENG-6', body: 'ENG-6' })).toEqual(['ENG-5', 'ENG-6'])
    expect(findRefs({ title: 'TOOLONGKEY-1 A1234567-1 ENG-12345678' })).toEqual([])
  })

  test('at most fifty', () => {
    const body = Array.from({ length: 80 }, (_, i) => `ENG-${i + 1}`).join(' ')
    expect(findRefs({ body })).toHaveLength(MAX_REFS)
  })

  test('nothing in nothing', () => {
    expect(findRefs({ branch: null, title: null, body: null })).toEqual([])
  })
})

describe('what an event does', () => {
  const open = { state: 'open', draft: false }
  test('opening or getting ready moves to In Review', () => {
    for (const action of ['opened', 'reopened', 'ready_for_review']) expect(moveFor({ action, ...open })).toEqual(TO_REVIEW)
  })

  test('drafts and closed ones without merging move nothing', () => {
    expect(moveFor({ action: 'opened', state: 'open', draft: true })).toBeNull()
    expect(moveFor({ action: 'closed', state: 'closed', merged: false })).toBeNull()
    for (const action of ['synchronize', 'converted_to_draft', 'labeled', 'assigned', 'review_requested']) expect(moveFor({ action, ...open })).toBeNull()
  })

  test('an edited title or description counts; another base branch does not', () => {
    expect(moveFor({ action: 'edited', ...open, changes: { title: { from: 'x' } } })).toEqual(TO_REVIEW)
    expect(moveFor({ action: 'edited', ...open, changes: { body: { from: 'x' } } })).toEqual(TO_REVIEW)
    expect(moveFor({ action: 'edited', ...open, changes: { base: {} } })).toBeNull()
    expect(moveFor({ action: 'edited', state: 'closed', changes: { title: {} } })).toBeNull()
  })

  test('merging moves to Done', () => {
    expect(moveFor({ action: 'closed', state: 'closed', merged: true })).toEqual(TO_DONE)
  })

  test('how it shows on the issue page', () => {
    expect(pullState({ state: 'open', draft: false })).toBe('open')
    expect(pullState({ state: 'open', draft: true })).toBe('draft')
    expect(pullState({ state: 'closed', merged: true, draft: false })).toBe('merged')
    expect(pullState({ state: 'closed', merged: false, draft: true })).toBe('closed')
  })

  test('nothing goes backwards', () => {
    expect(TO_REVIEW.from).toEqual(['backlog', 'todo', 'in_progress'])
    expect(TO_DONE.from).toEqual(['backlog', 'todo', 'in_progress', 'in_review'])
  })
})

const ANA = 'p-ana'
const BOB = 'p-bob'
const CY = 'p-cy'
const GONE = 'p-gone'
const members: Lookup['people'] = [
  { id: ANA, login: 'ana' },
  { id: BOB, login: 'bob' },
  { id: CY, login: 'cy' },
]

function issue(more: Partial<LookupIssue> = {}): LookupIssue {
  return {
    id: 'i1',
    ref: 'ENG-1',
    former_refs: [],
    status: 'in_progress',
    created_by: ANA,
    assignee_id: null,
    description: '',
    followers: [],
    comments: [],
    ...more,
  }
}

describe('moves', () => {
  test('only issues that may move, named by the ref the pull request used', () => {
    const issues = [issue(), issue({ id: 'i2', ref: 'DES-4', former_refs: ['ENG-2'], status: 'todo' }), issue({ id: 'i3', ref: 'ENG-3', status: 'done' })]
    expect(movesFor(issues, ['ENG-1', 'ENG-2', 'ENG-3'], TO_REVIEW)).toEqual([
      { issue: 'i1', ref: 'ENG-1', from: TO_REVIEW.from, to: 'in_review' },
      { issue: 'i2', ref: 'ENG-2', from: TO_REVIEW.from, to: 'in_review' },
    ])
  })
})

describe('notes', () => {
  test('everyone following hears about it, but not the author', () => {
    const i = issue({
      assignee_id: CY,
      comments: [{ author_id: GONE, body: 'old' }],
      followers: [{ profile_id: BOB, following: true }],
    })
    expect(notesFor(i, 'in_review', BOB, members)).toEqual([
      { issue: 'i1', to: ANA, status: 'in_review' },
      { issue: 'i1', to: CY, status: 'in_review' },
    ])
  })

  test('people who asked not to follow and mentioned people count as in the app', () => {
    const i = issue({ description: 'cc @cy', followers: [{ profile_id: ANA, following: false }] })
    expect(notesFor(i, 'done', BOB, members)).toEqual([{ issue: 'i1', to: CY, status: 'done' }])
  })
})

describe('the handler', () => {
  const pr = (more: Record<string, unknown> = {}) => ({
    action: 'opened',
    pull_request: {
      id: 2_000_000_012,
      number: 12,
      html_url: 'https://github.com/acme/web/pull/12',
      title: 'Fix login',
      body: 'Fixes ENG-1',
      draft: false,
      merged: false,
      state: 'open',
      updated_at: '2026-10-20T10:00:00Z',
      user: { id: 42, login: 'bob-gh' },
      head: { ref: 'eng-2-login' },
    },
    repository: { id: 7, full_name: 'acme/web' },
    ...more,
  })

  async function deliver(payload: unknown, o: { event?: string; secret?: string; signature?: string; env?: Partial<Env>; lookup?: Lookup[] } = {}) {
    const body = JSON.stringify(payload)
    const calls: { fn: string; args: Record<string, unknown>; headers: Record<string, string> }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      const fn = url.split('/').pop() ?? ''
      const args = JSON.parse(String(init.body)) as Record<string, unknown>
      calls.push({ fn, args, headers: init.headers as Record<string, string> })
      if (fn === 'github_lookup') return Response.json(o.lookup ?? [])
      const moves = args.p_moves as { ref: string }[]
      return Response.json({ moved: moves.map((m) => m.ref) })
    }) as unknown as typeof fetch
    const req = new Request('https://x.supabase.co/functions/v1/github-webhook', {
      method: 'POST',
      body,
      headers: { 'x-github-event': o.event ?? 'pull_request', 'x-hub-signature-256': o.signature ?? (await sign(body, o.secret)) },
    })
    const res = await handle(req, { secret: SECRET, url: 'https://x.supabase.co', key: 'sb_secret_x', fetch: fake, ...o.env })
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, calls }
  }

  const found: Lookup = {
    connection: 'c1',
    workspace: 'w1',
    actor: BOB,
    people: members,
    issues: [issue({ id: 'i1', ref: 'ENG-1' }), issue({ id: 'i2', ref: 'ENG-2', status: 'in_review' })],
  }

  test('refuses a wrong signature before reading anything', async () => {
    const r = await deliver(pr(), { secret: 'not it' })
    expect(r.status).toBe(401)
    expect(r.calls).toEqual([])
  })

  test('says what is missing when it isn’t set up', async () => {
    expect((await deliver(pr(), { env: { secret: undefined } })).status).toBe(500)
    expect((await deliver(pr(), { env: { key: undefined } })).status).toBe(500)
  })

  test('answers a ping, signed, and every other event at once without reading it', async () => {
    expect((await deliver({ zen: 'Keep it simple' }, { event: 'ping' })).status).toBe(200)
    expect((await deliver({ zen: 'Keep it simple' }, { event: 'ping', secret: 'not it' })).status).toBe(401)
    for (const event of ['issues', 'issue_comment', 'label', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread', 'issue_dependencies', '']) {
      const req = new Request('https://x.supabase.co/functions/v1/github-webhook', { method: 'POST', body: '{"secret": "stuff"}', headers: { 'x-github-event': event } })
      const res = await handle(req, { secret: SECRET, url: 'https://x.supabase.co', key: 'k', fetch: (() => Promise.reject(new Error('no'))) as unknown as typeof fetch })
      expect({ event, status: res.status, bodyUsed: req.bodyUsed, text: await res.text() }).toEqual({ event, status: 204, bodyUsed: false, text: '' })
    }
  })

  test('a too big delivery is refused', async () => {
    const r = await deliver(pr({ pull_request: { ...pr().pull_request, body: 'x'.repeat(MAX_BODY) } }))
    expect(r.status).toBe(413)
  })

  test('an event that moves nothing reads nothing', async () => {
    const r = await deliver(pr({ action: 'synchronize' }))
    expect(r.status).toBe(200)
    expect(r.calls).toEqual([])
  })

  test('moves the issues that may move, as the author, with notes and the pull request as the reason', async () => {
    const r = await deliver(pr(), { lookup: [found] })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ workspaces: 1, moved: ['ENG-1'] })
    const [lookup, apply] = r.calls
    expect(lookup.fn).toBe('github_lookup')
    expect(lookup.args).toEqual({ p_repository_id: 7, p_repo: 'acme/web', p_author: 42, p_refs: ['ENG-2', 'ENG-1'] })
    expect(lookup.headers.apikey).toBe('sb_secret_x')
    expect(lookup.headers.Authorization).toBeUndefined()
    expect(apply.fn).toBe('github_apply')
    expect(apply.args.p_actor).toBe(BOB)
    expect(apply.args.p_moves).toEqual([{ issue: 'i1', ref: 'ENG-1', from: TO_REVIEW.from, to: 'in_review' }])
    expect((apply.args.p_notes as { to: string }[]).map((n) => n.to)).toEqual([ANA])
    expect(apply.args.p_via).toEqual({ pullRequest: { repo: 'acme/web', number: 12, url: 'https://github.com/acme/web/pull/12' } })
    expect(apply.args.p_event).toEqual({
      number: 12,
      url: 'https://github.com/acme/web/pull/12',
      title: 'Fix login',
      login: 'bob-gh',
      to: 'in_review',
      refs: ['ENG-2', 'ENG-1'],
    })
    expect(apply.args.p_pull).toEqual({
      id: '2000000012',
      repo: 'acme/web',
      number: 12,
      title: 'Fix login',
      url: 'https://github.com/acme/web/pull/12',
      state: 'open',
      updated_at: '2026-10-20T10:00:00Z',
      issues: ['i1', 'i2'],
    })
  })

  test('a draft, or closing without merging, moves nothing but shows on the issues', async () => {
    const draft = await deliver(pr({ pull_request: { ...pr().pull_request, draft: true } }), { lookup: [found] })
    expect(draft.body).toEqual({ workspaces: 1, moved: [] })
    const apply = draft.calls[1].args
    expect(apply.p_moves).toEqual([])
    expect(apply.p_notes).toEqual([])
    // Settings keeps showing the last move
    expect(apply.p_event).toBeNull()
    expect(apply.p_pull).toMatchObject({ state: 'draft', issues: ['i1', 'i2'] })

    const closed = await deliver(pr({ action: 'closed', pull_request: { ...pr().pull_request, state: 'closed' } }), { lookup: [found] })
    expect(closed.calls[1].args.p_pull).toMatchObject({ state: 'closed' })
    const back = await deliver(pr({ action: 'converted_to_draft', pull_request: { ...pr().pull_request, draft: true } }), { lookup: [found] })
    expect(back.calls[1].args.p_pull).toMatchObject({ state: 'draft' })
  })

  test('for an author who isn’t a member, an event that moves nothing writes nothing', async () => {
    const r = await deliver(pr({ action: 'edited', changes: { base: {} } }), { lookup: [{ ...found, actor: null }] })
    expect(r.calls.map((c) => c.fn)).toEqual(['github_lookup'])
  })

  test('an author who isn’t a member moves nothing, and the workspace hears why', async () => {
    const r = await deliver(pr({ action: 'closed', pull_request: { ...pr().pull_request, merged: true, state: 'closed' } }), {
      lookup: [{ ...found, actor: null }],
    })
    expect(r.body).toEqual({ workspaces: 1, moved: [] })
    const apply = r.calls[1].args
    expect(apply.p_actor).toBeNull()
    expect(apply.p_moves).toEqual([])
    expect(apply.p_notes).toEqual([])
    expect(apply.p_event).toMatchObject({ to: 'done', skipped: 'author' })
    expect(apply.p_pull).toBeNull()
  })

  test('the older service key goes as a bearer too', async () => {
    const r = await deliver(pr(), { env: { key: 'eyJhbGciOi.x.y' } })
    expect(r.calls[0].headers.Authorization).toBe('Bearer eyJhbGciOi.x.y')
  })

  test('a failing database call fails the delivery, so GitHub can send it again', async () => {
    const env: Partial<Env> = { fetch: (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch }
    await expect(deliver(pr(), { env })).rejects.toThrow(/github_lookup: 503/)
  })
})
