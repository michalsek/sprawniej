import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  addMember,
  asService,
  client,
  closeChannels,
  enabled,
  expectDenied,
  expectError,
  getWorld,
  lit,
  newIssue,
  newTeam,
  newWorkspace,
  ok,
  RUN,
  ownerSql,
  signUp,
  listen,
  ulid,
  type Someone,
  type World,
} from './support'

// GitHub: which repository feeds which workspace (github_repos), and the two functions only the webhook may call
// (supabase/migrations/20261020120000_github.sql, docs/github-app.md).

interface Lookup {
  connection: string
  workspace: string
  actor: string | null
  people: { id: string; login: string; handle: string | null }[]
  issues: {
    id: string
    ref: string
    former_refs: string[]
    status: string
    created_by: string
    followers: { profile_id: string; following: boolean }[]
    comments: { author_id: string; body: string }[]
  }[]
}

/** GitHub ids nobody real has (they're far above GitHub's), different per run */
const base = 9_000_000_000_000 + (parseInt(RUN.replace(/[^0-9a-z]/g, '').slice(-6), 36) % 1_000_000) * 100
let next = 0
const githubId = () => base + next++

const lookup = async (repositoryId: number, repo: string, author: number, refs: string[]) =>
  (await asService<{ r: Lookup[] }>(`select public.github_lookup(${repositoryId}, ${lit(repo)}, ${author}, ${lit(`{${refs.join(',')}}`)}::text[]) as r`))[0].r

const apply = async (o: {
  connection: string
  repositoryId?: number
  repo?: string
  actor: string | null
  via?: unknown
  moves?: unknown[]
  notes?: unknown[]
  event?: unknown
  pull?: unknown
}) =>
  (
    await asService<{ r: { moved: string[] } }>(
      `select public.github_apply(${lit(o.connection)}, ${o.repositoryId ?? 'null'}, ${o.repo ? lit(o.repo) : 'null'}, ` +
        `${o.actor ? `${lit(o.actor)}::uuid` : 'null'}, ${lit(o.via ?? null)}::jsonb, ${lit(o.moves ?? [])}::jsonb, ` +
        `${lit(o.notes ?? [])}::jsonb, ${o.event === null ? 'null' : lit(o.event ?? {})}::jsonb, ${o.pull ? `${lit(o.pull)}::jsonb` : 'null'}) as r`,
    )
  )[0].r

