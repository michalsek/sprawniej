import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { fetchIssueEvents } from '@/backend/history'
import { Registry } from '@/backend/registry'
import { iso } from '@/backend/rows'
import { issueEvents } from '@/data/history'
import { closeChannels, DISPLAY, enabled, getWorld, newIssue, newTeam, ok, ulid, type World } from './support'

describe.skipIf(!enabled)('history and deletions', () => {
  let w: World
  beforeAll(async () => {
    w = await getWorld()
  }, 60_000)
  afterAll(closeChannels)

  const events = async (issue: string) => ok(w.ana.db.from('issue_events').select('actor_id, changes').eq('issue_id', issue).order('id'))
  const issueRow = async (id: string) => ok(w.ana.db.from('issues').select().eq('id', id).single())
  const newLabel = async () => {
    const id = ulid()
    await ok(w.ana.db.from('labels').insert({ id, workspace_id: w.ws, name: `L ${id}`, color: '#26b5ce' }))
    return id
  }
  const deleted = async (table: string) =>
    (await ok(w.ana.db.from('deletions').select('row_key').eq('workspace_id', w.ws).eq('table_name', table))).map((d) => d.row_key)

  test('one change of several fields is one event, by whoever made it', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng, { title: 'Before' })
    await ok(w.ana.db.from('issues').update({ title: 'After', status: 'in_progress' }).eq('id', issue.id))
    await ok(w.ana.db.from('issues').update({ description: 'Words' }).eq('id', issue.id))
    const before = await issueRow(issue.id)
    await ok(w.ana.db.from('issues').update({ sort_order: 'zz' }).eq('id', issue.id))
    const after = await issueRow(issue.id)
    expect(await events(issue.id)).toEqual([
      { actor_id: w.ana.profileId, changes: { title: ['Before', 'After'], status: ['todo', 'in_progress'] } },
      { actor_id: w.ana.profileId, changes: { description: true } },
    ])
    expect(after.updated_at > before.updated_at).toBe(true)
  })

  test('labels added and removed', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const label = await newLabel()
    await ok(w.bob.db.from('issue_labels').insert({ workspace_id: w.ws, issue_id: issue.id, label_id: label }))
    await ok(w.bob.db.from('issue_labels').delete().eq('issue_id', issue.id).eq('label_id', label))
    expect(await events(issue.id)).toEqual([
      { actor_id: w.bob.profileId, changes: { labels: { added: [label] } } },
      { actor_id: w.bob.profileId, changes: { labels: { removed: [label] } } },
    ])
  })

  test('archive, restore, done and back', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    expect(issue.completed_at).toBeNull()
    const done = await ok(w.ana.db.from('issues').update({ status: 'done' }).eq('id', issue.id).select().single())
    expect(done.completed_at).not.toBeNull()
    const archived = await ok(
      w.bob.db.from('issues').update({ archived_at: '2000-01-01T00:00:00Z' }).eq('id', issue.id).select().single(),
    )
    expect(archived.archived_by).toBe(w.bob.profileId)
    expect((archived.archived_at ?? '') > '2020').toBe(true)
    const restored = await ok(w.ana.db.from('issues').update({ archived_at: null }).eq('id', issue.id).select().single())
    expect(restored.archived_by).toBeNull()
    expect(restored.updated_at > archived.updated_at).toBe(true)
    const todo = await ok(w.ana.db.from('issues').update({ status: 'todo' }).eq('id', issue.id).select().single())
    expect(todo.completed_at).toBeNull()
    expect((await events(issue.id)).map((e) => e.changes)).toEqual([
      { status: ['todo', 'done'] },
      { archived: true },
      { restored: true },
      { status: ['done', 'todo'] },
    ])
  })

  test('deleting an issue with labels, or a label in use, writes no history', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const [a, b] = [await newLabel(), await newLabel()]
    await ok(w.ana.db.from('issue_labels').insert([a, b].map((label_id) => ({ workspace_id: w.ws, issue_id: issue.id, label_id }))))
    await ok(w.ana.db.from('issues').delete().eq('id', issue.id))
    expect(await events(issue.id)).toEqual([])

    const other = await newIssue(w.ana, w.ws, w.eng)
    const c = await newLabel()
    await ok(w.ana.db.from('issue_labels').insert({ workspace_id: w.ws, issue_id: other.id, label_id: c }))
    await ok(w.ana.db.from('labels').delete().eq('id', c))
    expect((await events(other.id)).map((e) => e.changes)).toEqual([{ labels: { added: [c] } }])
  })

  test('deleting leaves notes for every row that went, cascades too', async () => {
    const issue = await newIssue(w.ana, w.ws, w.eng)
    const [a, b] = [await newLabel(), await newLabel()]
    await ok(w.ana.db.from('issue_labels').insert([a, b].map((label_id) => ({ workspace_id: w.ws, issue_id: issue.id, label_id }))))
    const comment = ulid()
    await ok(w.ana.db.from('comments').insert({ id: comment, workspace_id: w.ws, issue_id: issue.id, body: 'Bye' }))
    await ok(w.ana.db.from('issue_followers').insert({ workspace_id: w.ws, issue_id: issue.id, profile_id: w.bob.profileId, following: true }))
    await ok(w.ana.db.from('issues').delete().eq('id', issue.id))
    expect(await deleted('issues')).toContainEqual({ id: issue.id })
    expect(await deleted('issue_labels')).toContainEqual({ issue_id: issue.id, label_id: a })
    expect(await deleted('issue_labels')).toContainEqual({ issue_id: issue.id, label_id: b })
    expect(await deleted('comments')).toContainEqual({ id: comment })
    expect(await deleted('issue_followers')).toContainEqual({ issue_id: issue.id, profile_id: w.bob.profileId })

    // a whole team, with a parent and its sub-issue, a view, members and a project
    const team = await newTeam(w.ana, w.ws, 'BYE')
    const parent = await newIssue(w.ana, w.ws, team)
    const child = await newIssue(w.ana, w.ws, team, { parent_id: parent.id })
    const view = ulid()
    await ok(w.ana.db.from('views').insert({ id: view, workspace_id: w.ws, team_id: team, name: 'Team view', display: DISPLAY }))
    await ok(w.ana.db.from('team_members').insert({ workspace_id: w.ws, team_id: team, profile_id: w.bob.profileId }))
    const project = ulid()
    await ok(w.ana.db.from('projects').insert({ id: project, workspace_id: w.ws, name: 'Bye' }))
    await ok(w.ana.db.from('project_teams').insert({ workspace_id: w.ws, project_id: project, team_id: team }))
    expect(await ok(w.ana.db.from('teams').delete().eq('id', team).select('id'))).toHaveLength(1)
    expect(await deleted('teams')).toContainEqual({ id: team })
    expect(await deleted('issues')).toContainEqual({ id: parent.id })
    expect(await deleted('issues')).toContainEqual({ id: child.id })
    expect(await deleted('views')).toContainEqual({ id: view })
    expect(await deleted('team_members')).toContainEqual({ team_id: team, profile_id: w.bob.profileId })
    expect(await deleted('project_teams')).toContainEqual({ project_id: project, team_id: team })
  })

  test('events read as the right lines', async () => {
    const label = await newLabel()
    const issue = await newIssue(w.ana, w.ws, w.eng, { title: 'Lines' })
    // the app adds the labels a moment after the issue (E26)
    await ok(w.ana.db.from('issue_labels').insert({ workspace_id: w.ws, issue_id: issue.id, label_id: label }))
    await ok(w.ana.db.from('issues').update({ status: 'in_progress' }).eq('id', issue.id))
    await ok(w.ana.db.from('issues').update({ status: 'done' }).eq('id', issue.id))
    await ok(w.ana.db.from('issues').update({ title: 'Renamed' }).eq('id', issue.id))
    await ok(w.bob.db.from('issues').update({ assignee_id: w.guest }).eq('id', issue.id))
    await ok(w.ana.db.rpc('move_issue_to_team', { p_issue: issue.id, p_team: w.des }))
    await ok(w.bob.db.from('issues').update({ archived_at: new Date().toISOString() }).eq('id', issue.id))
    await ok(w.ana.db.from('issues').update({ archived_at: null }).eq('id', issue.id))
    const moved = await issueRow(issue.id)

    const rows = await fetchIssueEvents(w.ana.db, w.ws, issue.id)
    expect(rows.every((r) => r.at.endsWith('Z'))).toBe(true)
    const known = new Registry()
    for (const p of [w.ana, w.bob]) known.learnProfile(p.profileId, p.login)
    known.learnProfile(w.guest, w.guestLogin)
    const lines = issueEvents(rows, { login: (id) => known.login(id), createdBy: w.ana.login, createdAt: iso(issue.created_at) })
    expect(lines.map((l) => [l.by, l.change])).toEqual([
      [w.ana.login, { kind: 'status', from: 'todo', to: 'done' }],
      [w.ana.login, { kind: 'title', from: 'Lines', to: 'Renamed' }],
      [w.bob.login, { kind: 'assignee', from: null, to: w.guestLogin }],
      [w.ana.login, { kind: 'team', from: `ENG-${issue.number}`, to: `DES-${moved.number}` }],
      [w.bob.login, { kind: 'archived' }],
      [w.ana.login, { kind: 'restored' }],
    ])

    const later = await fetchIssueEvents(w.ana.db, w.ws, issue.id, rows[2].id)
    expect(later.map((r) => r.id)).toEqual(rows.slice(3).map((r) => r.id))
    // someone outside the workspace reads nothing
    expect(await fetchIssueEvents(w.cy.db, w.ws, issue.id)).toEqual([])
  })

  test('a sub-issue whose parent is deleted loses its parent, and says so', async () => {
    const parent = await newIssue(w.ana, w.ws, w.eng)
    const child = await newIssue(w.ana, w.ws, w.eng, { parent_id: parent.id })
    await ok(w.ana.db.from('issues').delete().eq('id', parent.id))
    expect((await issueRow(child.id)).parent_id).toBeNull()
    expect((await events(child.id)).map((e) => e.changes)).toEqual([{ parent: [parent.id, null] }])
  })
})
