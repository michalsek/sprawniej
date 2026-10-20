import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import fixture from './fixtures/notion-page.json'
import { handle, MAX_BODY, type Env, type Lookup } from '@/notion/handler'
import { keyFrom, sha256Hex } from '@/notion/key'
import { descriptionFor, MAX_DESCRIPTION, richTextToMarkdown, type RichText } from '@/notion/markdown'
import { notesFor } from '@/notion/notes'
import { issueFromPage, readPage, statusFrom, type Page, type Property } from '@/notion/page'

const PAGE_ID = '2a3b4c5d6e7f4a8b9c0d1e2f3a4b5c6d'
const page = (properties: Record<string, Property>, more: Partial<Page> = {}): Page => ({ id: PAGE_ID, url: `https://www.notion.so/${PAGE_ID}`, trashed: false, properties, ...more })
const text = (plain_text: string, more: Partial<RichText> = {}): RichText => ({ type: 'text', plain_text, ...more })
const title = (...parts: string[]): Property => ({ type: 'title', title: parts.map((p) => text(p)) })
const select = (name: string | null): Property => ({ type: 'select', select: name === null ? null : { name } })
const status = (name: string): Property => ({ type: 'status', status: { name } })
const person = (email?: string) => ({ object: 'user', id: 'u', type: email ? 'person' : 'bot', ...(email && { person: { email } }) })
const of = (properties: Record<string, Property>) => issueFromPage(page(properties))

describe('reading a page', () => {
  test('a page id with dashes and capitals becomes 32 lower-case hex digits', () => {
    expect(readPage({ data: { ...fixture.data, id: '2A3B4C5D-6E7F-4A8B-9C0D-1E2F3A4B5C6D' } })?.id).toBe(PAGE_ID)
  })

  test('anything that isn’t a page is refused', () => {
    expect(readPage(null)).toBeNull()
    expect(readPage({ source: fixture.source })).toBeNull()
    expect(readPage({ data: { ...fixture.data, object: 'database' } })).toBeNull()
    expect(readPage({ data: { ...fixture.data, id: 'not-an-id' } })).toBeNull()
    expect(readPage({ data: { ...fixture.data, id: 42 } })).toBeNull()
  })

  test('an address that isn’t Notion’s becomes one made from the id', () => {
    const odd = ['https://www.notion.so/a)(b', 'https://www.notion.so/a b', 'https://www.notion.so/<x>', 'https://www.notion.so/"x"', 'https://www.notion.so']
    for (const url of ['https://evil.example/x', 'http://www.notion.so/x', 'https://notion.so.evil.com/x', 'https://evilnotion.so/x', 'javascript:alert(1)', null, 3, ...odd]) {
      expect({ url, got: readPage({ data: { ...fixture.data, url } })?.url }).toEqual({ url, got: `https://www.notion.so/${PAGE_ID}` })
    }
    expect(readPage({ data: { ...fixture.data, url: 'https://acme.notion.site/Page-1' } })?.url).toBe('https://acme.notion.site/Page-1')
  })

  test('in the trash or archived', () => {
    expect(readPage({ data: { ...fixture.data, in_trash: true } })?.trashed).toBe(true)
    expect(readPage({ data: { ...fixture.data, archived: true } })?.trashed).toBe(true)
  })

  test('the whole fixture as an issue', () => {
    const p = readPage(fixture)
    expect(p).toMatchObject({ id: PAGE_ID, url: fixture.data.url, trashed: false })
    expect(p && issueFromPage(p)).toEqual({
      title: 'Fix the login page',
      description: `The button does **nothing** on Safari.\n\n[Notion page](${fixture.data.url})`,
      status: 'in_progress',
      priority: 2,
      assigneeEmails: ['bob@example.com'],
      authorEmail: 'ana@example.com',
      dueDate: '2026-10-31',
      labelNames: ['Bug', 'Web'],
      teamHint: 'ENG',
      emails: ['ana@example.com', 'bob@example.com'],
    })
  })
})

