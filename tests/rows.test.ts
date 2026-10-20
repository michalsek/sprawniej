import { describe, expect, test } from 'bun:test'
import { Registry } from '@/backend/registry'
import {
  compareStamp,
  inboxToRow,
  iso,
  isoOrNull,
  issueToRows,
  labelToRow,
  micros,
  personToProfile,
  projectToRows,
  rowToInbox,
  rowToIssue,
  rowToLabel,
  rowToMember,
  rowToPerson,
  rowToProject,
  rowToStatus,
  rowToTeam,
  rowToView,
  teamToRows,
  viewToRow,
} from '@/backend/rows'
import type { Row } from '@/backend/tables'
import type { IssueRow } from '@/features/import/linearMap'
import type { Issue, View } from '@/model/schema'

const WS = 'ws-1'
const T = (s: number, us = '123456') => `2026-10-19T12:00:${String(s).padStart(2, '0')}.${us}+00:00`

function registry() {
  const r = new Registry()
  r.learnProfile('p-ana', 'ana')
  r.learnProfile('p-bob', 'bob')
  r.learnProfile('p-jan', '~jan')
  r.learnTeam('t-eng', 'ENG')
  r.learnTeam('t-web', 'WEB')
  return r
}

/** a resolver that writes down every id it didn't know */
function resolver() {
  const missed: string[] = []
  return { registry: registry(), miss: (id: string, table: string) => missed.push(`${table}:${id}`), missed }
}

const profile = (more: Partial<Row<'profiles'>> = {}): Row<'profiles'> => ({
  id: 'p-ana',
  user_id: 'u-1',
  login: 'ana',
  github_id: 123,
  name: 'Ana',
  avatar_url: 'https://a/ana.png',
  name_set_here: false,
  guest_of: null,
  handle: null,
  linear_ids: [],
  created_at: T(0),
  changed_at: T(0),
  extra: {},
  ...more,
})

const issueRow = (more: Partial<Row<'issues'>> = {}): Row<'issues'> => ({
  id: '01JISSUE000000000001',
  workspace_id: WS,
  team_id: 't-eng',
  number: 7,
  title: 'Fix the chart',
  description: 'It is **broken**',
  status: 'todo',
  status_id: 'status-todo',
  priority: 2,
  assignee_id: null,
  project_id: null,
  parent_id: null,
  due_date: null,
  estimate: null,
  sort_order: 'a0',
  duplicate_of: null,
  former_refs: [],
  created_by: 'p-ana',
  created_at: T(1),
  updated_at: T(2),
  completed_at: null,
  archived_at: null,
  archived_by: null,
  linear_id: null,
  changed_at: T(2),
  extra: {},
  ...more,
})

describe('times', () => {
  test('database times become the app form, milliseconds cut', () => {
    expect(iso('2026-10-19T12:28:00+00:00')).toBe('2026-10-19T12:28:00.000Z')
    expect(iso('2026-10-19T12:28:00.999999+00:00')).toBe('2026-10-19T12:28:00.999Z')
    expect(iso('2026-10-19T12:28:00.5+00:00')).toBe('2026-10-19T12:28:00.500Z')
    expect(iso('2026-10-19T12:28:00.1234+00:00')).toBe('2026-10-19T12:28:00.123Z')
    expect(iso('2026-10-19T14:28:00.816096+02:00')).toBe('2026-10-19T12:28:00.816Z')
    expect(iso('2026-10-19 12:28:00.816096+00')).toBe('2026-10-19T12:28:00.816Z')
    expect(iso('2026-10-19T12:28:00.816Z')).toBe('2026-10-19T12:28:00.816Z')
    expect(isoOrNull(null)).toBeNull()
    expect(iso('soon')).toBe('soon')
  })

  test('change times compare to the microsecond', () => {
    const a = '2026-10-19T12:28:00.123456+00:00'
    const b = '2026-10-19T12:28:00.123457+00:00'
    expect(compareStamp(a, b)).toBe(-1)
    expect(compareStamp(b, a)).toBe(1)
    expect(iso(a)).toBe(iso(b))
    expect(compareStamp('2026-10-19T12:28:00.1234+00:00', '2026-10-19T12:28:00.123400+00:00')).toBe(0)
    expect(compareStamp('2026-10-19T14:28:00.5+02:00', '2026-10-19T12:28:00.500000Z')).toBe(0)
    expect(micros('2026-10-19T12:28:00.000001+00:00')! - micros('2026-10-19T12:28:00+00:00')!).toBe(1n)
  })

  test('a missing or unreadable time is the oldest', () => {
    expect(compareStamp(null, T(1))).toBe(-1)
    expect(compareStamp(T(1), '')).toBe(1)
    expect(compareStamp(undefined, null)).toBe(0)
    expect(micros('nonsense')).toBeNull()
  })
})

