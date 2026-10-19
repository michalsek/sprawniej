import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { Incoming } from '@/backend/apply'
import { stopWrites } from '@/backend/writes'
import { MESSAGES } from '@/backend/writes/problems'
import {
  archiveIssues,
  createComment,
  createIssue,
  createLabel,
  createProject,
  createTeam,
  createView,
  deleteLabel,
  deleteProject,
  deleteTeam,
  joinTeam,
  leaveTeam,
  moveIssueToTeam,
  teamContents,
  updateIssue,
  updateTeam,
} from '@/data/actions'
import { DEFAULT_DISPLAY } from '@/data/displays'
import { findByRef, useData } from '@/data/store'
import { profileIdOf, seed, teamIdOf, WS, type World } from './support/fakeBackend'

let w: World
let warn: ReturnType<typeof spyOn>
beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
  w = seed({ me: 'ana', teams: [{ key: 'ENG', name: 'Engineering', emoji: '🚀', members: ['ana'] }, { key: 'DES', name: 'Design', emoji: '🎨' }] })
})
afterEach(() => {
  stopWrites()
  warn.mockRestore()
})
const state = () => useData.getState()
const from = () => {
  const n = w.db.log.length
  return () => w.db.log.slice(n)
}

describe('teams', () => {
  test('rename and change the emoji; the key stays; a team needs a name', async () => {
    const sent = from()
    updateTeam('ENG', { name: '  Platform ', emoji: '🛠️' })
    expect(state().teams.ENG).toMatchObject({ key: 'ENG', name: 'Platform', emoji: '🛠️', members: ['ana'] })
    updateTeam('ENG', { name: '   ' })
    await w.settle()
    expect(sent()).toEqual([{ kind: 'update', table: 'teams', fields: { name: 'Platform', emoji: '🛠️' }, keys: [{ id: teamIdOf('ENG') }] }])
    expect(state().teams.ENG.name).toBe('Platform')
  })

  test('join and leave', async () => {
    const sent = from()
    joinTeam('DES')
    expect(state().teams.DES.members).toEqual(['ana'])
    await w.settle()
    leaveTeam('DES')
    expect(state().teams.DES.members).toEqual([])
    await w.settle()
    expect(sent()).toEqual([
      { kind: 'insert', table: 'team_members', rows: [{ workspace_id: WS, team_id: teamIdOf('DES'), profile_id: profileIdOf('ana') }] },
      { kind: 'delete', table: 'team_members', keys: [{ team_id: teamIdOf('DES'), profile_id: profileIdOf('ana') }] },
    ])
    expect(state().teams.DES).toBeDefined()
  })

  test('a new team can have issues at once', async () => {
    createTeam({ key: 'OPS', name: 'Ops', emoji: '🔧' })
    const i = createIssue({ team: 'OPS', title: 'First' })
    expect(state().issues[i.id]).toMatchObject({ team: 'OPS', number: 1 })
    await w.settle()
    expect(w.db.rows('issues')).toHaveLength(1)
    expect(state().teams.OPS.members).toEqual(['ana'])
  })

  test('a member may not delete a team: told so, nothing sent', async () => {
    useData.setState({ members: { ...state().members, ana: { role: 'member', removedAt: null } } })
    const sent = from()
    expect(deleteTeam('ENG')).toBe(false)
    await w.settle()
    expect(sent()).toEqual([])
    expect(w.told).toEqual([MESSAGES.deleteTeam])
    expect(state().teams.ENG).toBeDefined()
  })

  test('an admin deletes a team: its issues, comments and views go at once; others lose only the link', async () => {
    const a = createIssue({ team: 'ENG', title: 'Parent' })
    createComment(a.id, 'note')
    const old = createIssue({ team: 'ENG', title: 'Old' })
    const child = createIssue({ team: 'DES', title: 'Child', parent: a.id })
    const keep = createIssue({ team: 'DES', title: 'Unrelated' })
    const project = createProject({ name: 'Both', emoji: '📦', teams: ['ENG', 'DES'] })
    const engView = createView({ name: 'ENG bugs', emoji: '🐞', team: 'ENG', filters: {}, display: DEFAULT_DISPLAY })
    const wide = createView({ name: 'Mixed', emoji: '🌍', team: null, filters: { teams: ['ENG', 'DES'] }, display: DEFAULT_DISPLAY })
    await w.settle()
    archiveIssues([old.id])
    await w.settle()
    expect(teamContents('ENG')).toEqual({ issues: 1, archived: 1, comments: 1, views: 1 })
    w.db.messages()

    const sent = from()
    expect(deleteTeam('ENG')).toBe(true)
    const s = state()
    expect(s.teams.ENG).toBeUndefined()
    expect(s.issues[a.id]).toBeUndefined()
    expect(s.archive[old.id]).toBeUndefined()
    expect(s.comments[a.id]).toBeUndefined()
    expect(s.issues[child.id].parent).toBeNull()
    expect(s.issues[keep.id]).toBeDefined()
    expect(s.projects[project.id].teams).toEqual(['DES'])
    expect(s.views[engView.id]).toBeUndefined()
    expect(s.views[wide.id].filters).toEqual({ teams: ['DES'] })
    await w.settle()
    w.echo()
    await w.clock.advance(300)
    expect(sent().map((r) => [r.kind, r.kind !== 'notes' && r.kind !== 'call' ? r.table : ''])).toEqual([
      ['delete', 'teams'],
      ['update', 'views'],
    ])
    expect(w.db.rows('issues').map((i) => i.title).sort()).toEqual(['Child', 'Unrelated'])
    expect(state().issues[child.id].parent).toBeNull()
    expect(state().projects[project.id].teams).toEqual(['DES'])
  })
})