describe('the title', () => {
  test('the title property, whatever it is called, in parts, on one line', () => {
    expect(of({ 'Task name': title('Fix ', 'the\nlogin  page') }).title).toBe('Fix the login page')
  })

  test('empty or missing is Untitled; long is cut', () => {
    expect(of({ Name: title('  ') }).title).toBe('Untitled')
    expect(of({}).title).toBe('Untitled')
    expect(of({ Name: title('x'.repeat(600)) }).title).toHaveLength(500)
  })

  test('cut by characters, so an emoji at the end stays whole', () => {
    const t = of({ Name: title(`${'x'.repeat(499)}😀y`) }).title
    expect([...t]).toHaveLength(500)
    expect(t.endsWith('😀')).toBe(true)
  })
})

describe('the status', () => {
  test('every word Notion people use', () => {
    const words: Record<string, string[]> = {
      backlog: ['Backlog', 'Icebox', 'Later'],
      todo: ['Todo', 'To do', 'Not started', 'New', 'Open', 'Ready', 'Planned'],
      in_progress: ['In progress', 'Doing', 'Started', 'WIP', 'Active'],
      in_review: ['In review', 'Review', 'Reviewing', 'QA', 'Testing'],
      done: ['Done', 'Complete', 'Completed', 'Finished', 'Shipped', 'Released'],
      canceled: ['Canceled', 'Cancelled', "Won't do", 'Dropped', 'Rejected'],
      duplicate: ['Duplicate'],
    }
    for (const [want, names] of Object.entries(words)) for (const name of names) expect({ name, got: statusFrom(name) }).toEqual({ name, got: want as never })
  })

  test('case, accents and spaces don’t matter; anything else is Todo', () => {
    expect(of({ Status: status('IN-PROGRESS') }).status).toBe('in_progress')
    expect(of({ Status: status('Dóne') }).status).toBe('done')
    expect(of({ Status: status('Blocked') }).status).toBe('todo')
    expect(of({ Status: select(null) }).status).toBe('todo')
  })

  test('a select called Status works; without one, the first status property', () => {
    expect(of({ status: select('Done') }).status).toBe('done')
    expect(of({ Stage: status('Shipped') }).status).toBe('done')
    expect(of({ Stage: select('Done') }).status).toBe('todo')
  })
})

describe('the priority', () => {
  test('names and P numbers', () => {
    const cases: [string | null, number][] = [
      ['Urgent', 1], ['P0', 1], ['High', 2], ['P1', 2], ['Medium', 3], ['Normal', 3], ['P2', 3], ['Low', 4], ['P3', 4],
      ['No priority', 0], [null, 0], ['Soon', 0],
    ]
    for (const [name, want] of cases) expect({ name, got: of({ Priority: select(name) }).priority }).toEqual({ name, got: want as never })
    expect(of({}).priority).toBe(0)
    expect(of({ Priority: status('High') }).priority).toBe(2)
  })
})

describe('people', () => {
  test('the assignee from any of its names, in order, emails in lower case', () => {
    for (const name of ['Assignee', 'Assignees', 'Assigned to', 'Owner']) {
      const got = of({ [name]: { type: 'people', people: [person(), person('Bob@Example.com'), person('cy@example.com')] } })
      expect({ name, got: got.assigneeEmails }).toEqual({ name, got: ['bob@example.com', 'cy@example.com'] })
    }
    expect(of({ Reviewers: { type: 'people', people: [person('bob@example.com')] } }).assigneeEmails).toEqual([])
  })

  test('the author is the Created by property’s person', () => {
    expect(of({ 'Created by': { type: 'created_by', created_by: person('Ana@example.com') } }).authorEmail).toBe('ana@example.com')
    expect(of({ Author: { type: 'created_by', created_by: person() } }).authorEmail).toBeNull()
    expect(of({ Assignee: { type: 'people', people: [person('bob@example.com')] } }).authorEmail).toBeNull()
  })

  test('every email for the database to match, once, at most twenty', () => {
    const many = Array.from({ length: 30 }, (_, i) => person(`p${i}@example.com`))
    const got = of({ 'Created by': { type: 'created_by', created_by: person('p0@example.com') }, Owner: { type: 'people', people: many } })
    expect(got.emails).toHaveLength(20)
    expect(got.emails[0]).toBe('p0@example.com')
    expect(new Set(got.emails).size).toBe(20)
  })
})