describe('people', () => {
  test('no GitHub id is 0 in the app and null in the database', () => {
    const p = rowToPerson(profile({ github_id: null }))
    expect(p.githubId).toBe(0)
    expect(personToProfile(p, WS, registry()).github_id).toBeNull()
    expect(personToProfile(rowToPerson(profile()), WS, registry()).github_id).toBe(123)
  })

  test('a guest keeps one Linear id, an account can have several', () => {
    const guest = rowToPerson(profile({ id: 'p-jan', login: '~jan', user_id: null, github_id: null, guest_of: WS, linear_ids: ['L-1'] }))
    expect(guest).toEqual({ login: '~jan', githubId: 0, name: 'Ana', avatarUrl: 'https://a/ana.png', linearId: 'L-1' })
    expect(personToProfile(guest, WS, registry())).toMatchObject({ id: 'p-jan', guest_of: WS, linear_ids: ['L-1'] })
    const account = rowToPerson(profile({ linear_ids: ['L-1', 'L-2'] }))
    expect(account.linearIds).toEqual(['L-1', 'L-2'])
    expect(account.linearId).toBeUndefined()
    expect(personToProfile(account, WS, registry())).toMatchObject({ id: 'p-ana', guest_of: null, linear_ids: ['L-1', 'L-2'] })
  })

  test('a handle only when it isn’t the login, and never kept in extra', () => {
    expect(rowToPerson(profile({ handle: 'ania' })).handle).toBe('ania')
    expect('handle' in rowToPerson(profile())).toBe(false)
    expect('handle' in rowToPerson(profile({ handle: 'ana' }))).toBe(false)
    expect(rowToPerson(profile({ handle: 'ania', extra: { handle: 'old' } })).handle).toBe('ania')
    expect(personToProfile(rowToPerson(profile({ handle: 'ania' })), WS, registry()).extra).toEqual({})
  })

  test('a name typed here is remembered', () => {
    expect(rowToPerson(profile({ name_set_here: true })).nameSetHere).toBe(true)
    expect('nameSetHere' in rowToPerson(profile())).toBe(false)
    expect(personToProfile(rowToPerson(profile({ name_set_here: true })), WS, registry()).name_set_here).toBe(true)
  })

  test('a member: role and when they left', () => {
    expect(rowToMember({ role: 'admin', removed_at: T(3) })).toEqual({ role: 'admin', removedAt: '2026-10-19T12:00:03.123Z' })
    expect(rowToMember({ role: 'member', removed_at: null })).toEqual({ role: 'member', removedAt: null })
  })
})