describe.skipIf(!enabled)('GitHub', () => {
  let w: World
  let ws: string
  let eng: string
  let ana: Someone
  let bob: Someone
  let bobGithub: number
  const repo = `acme-${RUN}/web`

  beforeAll(async () => {
    w = await getWorld()
    ana = w.ana
    bob = w.bob
    ;({ ws, team: eng } = await newWorkspace(ana, 'github'))
    await addMember(ana, bob, ws)
    bobGithub = githubId()
    await ownerSql(`update public.profiles set github_id = ${bobGithub} where id = ${lit(bob.profileId)}`)
  }, 60_000)
  afterAll(closeChannels)

  test('only admins see, connect and remove repositories', async () => {
    await expectDenied(bob.db.from('github_repos').insert({ workspace_id: ws, repo: `${repo}-bob` }))
    await expectDenied(w.cy.db.from('github_repos').insert({ workspace_id: ws, repo: `${repo}-cy` }))
    const row = await ok(ana.db.from('github_repos').insert({ workspace_id: ws, repo: `${repo}-x` }).select().single())
    expect(row.added_by).toBe(ana.profileId)
    expect(row.repository_id).toBeNull()
    expect(await ok(bob.db.from('github_repos').select().eq('workspace_id', ws))).toEqual([])
    expect(await ok(bob.db.from('github_repos').delete().eq('id', row.id).select())).toEqual([])
    // nobody changes a connection: the webhook fills in the rest
    await expectError(ana.db.from('github_repos').update({ repository_id: 1 }).eq('id', row.id))
    await expectError(ana.db.from('github_repos').insert({ workspace_id: ws, repo: `${repo}-X` }), '23505')
    await expectError(ana.db.from('github_repos').insert({ workspace_id: ws, repo: 'not a repository' }), '23514')
    expect(await ok(ana.db.from('github_repos').delete().eq('id', row.id).select('id'))).toHaveLength(1)
  })

  test('people who are signed in, or not, can call neither webhook function', async () => {
    for (const db of [ana.db, client()]) {
      const l = await db.rpc('github_lookup', { p_repository_id: 1, p_repo: repo, p_author: bobGithub, p_refs: ['ENG-1'] })
      expect(l.error).not.toBeNull()
      const a = await db.rpc('github_apply', {
        p_connection: crypto.randomUUID(),
        p_repository_id: 1,
        p_repo: repo,
        p_actor: ana.profileId,
        p_via: {},
        p_moves: [],
        p_notes: [],
        p_event: {},
      })
      expect(a.error).not.toBeNull()
    }
  })

  test('a pull request moves the issues it names, as its author, with notes and history', async () => {
    const conn = await ok(ana.db.from('github_repos').insert({ workspace_id: ws, repo }).select('id').single())
    const des = await newTeam(ana, ws, 'DES')
    const one = await newIssue(ana, ws, eng, { title: 'One', status: 'in_progress' })
    const done = await newIssue(ana, ws, eng, { title: 'Done already', status: 'done' })
    const moved = await newIssue(ana, ws, eng, { title: 'Moved away', status: 'todo' })
    const oldRef = `ENG-${moved.number}`
    await ok(ana.db.rpc('move_issue_to_team', { p_issue: moved.id, p_team: des }))
    const archived = await newIssue(ana, ws, eng, { title: 'Archived', status: 'todo' })
    await ok(ana.db.from('issues').update({ archived_at: new Date().toISOString() }).eq('id', archived.id))
    await ok(ana.db.from('comments').insert({ id: ulid(), workspace_id: ws, issue_id: one.id, body: 'On it' }))

    const refs = [`ENG-${one.number}`, `eng-${done.number}`, oldRef, `ENG-${archived.number}`, 'ENG-99999', 'NOPE-1']
    const repositoryId = githubId()
    const [found] = await lookup(repositoryId, repo.toUpperCase(), bobGithub, refs)
    expect(found.connection).toBe(conn.id)
    expect(found.workspace).toBe(ws)
    expect(found.actor).toBe(bob.profileId)
    expect(found.people.map((p) => p.id).sort()).toEqual([ana.profileId, bob.profileId].sort())
    expect(found.people.find((p) => p.id === ana.profileId)).toEqual({ id: ana.profileId, login: ana.login, handle: null })
    // a changed handle comes along, so mentions of it count in the webhook
    await ok(bob.db.rpc('set_handle', { p_handle: `${bob.login}-gh` }))
    const [renamed] = await lookup(repositoryId, repo, bobGithub, refs)
    expect(renamed.people.find((p) => p.id === bob.profileId)?.handle).toBe(`${bob.login}-gh`)
    await ok(bob.db.rpc('set_handle', { p_handle: bob.login }))
    expect(found.issues.map((i) => i.id).sort()).toEqual([one.id, done.id, moved.id].sort())
    const first = found.issues.find((i) => i.id === one.id)
    expect(first?.created_by).toBe(ana.profileId)
    expect(first?.comments).toEqual([{ author_id: ana.profileId, body: 'On it' }])
    expect(found.issues.find((i) => i.id === moved.id)?.former_refs).toEqual([oldRef])

    // someone who isn't in the workspace with that GitHub id: no actor
    expect((await lookup(repositoryId, repo, githubId(), refs))[0].actor).toBeNull()

    const via = { pullRequest: { repo, number: 12, url: `https://github.com/${repo}/pull/12` } }
    const from = ['backlog', 'todo', 'in_progress']
    const note = ulid()
    const result = await apply({
      connection: conn.id,
      repositoryId,
      repo: `acme-${RUN}/web-renamed`,
      actor: bob.profileId,
      via,
      moves: [
        { issue: one.id, ref: `ENG-${one.number}`, from, to: 'in_review' },
        { issue: done.id, ref: `ENG-${done.number}`, from, to: 'in_review' },
        { issue: moved.id, ref: oldRef, from, to: 'in_review' },
      ],
      notes: [
        { id: note, issue: one.id, to: ana.profileId, status: 'in_review' },
        { id: ulid(), issue: done.id, to: ana.profileId, status: 'in_review' },
      ],
      event: { number: 12, action: 'opened' },
    })
    expect(result.moved.sort()).toEqual([`ENG-${one.number}`, oldRef].sort())

    const now = await ok(ana.db.from('issues').select('id, status').in('id', [one.id, done.id, moved.id]))
    expect(Object.fromEntries(now.map((i) => [i.id, i.status]))).toEqual({ [one.id]: 'in_review', [done.id]: 'done', [moved.id]: 'in_review' })

    const events = await ok(ana.db.from('issue_events').select('actor_id, changes').eq('issue_id', one.id))
    expect(events).toEqual([{ actor_id: bob.profileId, changes: { status: ['in_progress', 'in_review'], via } }])

    // only the note for an issue that moved, written as the author
    const notes = await ok(ana.db.from('inbox').select('id, actor_id, type, status, issue_id').eq('workspace_id', ws))
    expect(notes).toEqual([{ id: note, actor_id: bob.profileId, type: 'status', status: 'in_review', issue_id: one.id }])

    const saved = await ok(ana.db.from('github_repos').select('repo, repository_id, last_event, last_event_at').eq('id', conn.id).single())
    expect(saved.repository_id).toBe(repositoryId)
    expect(saved.repo).toBe(`acme-${RUN}/web-renamed`)
    expect(saved.last_event).toEqual({ number: 12, action: 'opened', moved: result.moved })
    expect(saved.last_event_at).not.toBeNull()

    // from now on the repository is found by its number, whatever it's called
    expect((await lookup(repositoryId, 'someone/else', bobGithub, refs))[0]?.connection).toBe(conn.id)

    // a change that comes later without a pull request says nothing about one
    await ok(ana.db.from('issues').update({ status: 'todo' }).eq('id', one.id))
    const later = await ok(ana.db.from('issue_events').select('actor_id, changes').eq('issue_id', one.id).order('id'))
    expect(later[1]).toEqual({ actor_id: ana.profileId, changes: { status: ['in_review', 'todo'] } })
  })

  test('without a member as the author nothing moves, but the connection remembers it', async () => {
    const conn = await ok(ana.db.from('github_repos').insert({ workspace_id: ws, repo: `${repo}-quiet` }).select('id').single())
    const issue = await newIssue(ana, ws, eng, { status: 'todo' })
    const moves = [{ issue: issue.id, ref: `ENG-${issue.number}`, from: ['todo'], to: 'in_review' }]
    const r = await apply({ connection: conn.id, actor: null, moves, event: { number: 3, skipped: 'author', login: 'octocat' } })
    expect(r.moved).toEqual([])
    expect((await ok(ana.db.from('issues').select('status').eq('id', issue.id).single())).status).toBe('todo')
    const saved = await ok(ana.db.from('github_repos').select('last_event').eq('id', conn.id).single())
    expect(saved.last_event).toEqual({ number: 3, skipped: 'author', login: 'octocat', moved: [] })

    // an actor who isn't a member is refused
    await expect(apply({ connection: conn.id, actor: w.cy.profileId, moves })).rejects.toThrow(/isn.t in this workspace/)
  })

  test('the pull requests that mention an issue are kept, live, and only members read them', async () => {
    const conn = await ok(ana.db.from('github_repos').insert({ workspace_id: ws, repo: `${repo}-prs` }).select('id').single())
    const one = await newIssue(ana, ws, eng, { title: 'PR one' })
    const two = await newIssue(ana, ws, eng, { title: 'PR two' })
    const heard = await listen(ana, `ws:${ws}`)
    const id = String(githubId())
    const pull = (state: string, at: string, issues: string[], title = 'Fix login') => ({
      id,
      repo: `${repo}-prs`,
      number: 21,
      title,
      url: `https://github.com/${repo}-prs/pull/21`,
      state,
      updated_at: at,
      issues,
    })
    const rows = async () =>
      (await ok(bob.db.from('issue_pull_requests').select('issue_id, state, title, author_id, number').eq('pull_request_id', id))).sort((a, b) =>
        a.issue_id < b.issue_id ? -1 : 1,
      )

    // a draft moves nothing and leaves Settings as it was
    await apply({ connection: conn.id, actor: bob.profileId, event: null, pull: pull('draft', '2026-10-20T10:00:00Z', [one.id, two.id]) })
    expect(await rows()).toEqual(
      [one.id, two.id].sort().map((issue_id) => ({ issue_id, state: 'draft', title: 'Fix login', author_id: bob.profileId, number: 21 })),
    )
    expect((await ok(ana.db.from('github_repos').select('last_event').eq('id', conn.id).single())).last_event).toBeNull()
    expect(await heard.waitFor((m) => m.table === 'issue_pull_requests' && m.op === 'INSERT' && m.row?.issue_id === one.id)).toBeDefined()

    // nobody signed in writes them, and people outside the workspace don't see them
    await expectError(ana.db.from('issue_pull_requests').update({ state: 'merged' }).eq('pull_request_id', id))
    await expectError(
      ana.db.from('issue_pull_requests').insert({
        workspace_id: ws, issue_id: one.id, pull_request_id: '1', repo, number: 1, url: 'https://github.com', state: 'open', github_updated_at: '2026-10-20T10:00:00Z',
      }),
    )
    await expectError(ana.db.from('issue_pull_requests').delete().eq('pull_request_id', id))
    expect(await ok(w.cy.db.from('issue_pull_requests').select().eq('pull_request_id', id))).toEqual([])

    // merged, and the second issue taken out of the title
    await apply({ connection: conn.id, actor: bob.profileId, event: { number: 21 }, pull: pull('merged', '2026-10-20T11:00:00Z', [one.id], 'Fix login for real') })
    expect(await rows()).toEqual([{ issue_id: one.id, state: 'merged', title: 'Fix login for real', author_id: bob.profileId, number: 21 }])
    expect(await heard.waitFor((m) => m.table === 'issue_pull_requests' && m.op === 'UPDATE' && m.row?.state === 'merged')).toBeDefined()
    const notes = await ok(ana.db.from('deletions').select('row_key').eq('workspace_id', ws).eq('table_name', 'issue_pull_requests'))
    expect(notes.map((n) => n.row_key)).toContainEqual({ issue_id: two.id, pull_request_id: id })

    // a delivery that comes late changes nothing
    await apply({ connection: conn.id, actor: bob.profileId, event: null, pull: pull('open', '2026-10-20T10:30:00Z', [one.id, two.id]) })
    expect(await rows()).toEqual([{ issue_id: one.id, state: 'merged', title: 'Fix login for real', author_id: bob.profileId, number: 21 }])

    // without a member as the author nothing is kept
    const other = String(githubId())
    await apply({ connection: conn.id, actor: null, event: null, pull: { ...pull('open', '2026-10-20T12:00:00Z', [two.id]), id: other } })
    expect(await ok(ana.db.from('issue_pull_requests').select().eq('pull_request_id', other))).toEqual([])

    // deleting the issue takes its pull requests with it
    await ok(ana.db.from('issues').delete().eq('id', one.id))
    expect(await rows()).toEqual([])
  })

  test('adding GitHub as a way to sign in fills the GitHub id', async () => {
    const gil = await signUp('gil-github')
    const id = githubId()
    await ownerSql(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (${lit(String(id))}, ${lit(gil.userId)}, ${lit({ sub: String(id), user_name: `dbt-${RUN}-gil-gh` })}::jsonb,
               'github', now(), now(), now())`,
    )
    const me = await ok(gil.db.rpc('ensure_profile').single())
    expect(me.github_id).toBe(id)
    expect(me.login).toBe(gil.login)
  })
})