describe('the rest', () => {
  test('the due day', () => {
    const due = (start: string | null) => of({ Due: { type: 'date', date: start === null ? null : { start } } }).dueDate
    expect(due('2026-10-20')).toBe('2026-10-20')
    expect(due('2026-10-20T10:00:00.000+02:00')).toBe('2026-10-20')
    expect(due(null)).toBeNull()
    expect(due('20-10-2026')).toBeNull()
    expect(due('2026-02-31')).toBeNull()
    expect(of({ Deadline: { type: 'date', date: { start: '2026-01-02' } } }).dueDate).toBe('2026-01-02')
  })

  test('labels from a multi-select or a select, at most twenty', () => {
    expect(of({ Tags: { type: 'multi_select', multi_select: [{ name: 'Bug' }, { name: ' Bug ' }, { name: 'Web' }] } }).labelNames).toEqual(['Bug', 'Web'])
    expect(of({ Label: select('Bug') }).labelNames).toEqual(['Bug'])
    expect(of({ Label: select(null) }).labelNames).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `L${i}` }))
    expect(of({ Labels: { type: 'multi_select', multi_select: many } }).labelNames).toHaveLength(20)
  })

  test('the team from a select or from text', () => {
    expect(of({ Team: select('Design') }).teamHint).toBe('Design')
    expect(of({ Team: { type: 'rich_text', rich_text: [text(' DES ')] } }).teamHint).toBe('DES')
    expect(of({ Team: select(null) }).teamHint).toBeNull()
    expect(of({}).teamHint).toBeNull()
  })

  test('without a description, the description is the link back', () => {
    expect(of({}).description).toBe(`[Notion page](https://www.notion.so/${PAGE_ID})`)
    expect(of({ Details: { type: 'rich_text', rich_text: [text('Hi')] } }).description).toBe(`Hi\n\n[Notion page](https://www.notion.so/${PAGE_ID})`)
  })
})