describe('extra fields', () => {
  test('fields without a column travel in extra, and back', () => {
    const label = rowToLabel({ id: 'l-1', workspace_id: WS, name: 'Bug', color: '#f00', linear_id: null, changed_at: T(1), extra: { foo: 1, nested: { a: [1, 2] } } })
    expect(label).toEqual({ id: 'l-1', name: 'Bug', color: '#f00', foo: 1, nested: { a: [1, 2] } } as never)
    const row = labelToRow(label, WS)
    expect(row.extra).toEqual({ foo: 1, nested: { a: [1, 2] } })
    expect('foo' in row).toBe(false)
  })

  test('a column always wins over extra', () => {
    const issue = rowToIssue(issueRow({ extra: { title: 'Sneaky', foo: 'bar' } }), [], [], resolver())!.issue
    expect(issue.title).toBe('Fix the chart')
    expect(issue.foo).toBe('bar')
  })

  test('names the app has its own field for are not taken from extra', () => {
    const label = rowToLabel({ id: 'l-1', workspace_id: WS, name: 'Bug', color: '#f00', linear_id: null, changed_at: T(1), extra: { linearId: 'stale', foo: 1 } })
    expect(label).toEqual({ id: 'l-1', name: 'Bug', color: '#f00', foo: 1 } as never)
    const issue = rowToIssue(issueRow({ extra: { team: 'XYZ', subscribers: ['eve'], archivedAt: 'x' } }), [], [], resolver())!
    expect(issue.archived).toBe(false)
    expect(issue.issue.team).toBe('ENG')
    expect('subscribers' in issue.issue || 'archivedAt' in issue.issue).toBe(false)
  })

  test('names the app makes up never go into extra', () => {
    const issue = {
      ...rowToIssue(issueRow({ linear_id: 'LIN-1', assignee_id: 'p-bob' }), [{ label_id: 'l-1' }], [{ profile_id: 'p-bob', following: true }], resolver())!.issue,
      formerRefs: ['WEB-1'],
      archivedAt: T(5),
      archivedBy: 'ana',
      comments: [],
      foo: 1,
    }
    expect(issueToRows(issue, WS, registry()).issues.extra).toEqual({ foo: 1 })
  })
})

describe('issues', () => {
  test('ids become the team key and logins; labels in the order they were added', () => {
    const r = resolver()
    const labels = [
      { label_id: 'l-b', changed_at: T(1) },
      { label_id: 'l-a', changed_at: T(1) },
      { label_id: 'l-c', changed_at: T(0) },
      { label_id: 'l-d' }, // not saved yet
    ]
    const issue = rowToIssue(issueRow({ assignee_id: 'p-bob' }), labels, [], r)!.issue
    expect(issue.team).toBe('ENG')
    expect(issue.assignee).toBe('bob')
    expect(issue.createdBy).toBe('ana')
    expect(issue.labels).toEqual(['l-c', 'l-a', 'l-b', 'l-d'])
    expect(r.missed).toEqual([])
  })

  test('followers: sorted, and left out when there are none', () => {
    const followers = [
      { profile_id: 'p-bob', following: true },
      { profile_id: 'p-ana', following: true },
      { profile_id: 'p-jan', following: false },
    ]
    const issue = rowToIssue(issueRow(), [], followers, resolver())!.issue
    expect(issue.subscribers).toEqual(['ana', 'bob'])
    expect(issue.unsubscribed).toEqual(['~jan'])
    const none = rowToIssue(issueRow(), [], [], resolver())!.issue
    expect('subscribers' in none || 'unsubscribed' in none).toBe(false)
  })

  test('empty columns are null, times are in the app form, Linear id only when there is one', () => {
    const issue = rowToIssue(issueRow(), [], [], resolver())!.issue
    expect(issue).toMatchObject({ assignee: null, project: null, parent: null, dueDate: null, estimate: null, completedAt: null, duplicateOf: null })
    expect(issue.createdAt).toBe('2026-10-19T12:00:01.123Z')
    expect('linearId' in issue || 'formerRefs' in issue).toBe(false)
    const linked = rowToIssue(issueRow({ linear_id: 'LIN-1', estimate: 1.5, former_refs: ['WEB-2'] }), [], [], resolver())!.issue
    expect(linked).toMatchObject({ linearId: 'LIN-1', estimate: 1.5, formerRefs: ['WEB-2'] })
    expect(issueToRows(linked, WS, registry()).issues.linear_id).toBe('LIN-1')
  })

  test('someone unknown stands in by id until they arrive; an unknown team hides the issue', () => {
    const r = resolver()
    expect(rowToIssue(issueRow({ assignee_id: 'p-new' }), [], [], r)!.issue.assignee).toBe('p-new')
    expect(rowToIssue(issueRow({ team_id: 't-new' }), [], [], r)).toBeUndefined()
    expect(r.missed).toEqual(['profiles:p-new', 'teams:t-new'])
  })

  test('an archived issue carries when, who and its comments', () => {
    const result = rowToIssue(issueRow({ archived_at: T(9), archived_by: null }), [], [], resolver())
    expect(result?.archived).toBe(true)
    expect(result?.issue).toMatchObject({ archivedAt: '2026-10-19T12:00:09.123Z', archivedBy: '', comments: [] })
  })

  test('an issue the import builds comes back the same after a trip through the database', () => {
    const fixture: IssueRow = {
      id: '01JISSUE000000000001',
      team: 'ENG',
      number: 7,
      title: 'Fix the chart',
      description: 'It is **broken**',
      status: 'in_progress',
      // the import sends only the category: the database gives it the category's default
      statusId: '',
      priority: 2,
      assignee: 'ana',
      labels: ['l-2', 'l-1'],
      project: 'pr-1',
      parent: null,
      dueDate: '2026-11-01',
      estimate: 3,
      sortOrder: 'a0V',
      createdBy: '~jan',
      subscribers: ['bob'],
      unsubscribed: ['~jan'],
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-01-03T03:04:05.000Z',
      completedAt: null,
      duplicateOf: null,
      linearId: 'LIN-1',
    }
    const out = issueToRows(fixture, WS, registry())
    // the database stamps each row as it is inserted, in the order sent
    const stamped = <R,>(rs: R[]) => rs.map((row, n) => ({ ...row, changed_at: T(10 + n) }))
    const back = rowToIssue({ ...out.issues, changed_at: T(20) } as Row<'issues'>, stamped(out.issue_labels), stamped(out.issue_followers), resolver())
    expect(back).toEqual({ archived: false, issue: fixture })
  })
})