test('a moved issue answers to its old number, whichever comes first: the saved row or its echo', async () => {
  const issue = createIssue({ team: 'ENG', title: 'Moves around' })
  await w.settle()
  w.db.messages()
  w.db.hold()
  moveIssueToTeam(issue.id, 'DES')
  await w.settle()
  // the echo again after the saved row, then an older copy of the row: it stays in DES
  w.echo()
  const stale = { ...w.db.get('issues', { id: issue.id }), team_id: teamIdOf('ENG'), changed_at: '2026-10-19T11:00:00.000000+00:00' }
  w.target.apply([{ from: 'fetch', table: 'issues', rows: [stale] } as Incoming])
  expect(state().issues[issue.id]).toMatchObject({ team: 'DES', number: 1 })
  expect(findByRef(state().issues, `ENG-${issue.number}`)?.id).toBe(issue.id)
  expect(findByRef(state().issues, 'DES-1')?.id).toBe(issue.id)
})

test('the echo first, then the saved row: still in DES', async () => {
  const issue = createIssue({ team: 'ENG', title: 'Moves around' })
  await w.settle()
  w.db.messages()
  w.db.hold()
  moveIssueToTeam(issue.id, 'DES')
  await new Promise((r) => setTimeout(r, 0))
  // the database moves it, its echo comes before the answer does
  w.db.release(1)
  await Promise.resolve()
  w.echo()
  await w.settle()
  expect(state().issues[issue.id]).toMatchObject({ team: 'DES', number: 1, formerRefs: [`ENG-${issue.number}`] })
})

test('deleting a label, project or team takes it out of saved views', async () => {
  const label = createLabel('Bug')
  const keep = createLabel('Design')
  const project = createProject({ name: 'Launch', emoji: '🚀', teams: ['ENG'] })
  const view = createView({ name: 'Mixed', emoji: '🧪', team: null, filters: { labels: [label.id, keep.id], projects: [project.id], teams: ['DES', 'ENG'] }, display: DEFAULT_DISPLAY })
  const i = createIssue({ team: 'ENG', title: 'Tagged', labels: [label.id] })
  await w.settle()
  deleteLabel(label.id)
  expect(state().issues[i.id].labels).toEqual([])
  deleteProject(project.id)
  deleteTeam('DES')
  expect(state().views[view.id].filters).toEqual({ labels: [keep.id], projects: [project.id], teams: ['ENG'] })
  await w.settle()
  expect(w.db.get('views', { id: view.id })?.filters).toEqual({ labels: [keep.id], projects: [project.id], teams: ['ENG'] })
  expect(w.db.rows('issue_labels')).toEqual([])
  updateIssue(i.id, { title: 'Still here' })
  await w.settle()
  expect(w.db.get('issues', { id: i.id })?.title).toBe('Still here')
})