describe('rich text as Markdown', () => {
  test('plain text and each mark', () => {
    expect(richTextToMarkdown([text('Hello')])).toBe('Hello')
    expect(richTextToMarkdown([text('a', { annotations: { bold: true } })])).toBe('**a**')
    expect(richTextToMarkdown([text('a', { annotations: { italic: true } })])).toBe('*a*')
    expect(richTextToMarkdown([text('a', { annotations: { strikethrough: true } })])).toBe('~~a~~')
    expect(richTextToMarkdown([text('a()', { annotations: { code: true } })])).toBe('`a()`')
    expect(richTextToMarkdown([text('a', { annotations: { underline: true, color: 'red' } })])).toBe('a')
  })

  test('marks together, and around the words only', () => {
    expect(richTextToMarkdown([text('Say ', {}), text('this ', { annotations: { bold: true, italic: true } }), text('now')])).toBe('Say ***this*** now')
  })

  test('neighbouring parts with the same marks and link are one, so part of a word can be bold', () => {
    const bold = { annotations: { bold: true } }
    expect(richTextToMarkdown([text('fo', bold), text('o', bold), text('bar')])).toBe('**foo**bar')
    expect(richTextToMarkdown([text('un', { annotations: { italic: true } }), text('done')])).toBe('*un*done')
    const href = 'https://example.com/docs'
    expect(richTextToMarkdown([text('read ', { href }), text('the docs', { href })])).toBe(`[read the docs](${href})`)
    expect(richTextToMarkdown([text('read', { href }), text(' more', { href: 'https://example.com/other' })])).toBe(
      `[read](${href}) [more](https://example.com/other)`,
    )
  })

  test('links: https only', () => {
    expect(richTextToMarkdown([text('docs', { href: 'https://example.com/a b' })])).toBe('[docs](https://example.com/a%20b)')
    expect(richTextToMarkdown([text('click', { href: 'javascript:alert(1)' })])).toBe('click')
  })

  test('line breaks, paragraphs, mentions', () => {
    expect(richTextToMarkdown([text('one\ntwo\n\nthree')])).toBe('one  \ntwo\n\nthree')
    expect(richTextToMarkdown([text('Ask '), { type: 'mention', plain_text: '@Ana Example' }])).toBe('Ask @Ana Example')
  })

  test('parts of another shape read as nothing', () => {
    const odd = [null, 'x', 3, { plain_text: 3 }, { plain_text: 'ok', href: 5, annotations: 'bold' }, { plain_text: '!', annotations: { bold: 'yes' } }]
    expect(richTextToMarkdown(odd)).toBe('ok!')
    expect(richTextToMarkdown('just text')).toBe('')
  })

  test('no HTML comes through', () => {
    expect(richTextToMarkdown([text('<script>alert(1)</script>')])).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  test('a long one is cut, and the link back stays', () => {
    const url = `https://www.notion.so/${PAGE_ID}`
    const d = descriptionFor([text('x'.repeat(60_000))], url)
    expect(d.length).toBeLessThanOrEqual(MAX_DESCRIPTION)
    expect(d.endsWith(`…\n\n[Notion page](${url})`)).toBe(true)
    // marks go round what is kept, so none is left open
    const bold = descriptionFor([text('x'.repeat(60_000), { annotations: { bold: true } }), text(' and more')], url)
    expect([...bold].length).toBeLessThanOrEqual(MAX_DESCRIPTION)
    expect(bold).toMatch(/^\*\*x+\*\*…\n\n\[Notion page\]/)
    const code = descriptionFor([text('plain '), text('y'.repeat(60_000), { annotations: { code: true } })], url)
    expect(code).toMatch(/^plain `y+`…\n\n/)
    // by characters, as Postgres counts them, never half of an emoji
    const e = descriptionFor([text('😀'.repeat(60_000))], url)
    expect([...e].length).toBeLessThanOrEqual(MAX_DESCRIPTION)
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(e)).toBe(false)
  })
})

const ANA = 'p-ana'
const BOB = 'p-bob'
const people = [
  { id: ANA, login: 'ana' },
  { id: BOB, login: 'bob' },
]

describe('notes', () => {
  test('the assignee hears about it, unless they made it', () => {
    expect(notesFor({ description: '', assignee: BOB, actor: ANA, people }).map((n) => [n.to, n.type])).toEqual([[BOB, 'assigned']])
    expect(notesFor({ description: '', assignee: ANA, actor: ANA, people })).toEqual([])
  })

  test('mentioned people hear about it; without an author the assignee still does', () => {
    expect(notesFor({ description: 'Ask @bob and @nobody', assignee: null, actor: ANA, people }).map((n) => [n.to, n.type])).toEqual([[BOB, 'mentioned']])
    expect(notesFor({ description: 'cc @ana', assignee: BOB, actor: null, people }).map((n) => [n.to, n.type])).toEqual([
      [BOB, 'assigned'],
      [ANA, 'mentioned'],
    ])
  })
})

describe('the key', () => {
  test('from the address, or the header; only its sha256 goes on', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const k = 'a'.repeat(64)
    expect(keyFrom(new Request(`https://x.co/f?c=1&k=${k}`))).toBe(k)
    expect(keyFrom(new Request('https://x.co/f?c=1', { headers: { 'X-Sprawniej-Secret': k.toUpperCase() } }))).toBe(k)
    expect(keyFrom(new Request('https://x.co/f?c=1&k=short'))).toBeNull()
    expect(keyFrom(new Request('https://x.co/f?c=1'))).toBeNull()
    // an empty or broken k in the address doesn't hide a good header
    for (const q of ['k=', 'k=short']) expect(keyFrom(new Request(`https://x.co/f?c=1&${q}`, { headers: { 'X-Sprawniej-Secret': k } }))).toBe(k)
  })
})