describe('teams, projects, views, inbox', () => {
  test('a team: members in the order they joined, and its settings', () => {
    const row: Row<'teams'> = { id: 't-eng', workspace_id: WS, key: 'ENG', name: 'Engineering', emoji: '🛠️', last_number: 12, auto_archive: 0, linear_id: null, created_at: T(0), changed_at: T(0), extra: {} }
    const team = rowToTeam(row, [{ profile_id: 'p-bob', changed_at: T(2) }, { profile_id: 'p-ana', changed_at: T(1) }], resolver())
    expect(team).toEqual({ key: 'ENG', name: 'Engineering', emoji: '🛠️', members: ['ana', 'bob'], createdAt: '2026-10-19T12:00:00.123Z', lastNumber: 12, autoArchive: 0 })
    const out = teamToRows(team, WS, registry())
    expect(out.teams).toMatchObject({ id: 't-eng', key: 'ENG', last_number: 12, auto_archive: 0 })
    expect(out.team_members.map((m) => m.profile_id)).toEqual(['p-ana', 'p-bob'])
  })

  test('a project: lead and team keys; a team not known yet is left out', () => {
    const row: Row<'projects'> = { id: 'pr-1', workspace_id: WS, name: 'Charts', emoji: '📊', description: '', status: 'in_progress', lead_id: 'p-ana', target_date: '2026-12-01', linear_id: null, created_at: T(0), changed_at: T(0), extra: {} }
    const r = resolver()
    const project = rowToProject(row, [{ team_id: 't-web', changed_at: T(1) }, { team_id: 't-eng', changed_at: T(2) }, { team_id: 't-x', changed_at: T(3) }], r)
    expect(project).toMatchObject({ lead: 'ana', teams: ['WEB', 'ENG'], targetDate: '2026-12-01' })
    expect(r.missed).toEqual(['teams:t-x'])
    const out = projectToRows(project, WS, registry())
    expect(out.projects.lead_id).toBe('p-ana')
    expect(out.project_teams.map((t) => t.team_id)).toEqual(['t-web', 't-eng'])
  })

  test('a view: no team means the whole workspace', () => {
    const row: Row<'views'> = {
      id: 'v-1',
      workspace_id: WS,
      team_id: null,
      owner_id: 'p-ana',
      name: 'Bugs',
      emoji: '🐞',
      description: '',
      filters: { labels: ['l-1'], assignees: ['bob', null] },
      display: { layout: 'board', grouping: 'status', ordering: 'priority', showCompleted: false, showSubIssues: true },
      created_at: T(0),
      linear_id: null,
      changed_at: T(0),
      extra: {},
    }
    const view = rowToView(row, resolver())!
    expect(view).toMatchObject({ owner: 'ana', team: null, filters: { labels: ['l-1'], assignees: ['bob', null] } })
    expect(viewToRow(view, WS, registry()).team_id).toBeNull()
    const teamView: View = { ...view, team: 'ENG' }
    expect(viewToRow(teamView, WS, registry()).team_id).toBe('t-eng')
    expect(rowToView({ ...row, team_id: 't-eng' }, resolver())!.team).toBe('ENG')
  })

  test('an inbox note: read one by one, empty fields left out', () => {
    const row: Row<'inbox'> = { id: 'n-1', workspace_id: WS, recipient_id: 'p-ana', actor_id: 'p-bob', type: 'assigned', issue_id: 'i-1', comment_id: null, status: null, status_id: null, at: T(4), read_at: T(5), changed_at: T(5), extra: {} }
    const note = rowToInbox(row, resolver())
    expect(note).toEqual({ id: 'n-1', type: 'assigned', issue: 'i-1', actor: 'bob', at: '2026-10-19T12:00:04.123Z', readAt: '2026-10-19T12:00:05.123Z' })
    expect(inboxToRow(note, WS, registry(), 'ana')).toMatchObject({ recipient_id: 'p-ana', actor_id: 'p-bob', comment_id: null, read_at: note.readAt })
    expect('readAt' in rowToInbox({ ...row, read_at: null }, resolver())).toBe(false)
  })

  test('a note about an issue made from Notion, by nobody, says so', () => {
    const row: Row<'inbox'> = { id: 'n-2', workspace_id: WS, recipient_id: 'p-ana', actor_id: null, type: 'assigned', issue_id: 'i-1', comment_id: null, status: null, at: T(4), read_at: null, changed_at: T(5), extra: { from: 'notion' } }
    expect(rowToInbox(row, resolver())).toMatchObject({ actor: '', from: 'notion' })
  })
})