describe('the handler', () => {
  let log: ReturnType<typeof spyOn>
  beforeAll(() => {
    log = spyOn(console, 'log').mockImplementation(() => {})
  })
  afterAll(() => log.mockRestore())
  const KEY = 'f'.repeat(64)
  const CONN = '11111111-2222-4333-8444-555555555555'
  const ok: Lookup = {
    state: 'ok',
    connection: CONN,
    workspace: 'w1',
    team: { id: 't-eng', key: 'ENG', first_sort: 'a5' },
    people,
    emails: [
      { email: 'ana@example.com', profile_id: ANA },
      { email: 'bob@example.com', profile_id: BOB },
    ],
    labels: [
      { id: 'l-bug', name: 'Bug' },
      { id: 'l-design', name: 'Design' },
    ],
  }

  type Call = { fn: string; url: string; args: Record<string, unknown>; headers: Record<string, string>; raw: string }

  async function send(body: string | unknown, o: { method?: string; query?: string; headers?: Record<string, string>; env?: Partial<Env>; lookup?: Lookup; apply?: unknown } = {}) {
    const calls: Call[] = []
    const fake = (async (url: string, init: RequestInit) => {
      const fn = url.split('/').pop() ?? ''
      const raw = String(init.body)
      calls.push({ fn, url, args: JSON.parse(raw) as Record<string, unknown>, headers: init.headers as Record<string, string>, raw })
      if (fn === 'notion_lookup') return Response.json(o.lookup ?? ok)
      return Response.json(o.apply ?? { issue: 'ENG-7', new: true })
    }) as unknown as typeof fetch
    const req = new Request(`https://x.supabase.co/functions/v1/notion-webhook${o.query ?? `?c=${CONN}&k=${KEY}`}`, {
      method: o.method ?? 'POST',
      ...(o.method !== 'GET' && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      headers: o.headers,
    })
    const res = await handle(req, { url: 'https://x.supabase.co', key: 'sb_secret_x', fetch: fake, ...o.env })
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, calls }
  }

  test('only POST, and nothing read otherwise', async () => {
    const r = await send('', { method: 'GET' })
    expect(r.status).toBe(405)
    expect(r.calls).toEqual([])
  })

  test('an address without a connection, or a key, reads nothing', async () => {
    for (const query of ['', '?k=' + KEY, `?c=abc&k=${KEY}`]) {
      const r = await send(fixture, { query })
      expect({ query, status: r.status, calls: r.calls.length }).toEqual({ query, status: 404, calls: 0 })
    }
    const r = await send(fixture, { query: `?c=${CONN}` })
    expect(r.status).toBe(401)
    expect(r.calls).toEqual([])
  })

  test('the key in a header works like the one in the address', async () => {
    const r = await send(fixture, { query: `?c=${CONN}`, headers: { 'X-Sprawniej-Secret': KEY } })
    expect(r.status).toBe(200)
    expect(r.calls.map((c) => c.fn)).toEqual(['notion_lookup', 'notion_apply'])
  })

  test('too big, by what it says and by what it is', async () => {
    expect((await send(fixture, { headers: { 'content-length': String(MAX_BODY + 1) } })).status).toBe(413)
    const r = await send('x'.repeat(MAX_BODY + 1))
    expect(r.status).toBe(413)
    expect(r.calls).toEqual([])
  })

  test('an address that no longer works, or was replaced, makes nothing', async () => {
    const gone = await send(fixture, { lookup: { state: 'unknown' } })
    expect(gone.status).toBe(404)
    expect(gone.calls.map((c) => c.fn)).toEqual(['notion_lookup'])
    const replaced = await send(fixture, { lookup: { state: 'wrong_key' } })
    expect(replaced.status).toBe(401)
    expect(replaced.calls.map((c) => c.fn)).toEqual(['notion_lookup'])
  })

  test('not JSON or not a page: refused once the key is checked', async () => {
    const notJson = await send('hello')
    expect(notJson.status).toBe(400)
    expect(notJson.calls.map((c) => c.fn)).toEqual(['notion_lookup'])
    expect(notJson.calls[0].args).toMatchObject({ p_emails: [], p_team: null })
    log.mockClear()
    const notPage = await send({ data: { ...fixture.data, object: 'database' } })
    expect(notPage.status).toBe(400)
    expect(notPage.calls.map((c) => c.fn)).toEqual(['notion_lookup'])
    expect(log.mock.calls).toEqual([['notion', { refused: 'not a page' }]])
  })

  test('properties of shapes Notion never sends: a wrong key is still a wrong key, a right one makes the issue', async () => {
    const odd = {
      ...fixture,
      data: {
        ...fixture.data,
        properties: {
          Name: { type: 'title', title: 'a string' },
          Status: { type: 'status', status: { name: 3 } },
          Labels: { type: 'multi_select', multi_select: [3, null, { name: 4 }, { name: 'Bug' }] },
          Description: { type: 'rich_text', rich_text: [null, { plain_text: 'Hi', href: 7 }] },
          Assignee: { type: 'people', people: [null, 3, { person: 'x' }] },
          'Created by': { type: 'created_by', created_by: 'ana' },
          Due: { type: 'date', date: 'tomorrow' },
          Team: { type: 'rich_text', rich_text: 'ENG' },
          Empty: null,
          Number: 3,
        },
      },
    }
    expect((await send(odd, { lookup: { state: 'wrong_key' } })).status).toBe(401)
    const r = await send(odd)
    expect(r.status).toBe(200)
    expect(r.calls[0].args).toMatchObject({ p_emails: [], p_team: null })
    expect(r.calls[1].args.p_issue).toMatchObject({ title: 'Untitled', status: 'todo', labels: ['l-bug'], assignee_id: null, due_date: null })
    expect(r.calls[1].args.p_actor).toBeNull()
  })

  test('a page in the trash makes nothing', async () => {
    const r = await send({ ...fixture, data: { ...fixture.data, in_trash: true } })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ skipped: 'The page is in the trash.' })
    expect(r.calls.map((c) => c.fn)).toEqual(['notion_lookup'])
    expect(log).toHaveBeenLastCalledWith('notion', { skipped: 'trash' })
  })

  test('a new page: the issue as its author, with the assignee, labels, a place at the top and notes', async () => {
    const r = await send(fixture)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ issue: 'ENG-7', new: true })
    const [lookup, apply] = r.calls
    expect(lookup.args).toEqual({
      p_connection: CONN,
      p_secret_hash: await sha256Hex(KEY),
      p_emails: ['ana@example.com', 'bob@example.com'],
      p_team: 'ENG',
    })
    expect(lookup.headers.apikey).toBe('sb_secret_x')
    expect(lookup.headers.Authorization).toBeUndefined()
    expect(apply.args.p_connection).toBe(CONN)
    expect(apply.args.p_secret_hash).toBe(await sha256Hex(KEY))
    expect(apply.args.p_page).toEqual({ id: PAGE_ID, url: fixture.data.url })
    expect(apply.args.p_actor).toBe(ANA)
    const issue = apply.args.p_issue as Record<string, unknown>
    expect(issue).toMatchObject({
      team_id: 't-eng',
      title: 'Fix the login page',
      status: 'in_progress',
      priority: 2,
      assignee_id: BOB,
      due_date: '2026-10-31',
      labels: ['l-bug'],
    })
    expect(issue.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(String(issue.sort_order) < 'a5').toBe(true)
    expect(apply.args.p_notes).toEqual([{ id: expect.stringMatching(/^[0-9A-Z]{26}$/), to: BOB, type: 'assigned' }])
  })

  test('the key itself never goes to the database, and the log says only which issue', async () => {
    log.mockClear()
    const r = await send(fixture)
    for (const c of r.calls) {
      expect(c.url.includes(KEY)).toBe(false)
      expect(c.raw.includes(KEY)).toBe(false)
    }
    expect(log.mock.calls).toEqual([['notion', { issue: 'ENG-7', new: true }]])
  })

  test('the same page again, or no team, or too many', async () => {
    const again = await send(fixture, { apply: { issue: 'ENG-7', new: false, archived: false } })
    expect(again.status).toBe(200)
    expect(again.body).toEqual({ issue: 'ENG-7', new: false })
    const noTeam = await send(fixture, { lookup: { ...ok, team: null }, apply: { problem: 'team' } })
    expect(noTeam.status).toBe(409)
    expect((noTeam.calls[1].args.p_issue as Record<string, unknown>).team_id).toBeNull()
    expect(log).toHaveBeenLastCalledWith('notion', { problem: 'team' })
    expect((await send(fixture, { apply: { problem: 'busy' } })).status).toBe(429)
    expect(log).toHaveBeenLastCalledWith('notion', { problem: 'busy' })
  })

  test('people who aren’t members: no author, nobody assigned', async () => {
    const r = await send(fixture, { lookup: { ...ok, emails: [] } })
    expect(r.calls[1].args.p_actor).toBeNull()
    expect((r.calls[1].args.p_issue as Record<string, unknown>).assignee_id).toBeNull()
    expect(r.calls[1].args.p_notes).toEqual([])
  })

  test('the address replaced between the two calls is a wrong key; anything else refused still fails', async () => {
    const refuse = (message: string) =>
      (async (url: string) =>
        url.endsWith('notion_lookup') ? Response.json(ok) : Response.json({ code: '42501', message }, { status: 403 })) as unknown as typeof fetch
    const replaced = await send(fixture, { env: { fetch: refuse('This address was replaced.') } })
    expect(replaced.status).toBe(401)
    await expect(send(fixture, { env: { fetch: refuse('That person isn’t in this workspace.') } })).rejects.toThrow(/notion_apply: 403 42501/)
  })

  test('a megabyte of spaces in bold is answered quickly, with the right key or not', async () => {
    const spaces = { type: 'rich_text', rich_text: [{ type: 'text', plain_text: ' '.repeat(MAX_BODY - 20_000), annotations: { bold: true } }] }
    const big = { ...fixture, data: { ...fixture.data, properties: { ...fixture.data.properties, Description: spaces } } }
    for (const lookup of [{ state: 'wrong_key' } as Lookup, ok]) {
      const started = performance.now()
      const r = await send(big, { lookup })
      expect(r.status).toBe(lookup.state === 'ok' ? 200 : 401)
      expect(performance.now() - started).toBeLessThan(500)
    }
  })

  test('a failing database call throws, so the function answers 500', async () => {
    const env: Partial<Env> = { fetch: (async () => Response.json({ code: '42501', message: 'This address was replaced.', details: 'Fix the login page' }, { status: 403 })) as unknown as typeof fetch }
    const err = await send(fixture, { env }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('notion_lookup: 403 42501 This address was replaced.')
  })

  test('the older service key goes as a bearer too', async () => {
    const r = await send(fixture, { env: { key: 'eyJhbGciOi.x.y' } })
    expect(r.calls[0].headers.Authorization).toBe('Bearer eyJhbGciOi.x.y')
  })
})