describe('statuses', () => {
  test('a status: what it is for, its category, name, colour, order and whether it is hidden', () => {
    const row: Row<'statuses'> = { id: 'st-testing-1', workspace_id: WS, kind: 'issue', category: 'in_progress', name: 'Testing', color: '#bb87fc', position: 'a1', hidden: false, changed_at: T(1), extra: { note: 'kept', name: 'stale' } }
    expect(rowToStatus(row)).toEqual({ id: 'st-testing-1', kind: 'issue', category: 'in_progress', name: 'Testing', color: '#bb87fc', position: 'a1', hidden: false, note: 'kept' } as never)
  })

  test('an issue reads its status; the status is never kept in extra, and a column this version doesn’t know is left out', () => {
    const issue = rowToIssue({ ...issueRow({ status_id: 'st-testing-1', extra: { statusId: 'stale' } }), brand_new: 1 } as Row<'issues'>, [], [], resolver())!.issue
    expect(issue.statusId).toBe('st-testing-1')
    expect('brand_new' in issue).toBe(false)
    expect(issueToRows(issue, WS, registry()).issues.extra).toEqual({})
    // the import doesn't send it: the database gives the category's default
    expect('status_id' in issueToRows(issue, WS, registry()).issues).toBe(false)
  })

  test('a status note names its status, both ways', () => {
    const row: Row<'inbox'> = { id: 'n-2', workspace_id: WS, recipient_id: 'p-ana', actor_id: 'p-bob', type: 'status', issue_id: 'i-1', comment_id: null, status: 'in_progress', status_id: 'st-testing-1', at: T(4), read_at: null, changed_at: T(5), extra: {} }
    const note = rowToInbox(row, resolver())
    expect(note).toMatchObject({ status: 'in_progress', statusId: 'st-testing-1' })
    expect(inboxToRow(note, WS, registry(), 'ana')).toMatchObject({ status: 'in_progress', status_id: 'st-testing-1', extra: {} })
  })
})

describe('writing', () => {
  test('a login or team key nobody knows is a mistake that says which', () => {
    const issue: Issue = rowToIssue(issueRow(), [], [], resolver())!.issue
    expect(() => issueToRows({ ...issue, assignee: 'nobody' }, WS, registry())).toThrow('nobody')
    expect(() => issueToRows({ ...issue, team: 'XYZ' }, WS, registry())).toThrow('XYZ')
    expect(() => personToProfile({ login: 'ghost', githubId: 0, name: '', avatarUrl: '' }, WS, registry())).toThrow('ghost')
  })
})
