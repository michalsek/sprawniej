import { describe, expect, test } from 'bun:test'
import { generateNKeysBetween } from 'fractional-indexing'
import { linearIdsOf } from '@/model/schema'
import { EMPTY } from '@/data/store'
import { buildImport, existingFrom, guestLogins, emojiFor, freeKey, guessPerson, involvedUsers, mapStatus, rewriteLinks, type Existing, type ImportChoices, type ImportExtras, type ImportResult, type IssueRow } from '@/features/import/linearMap'
import type { Issue, Project, Team, View } from '@/model/schema'
import { ImportProblem } from '@/backend/importRows'
import { prepareImport } from '@/features/import/prepareImport'
import { linearFixture as data } from './fixtures/linear'

const person = (login: string, name: string) => ({ login, githubId: 1, name, avatarUrl: '' })
const people = [person('ana-n', 'Ana Nowak'), person('bstone', 'Robert'), person('mikolaj', 'Mikołaj Pocheć')]

describe('matching people', () => {
  test('by name, ignoring accents, or by the e-mail name', () => {
    expect(guessPerson(data.users[0], people)).toBe('ana-n')
    expect(guessPerson(data.users[1], people)).toBe('bstone')
    expect(guessPerson({ ...data.users[2], name: 'Mikolaj Pochec' }, people)).toBe('mikolaj')
    expect(guessPerson(data.users[2], people)).toBeNull()
  })
  test('by the @handle someone has now, not a login they moved off', () => {
    const renamed = [{ ...person('rs', 'Someone'), handle: 'bstone' }, { ...person('ana-n', 'A. N.'), handle: 'an' }]
    expect(guessPerson(data.users[1], renamed)).toBe('rs')
    expect(guessPerson({ ...data.users[0], name: 'Anna', displayName: 'ana-n' }, renamed)).toBeNull()
  })
  test('only people who appear in the issues and views', () => {
    expect(involvedUsers({ ...data, issues: data.issues.slice(1, 3), comments: [], views: [] }).map((u) => u.id)).toEqual(['u-ana', 'u-old'])
    // subscribers and people a view filters by count too
    expect(involvedUsers({ ...data, comments: [], views: [] }).map((u) => u.id)).toContain('u-cat')
    expect(involvedUsers({ ...data, issues: [], comments: [], views: data.views!.filter((v) => v.id === 'v-cat') }).map((u) => u.id)).toEqual(['u-cat'])
  })
  test('people who aren’t here get a ~login of their own, kept from one import to the next', () => {
    const g = guestLogins(data.users, {})
    expect(g.get('u-old')).toBe('~old-timer')
    expect(g.get('u-cat')).toBe('~cat-wong')
    const taken = guestLogins(data.users, { '~cat-wong': { login: '~cat-wong', githubId: 0, name: 'Another Cat', avatarUrl: '' } })
    expect(taken.get('u-cat')).toMatch(/^~cat-wong-/)
    const kept = guestLogins(data.users, { '~catw': { login: '~catw', githubId: 0, name: 'Cat Wong', avatarUrl: '', linearId: 'u-cat' } as never })
    expect(kept.get('u-cat')).toBe('~catw')
    const linked = guestLogins(data.users, { '~catw': { login: '~catw', githubId: 0, name: 'Cat Wong', avatarUrl: '', linearIds: ['u-cat'] } as never })
    expect(linked.get('u-cat')).toBe('~catw')
    // Linear sometimes only knows an e-mail address as the name
    const mail = guestLogins([{ ...data.users[3], id: 'u-mail', name: 'jan.kowalski@acme.dev', displayName: 'jan' }], {})
    expect(mail.get('u-mail')).toBe('~jan')
    expect(guestLogins([{ ...data.users[3], id: 'u-l', name: 'Łukasz Bąk' }], {}).get('u-l')).toBe('~lukasz-bak')
  })
  test('someone linked to an account before is matched to it, whatever their name', () => {
    const linked = { ...person('dk', 'Somebody Else'), linearIds: ['u-old'] }
    expect(guessPerson(data.users.find((u) => u.id === 'u-old')!, [...people, linked])).toBe('dk')
  })
})

describe('mapping', () => {
  test('statuses by name, then by kind', () => {
    expect(mapStatus({ name: 'In Review', type: 'started' })).toBe('in_review')
    expect(mapStatus({ name: 'QA', type: 'started' })).toBe('in_progress')
    expect(mapStatus({ name: 'Triage', type: 'triage' })).toBe('backlog')
    expect(mapStatus({ name: 'Cancelled', type: 'canceled' })).toBe('canceled')
    expect(mapStatus({ name: 'Duplicate', type: 'canceled' })).toBe('duplicate')
  })
  test('icons', () => {
    expect(emojiFor('Rocket', '📦')).toBe('🚀')
    expect(emojiFor('🎨', '📦')).toBe('🎨')
    expect(emojiFor('SomethingElse', '📦')).toBe('📦')
  })
  test('free keys', () => {
    expect(freeKey('ENG', new Set(['ENG', 'ENG2']))).toBe('ENG3')
    expect(freeKey('des', new Set())).toBe('DES')
  })
  test('links to imported issues become references here', () => {
    const refs = new Map([
      ['ENG-2', 'ENG-2'],
      ['DES-1', 'DSN-4'],
    ])
    expect(rewriteLinks('a https://linear.app/acme/issue/ENG-2/fix and [x](https://linear.app/acme/issue/ENG-2/fix) and https://linear.app/acme/issue/OPS-1/y', refs)).toBe(
      'a ENG-2 and ENG-2 and https://linear.app/acme/issue/OPS-1/y',
    )
    expect(rewriteLinks('see <https://linear.app/acme/issue/DES-1/logo>', refs)).toBe('see DSN-4')
  })
})

const NOW = '2026-03-01T00:00:00.000Z'
const empty = (): Existing => ({ me: 'mikolaj', teams: {}, issues: {}, labels: {}, projects: {}, comments: {}, archivedByLinear: {}, archivedComments: {}, usedNumbers: {} })
const choices: ImportChoices = { teamKeys: { 't-eng': 'ENG' }, people: { 'u-ana': 'ana-n', 'u-bob': 'bstone', 'u-old': null } }
const guests: ImportChoices = { ...choices, people: { ...choices.people, 'u-old': '~old-timer', 'u-cat': '~cat-wong' } }
// every run hands out ids of its own, so a second run never reuses one from the first
let runs = 0
const ids = () => {
  const at = ++runs
  let n = 0
  return () => `r${at}-id${++n}`
}
const uuids = () => {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}
const run = (d = data, c = choices, ws = empty(), now = NOW) => buildImport(d, c, ws, { newId: ids(), newGuestId: uuids(), now })
const byTitle = (t: string, rows: IssueRow[]) => rows.find((i) => i.title === t)!
const eng: Team = { key: 'ENG', name: 'Eng', emoji: '🛠️', members: ['mikolaj'], createdAt: NOW }
/** real order keys, so an import that puts new issues above these can work out keys between them */
const KEYS = generateNKeysBetween(null, null, 100)
const native = (n: number): Issue => ({ id: `mine${n}`, team: 'ENG', number: n, title: `Made here ${n}`, description: '', status: 'todo', statusId: 'status-todo', priority: 0, assignee: null, labels: [], project: null, parent: null, sortOrder: KEYS[n], createdBy: 'mikolaj', createdAt: NOW, updatedAt: NOW })
/** a workspace's issues, top of the list first */
const issuesIn = (ws: Existing) => Object.values(ws.issues).sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1))

/** every row the import would write */
const written = (r: ImportResult) => ({
  guests: r.guests,
  guestEmails: r.guestEmails,
  teams: r.teams,
  teamLinks: r.teamLinks,
  teamMembers: r.teamMembers,
  labels: r.labels,
  projects: r.projects,
  issues: r.issues,
  comments: r.comments,
  views: r.views,
  links: r.links,
  removedViews: r.removedViews,
  removedLabels: r.removedLabels,
  removedProjectTeams: r.removedProjectTeams,
  removedFollowers: r.removedFollowers,
})
const nothing = {
  guests: [],
  guestEmails: [],
  teams: [],
  teamLinks: [],
  teamMembers: [],
  labels: [],
  projects: [],
  issues: [],
  comments: [],
  views: [],
  links: [],
  removedViews: [],
  removedLabels: [],
  removedProjectTeams: [],
  removedFollowers: [],
}

/** the workspace after the import's rows are saved, the way the database will do it */
function apply(ws: Existing, r: ImportResult): Existing {
  const next: Existing = {
    ...ws,
    people: { ...ws.people },
    teams: { ...ws.teams },
    issues: { ...ws.issues },
    labels: { ...ws.labels },
    projects: { ...ws.projects },
    comments: { ...ws.comments },
    views: { ...ws.views },
    archivedByLinear: { ...ws.archivedByLinear },
    archivedComments: { ...ws.archivedComments },
    usedNumbers: { ...ws.usedNumbers },
  }
  const people = next.people!
  const views = next.views!
  // new ones, and ones whose name or picture changed
  for (const g of r.guests) {
    const { id: _id, ...person } = g
    people[g.login] = person
  }
  next.guestEmails = { ...ws.guestEmails, ...Object.fromEntries(r.guestEmails.map((e) => [e.login, e.email])) }
  for (const t of r.teams) next.teams[t.key] = t
  for (const t of r.teamMembers) next.teams[t.key] = { ...next.teams[t.key], members: t.members }
  for (const { key, linearId } of r.teamLinks) {
    const { linearId: _was, ...team } = next.teams[key]
    next.teams[key] = linearId ? { ...team, linearId } : team
  }
  for (const l of r.labels) next.labels[l.id] = l
  for (const p of r.projects) next.projects[p.id] = p
  for (const i of r.issues) {
    next.usedNumbers[i.team] = [...(next.usedNumbers[i.team] ?? []), i.number]
    const { archivedAt, archivedBy: _by, ...issue } = i
    if (archivedAt) {
      next.archivedByLinear[i.linearId] = { id: i.id, team: i.team, number: i.number }
      delete next.issues[i.id]
    } else next.issues[i.id] = issue
  }
  const archived = new Set(Object.values(next.archivedByLinear).map((a) => a.id))
  for (const c of r.comments) {
    if (archived.has(c.issue)) next.archivedComments[c.linearId] = { id: c.id, issue: c.issue }
    else next.comments[c.issue] = [...(next.comments[c.issue] ?? []).filter((x) => x.id !== c.id), c]
  }
  for (const v of r.views) views[v.id] = v
  for (const id of r.removedViews) delete views[id]
  for (const { guest, to } of r.links) {
    const was = people[guest]
    delete people[guest]
    const account = people[to] ?? { login: to, githubId: 0, name: to, avatarUrl: '' }
    people[to] = { ...account, linearIds: [...new Set([...linearIdsOf(account), ...linearIdsOf(was)])] }
  }
  return next
}

describe('building the import', () => {
  const r = run()
  const charts = byTitle('Charts are slow', r.issues)

  test('only the chosen team, with numbers, statuses and people', () => {
    expect(r.counts).toEqual({ teams: 1, labels: 3, projects: 1, issues: 3, comments: 2, archived: 0, views: 9 })
    expect(r.teams).toMatchObject([{ key: 'ENG', linearId: 't-eng', name: 'Engineering', emoji: '🚀' }])
    expect(r.teamLinks).toEqual([])
    expect([...r.teams[0].members].sort()).toEqual(['ana-n', 'bstone', 'mikolaj'])
    expect(charts).toMatchObject({ number: 1, status: 'in_review', priority: 2, assignee: 'bstone', createdBy: 'ana-n', dueDate: '2026-11-03', estimate: 5 })
    expect('dueDate' in byTitle('Old idea', r.issues)).toBe(false)
    expect(byTitle('Old idea', r.issues)).toMatchObject({ status: 'backlog', createdBy: 'mikolaj' })
    expect(byTitle('Fix the axis', r.issues)).toMatchObject({ status: 'done', completedAt: '2026-02-01T00:00:00.000Z', parent: charts.id })
    // every row remembers where it came from; nothing goes to the archive yet
    const rows = [...r.teams, ...r.labels, ...r.projects, ...r.issues, ...r.comments, ...r.views]
    expect(rows.every((x) => typeof x.linearId === 'string')).toBe(true)
    expect(r.issues.some((i) => 'archivedAt' in i)).toBe(false)
  })
  test('labels are flattened and merged by name; only used ones come (and ones a view needs)', () => {
    expect(r.labels.map((l) => l.name).sort()).toEqual(['Area: Charts', 'Bug', 'Unused'])
    expect(r.labels.find((l) => l.name === 'Bug')?.linearId).toBe('l-bug')
    expect(byTitle('Fix the axis', r.issues).labels).toEqual(charts.labels.slice(0, 1))
  })
  test('projects, order, links and comments', () => {
    const project = r.projects[0]
    expect(project).toMatchObject({ name: 'Launch', emoji: '🚩', status: 'in_progress', lead: 'ana-n', teams: ['ENG'], targetDate: '2026-12-01', linearId: 'p-launch' })
    expect(charts.project).toBe(project.id)
    const order = [...r.issues].sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1)).map((i) => i.number)
    expect(order).toEqual([2, 3, 1])
    expect(charts.description).toBe('See ENG-2 and ENG-2 and https://linear.app/acme/issue/OPS-9/x')
    expect(r.comments.filter((c) => c.issue === charts.id).map((c) => [c.author, c.body])).toEqual([
      ['bstone', 'On it'],
      ['mikolaj', '*From Linear: Old Timer*\n\nBack in my day'],
    ])
  })

  test('views: the chosen teams’ and the workspace’s, with the filters that fit', () => {
    const byName = (n: string) => r.views.find((v) => v.name === n)!
    expect(r.views.map((v) => v.name).sort()).toEqual(['@ Area', '@ Unused', 'Ana', 'Bob follows', 'Bob’s or followed', 'Bob’s urgent work', 'Nobody’s', 'Open bugs', 'Recent launch work'])
    const bug = r.labels.find((l) => l.name === 'Bug')!.id
    expect(byName('Open bugs')).toMatchObject({ team: 'ENG', emoji: '🐞', owner: 'ana-n', description: 'Bugs still to fix', filters: { statuses: ['todo', 'in_progress', 'in_review'], labels: [bug] } })
    expect(byName('Bob’s urgent work')).toMatchObject({ team: null, owner: 'bstone', filters: { assignees: ['bstone'], priorities: [1, 2], teams: ['ENG'], statuses: ['in_review'] } })
    expect(byName('Nobody’s').filters).toEqual({ assignees: [null] })
    expect(byName('Recent launch work').filters).toEqual({ projects: [r.projects[0].id] })
    expect(byName('Recent launch work').owner).toBe('mikolaj') // matched to no one: you
    expect(r.inexactViews).toEqual(['Recent launch work'])
  })

  test('views saved by Linear’s app: choices inside each field, labels with their sub-labels', () => {
    const byName = (n: string) => r.views.find((v) => v.name === n)!
    const label = (n: string) => r.labels.find((l) => l.name === n)!.id
    expect(byName('@ Area').filters).toEqual({ labels: [label('Area: Charts')] })
    // no issue has it, but the view needs it, so it comes over (the view starts empty, as in Linear)
    expect(byName('@ Unused').filters).toEqual({ labels: [label('Unused')] })
    expect(label('Unused')).toBeDefined()
    expect(byName('Ana').filters).toEqual({ assignees: ['ana-n'] })
    // "subscribed", and "assigned or subscribed" (people follow what they're assigned to): both are "Bob follows it"
    expect(byName('Bob follows').filters).toEqual({ subscribers: ['bstone'] })
    expect(byName('Bob’s or followed').filters).toEqual({ subscribers: ['bstone'] })
    expect(r.inexactViews).not.toContain('Bob’s or followed')
    // Cat is matched to no one, so nothing here can say "Cat follows it": left out instead of showing every issue
    expect(r.skippedViews).toEqual(['Cat'])
  })

  test('subscribers come over, without the people who follow the issue anyway', () => {
    // Bob is assigned and Ana created it: they follow it anyway; Cat is matched to no one
    expect(charts.subscribers).toBeUndefined()
    const withCat = run(data, { ...choices, people: { ...choices.people, 'u-cat': 'cwong' } })
    expect(byTitle('Charts are slow', withCat.issues).subscribers).toEqual(['cwong'])
    // the creator who isn't on Linear's list unsubscribed there; Linear didn't send a list for the others
    const gone = run({ ...data, issues: data.issues.map((i) => (i.id === 'i-1' ? { ...i, subscribers: { nodes: [{ id: 'u-bob' }] } } : i)) })
    expect(byTitle('Charts are slow', gone.issues).unsubscribed).toEqual(['ana-n'])
    expect(byTitle('Old idea', gone.issues).unsubscribed).toBeUndefined()
  })

  test('a person matched to no one: their view is left out', () => {
    const noAna = run(data, { ...choices, people: { ...choices.people, 'u-ana': null } })
    expect(noAna.skippedViews).toContain('Ana')
  })

  test('issues finished long ago go straight into the archive', () => {
    const later = run(data, choices, empty(), '2026-10-07T00:00:00.000Z')
    expect(later.counts).toMatchObject({ issues: 3, archived: 1 })
    const axis = byTitle('Fix the axis', later.issues)
    expect(axis).toMatchObject({ archivedAt: '2026-10-07T00:00:00.000Z', archivedBy: 'mikolaj', number: 2, parent: byTitle('Charts are slow', later.issues).id })
    expect(later.issues.filter((i) => i.archivedAt).map((i) => i.title)).toEqual(['Fix the axis'])
    // changed since it was finished: it stays out of the archive, as with the daily tidy-up
    const touched = run({ ...data, issues: data.issues.map((i) => (i.id === 'i-2' ? { ...i, updatedAt: '2026-09-01T00:00:00.000Z' } : i)) }, choices, empty(), '2026-10-07T00:00:00.000Z')
    expect(touched.counts.archived).toBe(0)
    expect('archivedAt' in byTitle('Fix the axis', touched.issues)).toBe(false)
    // a comment it has in Linear comes with it, pointing at the archived issue
    const late = { id: 'c-late', body: 'Still broken?', createdAt: '2026-10-01T00:00:00.000Z', user: { id: 'u-bob', name: 'Bob Stone' }, issue: { id: 'i-2' } }
    const early = run({ ...data, comments: [...data.comments, late] }, choices, empty(), '2026-10-07T00:00:00.000Z')
    expect(early.comments.find((c) => c.linearId === 'c-late')?.issue).toBe(byTitle('Fix the axis', early.issues).id)
  })
})

describe('people who haven’t joined', () => {
  test('come as someone who hasn’t joined, and keep their work', () => {
    const g = run(data, guests)
    expect(g.guests.map((p) => p.login)).toEqual(['~old-timer', '~cat-wong'])
    // githubId 0: they have no GitHub account yet
    expect(g.guests[0]).toEqual({ id: '00000000-0000-4000-8000-000000000001', login: '~old-timer', githubId: 0, name: 'Old Timer', avatarUrl: '', linearId: 'u-old' })
    expect(g.guests[1]).toMatchObject({ id: '00000000-0000-4000-8000-000000000002', name: 'Cat Wong', avatarUrl: 'https://example.com/cat.png', linearId: 'u-cat' })
    expect(g.guestEmails).toEqual([])
    expect(byTitle('Old idea', g.issues).createdBy).toBe('~old-timer')
    expect(byTitle('Charts are slow', g.issues).subscribers).toEqual(['~cat-wong'])
    // their comment is theirs, with no "From Linear" line
    expect(g.comments.find((c) => c.author === '~old-timer')?.body).toBe('Back in my day')
    // their view works, and they're never made a team member
    expect(g.views.find((v) => v.name === 'Cat')?.filters).toEqual({ subscribers: ['~cat-wong'] })
    expect(g.skippedViews).toEqual([])
    expect(g.teams[0].members).not.toContain('~old-timer')
    // their e-mail address comes along, apart, when Linear knows it
    const ana = run(data, { ...guests, people: { ...guests.people, 'u-ana': '~ana-nowak' } })
    expect(ana.guests[0]).toMatchObject({ id: '00000000-0000-4000-8000-000000000001', login: '~ana-nowak' })
    expect(ana.guestEmails).toEqual([{ login: '~ana-nowak', email: 'ana@acme.dev' }])
    // made once: a later import leaves them
    expect(run(data, guests, apply(empty(), g)).guests).toEqual([])
  })

  test('once someone has joined and is matched, a later import links them to their account', () => {
    const first = run(data, guests)
    const w = apply(empty(), first)
    // an issue, a view and a project made here, about Cat: the link moves them, not the import
    const mine = { ...native(50), assignee: '~cat-wong' }
    const view = { id: 'vh', name: 'Cat’s', emoji: '🐱', description: '', owner: '~cat-wong', team: null, filters: { assignees: ['~cat-wong'] }, display: Object.values(w.views!)[0].display, createdAt: NOW } as View
    const lead = { id: 'pl', name: 'Made here', emoji: '📦', description: '', status: 'planned', statusId: '', lead: '~cat-wong', teams: [], targetDate: null, createdAt: NOW } as Project
    const before = { ...w, issues: { ...w.issues, [mine.id]: mine }, views: { ...w.views, vh: view }, projects: { ...w.projects, pl: lead } }
    const joined = { ...guests, people: { ...guests.people, 'u-cat': 'cwong' } }
    const after = run(data, joined, before, '2026-03-02T00:00:00.000Z')
    // Old Timer is still not here: left alone
    expect(after.links).toEqual([{ guest: '~cat-wong', to: 'cwong' }])
    expect(after.guests).toEqual([])
    expect(byTitle('Charts are slow', after.issues).subscribers).toEqual(['cwong'])
    expect(after.views.find((v) => v.name === 'Cat')?.filters).toEqual({ subscribers: ['cwong'] })
    expect(after.issues.map((i) => i.id)).not.toContain(mine.id)
    expect(after.views.map((v) => v.id)).not.toContain('vh')
    expect(after.projects.map((p) => p.id)).not.toContain('pl')
    // an account that remembers the Linear id (linked by hand in Settings) counts too
    const { linearId: _id, ...cat } = w.people!['~cat-wong']
    const byHand = run(data, joined, { ...before, people: { ...w.people, '~cat-wong': { ...cat, linearIds: ['u-cat'] } } }, '2026-03-02T00:00:00.000Z')
    expect(byHand.links).toEqual([{ guest: '~cat-wong', to: 'cwong' }])
    // once linked, the next import matches them by itself
    const linked = apply(before, after)
    expect(linked.people!.cwong).toMatchObject({ linearIds: ['u-cat'] })
    expect(run(data, joined, linked, '2026-03-03T00:00:00.000Z').links).toEqual([])
  })

  test('what an earlier import gave them, and Linear doesn’t say now, moves to their account too', () => {
    // Cat made "Charts are slow" and left it (Linear's list misses her); Ana owns "Open bugs"; both hadn't joined
    const firstData = { ...data, issues: data.issues.map((i) => (i.id === 'i-1' ? { ...i, creator: { id: 'u-cat' }, subscribers: { nodes: [{ id: 'u-bob' }] } } : i)) }
    const first = run(firstData, { ...guests, people: { ...guests.people, 'u-ana': '~ana-nowak' } })
    expect(byTitle('Charts are slow', first.issues)).toMatchObject({ createdBy: '~cat-wong', unsubscribed: ['~cat-wong', '~old-timer'] })
    // now Linear no longer knows who made it or who owns the view, and sends no list of subscribers
    const { subscribers: _s, ...charts } = { ...firstData.issues[0], creator: null }
    const laterData = { ...data, issues: data.issues.map((i) => (i.id === 'i-1' ? charts : i)), views: data.views!.map((v) => (v.id === 'v-bugs' ? { ...v, owner: null } : v)) }
    const after = run(laterData, { ...guests, people: { ...guests.people, 'u-cat': 'cwong', 'u-ana': 'ana-n' } }, apply(empty(), first), '2026-03-02T00:00:00.000Z')
    expect(after.links).toEqual([
      { guest: '~ana-nowak', to: 'ana-n' },
      { guest: '~cat-wong', to: 'cwong' },
    ])
    expect(byTitle('Charts are slow', after.issues)).toMatchObject({ createdBy: 'cwong', unsubscribed: ['cwong', '~old-timer'] })
    expect(after.views.find((v) => v.name === 'Open bugs')?.owner).toBe('ana-n')
  })
})

describe('running it again', () => {
  const r = run()
  const ws = apply(empty(), r)

  test('brings only what changed', () => {
    const again = run({ ...data, issues: data.issues.map((i) => (i.id === 'i-3' ? { ...i, title: 'Old idea, renamed' } : i)) }, choices, ws, '2026-03-02T00:00:00.000Z')
    expect(again.issues).toHaveLength(1)
    expect(again.issues[0]).toMatchObject({ id: byTitle('Old idea', r.issues).id, number: 3, title: 'Old idea, renamed' })
    expect({ ...written(again), issues: [] }).toEqual(nothing)
    // the counts still say what the import covers
    expect(again.counts).toEqual({ teams: 0, labels: 0, projects: 1, issues: 3, comments: 2, archived: 0, views: 9 })
  })

  test('brings nothing new when nothing changed in Linear', () => {
    for (const [c, now] of [
      [choices, NOW],
      [guests, NOW],
      [choices, '2026-10-07T00:00:00.000Z'],
    ] as const) {
      const first = run(data, c, empty(), now)
      const second = run(data, c, apply(empty(), first), now)
      expect(written(second)).toEqual(nothing)
      expect(second.counts).toEqual({ ...first.counts, teams: 0, labels: 0 })
      expect(second.inexactViews).toEqual(['Recent launch work'])
    }
  })

  test('issues here keep their place; a new one goes on top of its team', () => {
    const first = issuesIn(ws)
    const newest = { ...data.issues[2], id: 'i-4', number: 4, title: 'Newest', sortOrder: 1 }
    const again = run({ ...data, issues: [...data.issues, newest] }, choices, ws, '2026-03-02T00:00:00.000Z')
    expect(again.issues.map((i) => i.title)).toEqual(['Newest'])
    expect(again.issues[0].sortOrder < first[0].sortOrder).toBe(true)
    // Linear moving one doesn't move it here
    const moved = run({ ...data, issues: data.issues.map((i) => (i.id === 'i-1' ? { ...i, sortOrder: 0 } : i)) }, choices, ws, '2026-03-02T00:00:00.000Z')
    expect(moved.issues).toEqual([])
  })

  test('a view made by an earlier import that can’t come over now goes away', () => {
    const v = Object.values(ws.views!).find((x) => x.name === 'Ana')!
    const again = run(data, { ...choices, people: { ...choices.people, 'u-ana': null } }, ws, '2026-03-02T00:00:00.000Z')
    expect(again.removedViews).toEqual([v.id])
    expect(again.views.map((x) => x.id)).not.toContain(v.id)
  })

  test('updates views and keeps how they look', () => {
    const v = Object.values(ws.views!).find((x) => x.name === 'Open bugs')!
    const mine = { ...ws, views: { ...ws.views, [v.id]: { ...v, display: { ...v.display, layout: 'board' as const } } } }
    const again = run({ ...data, views: data.views!.map((x) => (x.id === 'v-bugs' ? { ...x, name: 'Open bugs!' } : x)) }, choices, mine, '2026-03-02T00:00:00.000Z')
    expect(again.views).toHaveLength(1)
    expect(again.views[0]).toMatchObject({ id: v.id, name: 'Open bugs!', display: { layout: 'board' } })
  })

  test('issues in the archive stay there; a comment written since joins them, once', () => {
    const ws3 = apply(empty(), run(data, choices, empty(), '2026-10-07T00:00:00.000Z'))
    const axis = ws3.archivedByLinear['i-2']
    const again = run(data, choices, ws3, '2026-10-08T00:00:00.000Z')
    expect(again.issues).toEqual([])
    expect(again.counts).toMatchObject({ issues: 3, archived: 1 })
    const late = { id: 'c-late', body: 'Still broken?', createdAt: '2026-10-01T00:00:00.000Z', user: { id: 'u-bob', name: 'Bob Stone' }, issue: { id: 'i-2' } }
    const withComment = { ...data, comments: [...data.comments, late] }
    const third = run(withComment, choices, ws3, '2026-10-09T00:00:00.000Z')
    expect(third.comments).toMatchObject([{ issue: axis.id, author: 'bstone', body: 'Still broken?', linearId: 'c-late' }])
    expect(third.counts.comments).toBe(3)
    expect(run(withComment, choices, apply(ws3, third), '2026-10-10T00:00:00.000Z').comments).toEqual([])
  })
})

describe('teams here', () => {
  test('a Linear team that joins a team here is remembered', () => {
    const existing = { ...empty(), teams: { ENG: eng } }
    const r = run(data, choices, existing)
    expect(r.teams).toEqual([])
    expect(r.teamLinks).toEqual([{ key: 'ENG', linearId: 't-eng' }])
    expect(r.counts.teams).toBe(0)
    expect(run(data, choices, apply(existing, r)).teamLinks).toEqual([])
  })

  test('a Linear team stands for one team here: the one that had it lets go', () => {
    const old: Team = { ...eng, key: 'OLD', linearId: 't-eng' }
    const intoNew = run(data, choices, { ...empty(), teams: { OLD: old } })
    expect(intoNew.teams).toMatchObject([{ key: 'ENG', linearId: 't-eng' }])
    expect(intoNew.teamLinks).toEqual([{ key: 'OLD', linearId: null }])
    const intoEng = run(data, choices, { ...empty(), teams: { OLD: old, ENG: eng } })
    expect(intoEng.teamLinks).toEqual([
      { key: 'OLD', linearId: null },
      { key: 'ENG', linearId: 't-eng' },
    ])
  })

  test('two teams here swap their Linear teams: both let go first, so none is held twice', () => {
    const des: Team = { ...eng, key: 'DES', name: 'Design', linearId: 't-des' }
    const existing = { ...empty(), teams: { ENG: { ...eng, linearId: 't-eng' }, DES: des } }
    const r = run(data, { ...choices, teamKeys: { 't-eng': 'DES', 't-des': 'ENG' } }, existing)
    const firstSet = r.teamLinks.findIndex((l) => l.linearId !== null)
    expect(r.teamLinks.slice(0, firstSet)).toEqual(expect.arrayContaining([{ key: 'ENG', linearId: null }, { key: 'DES', linearId: null }]))
    expect(r.teamLinks.slice(firstSet)).toEqual(expect.arrayContaining([{ key: 'DES', linearId: 't-eng' }, { key: 'ENG', linearId: 't-des' }]))
    expect(r.teamLinks).toHaveLength(4)
  })

  test('into a team that already has issues: clashing numbers move up, past the highest used', () => {
    const existing = { ...empty(), teams: { ENG: eng }, issues: { mine2: native(2) }, usedNumbers: { ENG: [2] } }
    const r2 = run(data, choices, existing)
    expect(r2.counts.teams).toBe(0)
    expect(r2.renumbered).toEqual([{ from: 'ENG-2', to: 'ENG-4' }])
    expect(r2.issues.map((i) => i.number).sort()).toEqual([1, 3, 4])
    // new issues go on top of what's here
    expect(r2.issues.every((i) => i.sortOrder < native(2).sortOrder)).toBe(true)
    // a number used once (maybe by an issue deleted since) counts too
    const gone = run(data, choices, { ...empty(), teams: { ENG: eng }, usedNumbers: { ENG: [1, 7] } })
    expect(gone.renumbered).toEqual([{ from: 'ENG-1', to: 'ENG-8' }])
    expect(gone.issues.map((i) => i.number).sort()).toEqual([2, 3, 8])
  })

  test('numbers never used here stay free, even below the highest one', () => {
    const r = run(data, choices, { ...empty(), teams: { ENG: { ...eng, lastNumber: 5 } }, usedNumbers: { ENG: [4, 5] } })
    expect(r.renumbered).toEqual([])
    expect(r.issues.map((i) => i.number).sort()).toEqual([1, 2, 3])
  })

  test('a second import never gives a new issue a number an earlier import already used', () => {
    const existing = { ...empty(), teams: { ENG: eng }, issues: { mine1: native(1), mine2: native(2), mine3: native(3) }, usedNumbers: { ENG: [1, 2, 3] } }
    const ws2 = apply(existing, run(data, choices, existing))
    const more = { ...data, issues: [...data.issues, { ...data.issues[2], id: 'i-4', number: 4, title: 'Brand new' }, { ...data.issues[2], id: 'i-5', number: 5, title: 'Newer still' }] }
    const final = apply(ws2, run(more, choices, ws2, '2026-03-02T00:00:00.000Z'))
    const numbers = Object.values(final.issues).filter((i) => i.team === 'ENG').map((i) => i.number)
    expect(numbers).toHaveLength(8)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  test('two Linear teams joining one team here: one team, numbers and order that don’t clash', () => {
    const more = { ...data, issues: [...data.issues, { ...data.issues[3], id: 'i-d1', number: 1, title: 'Design one' }] }
    const r = run(more, { ...choices, teamKeys: { 't-eng': 'ENG', 't-des': 'ENG' } })
    expect(r.teams).toMatchObject([{ key: 'ENG', linearId: 't-eng' }])
    // the moved one shows its number in Linear
    expect(r.renumbered).toEqual([{ from: 'DES-1', to: 'ENG-10' }])
    expect(byTitle('New logo', r.issues).number).toBe(9)
    expect(byTitle('Design one', r.issues).number).toBe(10)
    expect(new Set(r.issues.map((i) => i.sortOrder)).size).toBe(r.issues.length)
  })

  test('sub-issues in another team keep their parent when both teams come over', () => {
    const cross = { ...data, issues: data.issues.map((i) => (i.id === 'i-9' ? { ...i, parent: { id: 'i-1' } } : i)) }
    const both = run(cross, { ...choices, teamKeys: { 't-eng': 'ENG', 't-des': 'DES' } })
    expect(byTitle('New logo', both.issues).parent).toBe(byTitle('Charts are slow', both.issues).id)
    const alone = run(cross, { ...choices, teamKeys: { 't-des': 'DES' } })
    expect(byTitle('New logo', alone.issues).parent).toBeNull()
  })

  test('importing only one team again keeps parents in a team that came over before', () => {
    const both = { ...choices, teamKeys: { 't-eng': 'ENG', 't-des': 'DES' } }
    const desOnly = { ...choices, teamKeys: { 't-des': 'DES' } }
    const rename = (d: typeof data) => ({ ...d, issues: d.issues.map((i) => (i.id === 'i-9' ? { ...i, title: 'New logo, again' } : i)) })
    const cross = { ...data, issues: data.issues.map((i) => (i.id === 'i-9' ? { ...i, parent: { id: 'i-1' } } : i)) }
    const ws = apply(empty(), run(cross, both))
    const charts = Object.values(ws.issues).find((i) => i.linearId === 'i-1')!
    // nothing changed: the sub-issue isn't written again (so its parent isn't cleared)
    expect(run(cross, desOnly, ws, '2026-03-02T00:00:00.000Z').issues).toEqual([])
    expect(run(rename(cross), desOnly, ws, '2026-03-02T00:00:00.000Z').issues).toMatchObject([{ title: 'New logo, again', parent: charts.id }])
    // a parent in the archive counts too
    const open = { name: 'Todo', type: 'unstarted' }
    const underAxis = { ...data, issues: data.issues.map((i) => (i.id === 'i-9' ? { ...i, parent: { id: 'i-2' }, state: open, canceledAt: null } : i)) }
    const archived = apply(empty(), run(underAxis, both, empty(), '2026-10-07T00:00:00.000Z'))
    expect(archived.archivedByLinear['i-2']).toBeDefined()
    const again = run(rename(underAxis), desOnly, archived, '2026-10-08T00:00:00.000Z')
    expect(again.issues).toMatchObject([{ title: 'New logo, again', parent: archived.archivedByLinear['i-2'].id }])
  })
})

describe('what Linear sends', () => {
  test('the same thing sent twice comes over once', () => {
    const twice = {
      ...data,
      issues: [...data.issues, data.issues[0]],
      comments: [...data.comments, data.comments[0]],
      labels: [...data.labels, ...data.labels],
      projects: [...data.projects, ...data.projects],
      views: [...data.views!, ...data.views!],
    }
    const r = run(twice)
    expect(r.issues.filter((i) => i.linearId === 'i-1')).toHaveLength(1)
    expect(r.labels).toHaveLength(3)
    expect(r.projects).toHaveLength(1)
    expect(r.views).toHaveLength(9)
    expect(r.counts).toEqual({ teams: 1, labels: 3, projects: 1, issues: 3, comments: 2, archived: 0, views: 9 })
  })

  test('a label made here with the same name is used, and remembers the Linear label', () => {
    const bug = { id: 'bug-here', name: 'Bug', color: '#ff0000' }
    const r = run(data, choices, { ...empty(), labels: { [bug.id]: bug } })
    expect(r.labels.filter((l) => l.name.toLowerCase() === 'bug')).toEqual([{ ...bug, linearId: 'l-bug' }])
    expect(r.counts.labels).toBe(2)
    expect(byTitle('Fix the axis', r.issues).labels).toEqual([bug.id])
    expect(byTitle('Charts are slow', r.issues).labels[0]).toBe(bug.id)
  })
})

describe('the workspace as the import sees it', () => {
  test('archived issues and their comments by Linear id, every number used, guests as they are now', () => {
    const ws = { ...EMPTY, people: { mikolaj: person('mikolaj', 'Mikołaj') }, teams: { ENG: { ...eng, lastNumber: 9 } }, issues: { mine1: native(1), back: native(4) }, comments: { mine1: [] } }
    const extras: ImportExtras = {
      // "back" was restored since it was read: it's an issue again, not an archived one
      archived: [
        { id: 'arch', linearId: 'i-2', team: 'ENG', number: 2 },
        { id: 'back', linearId: 'i-4', team: 'ENG', number: 4 },
      ],
      archivedComments: [
        { id: 'k', issue: 'arch', linearId: 'c-k' },
        { id: 'k2', issue: 'back', linearId: 'c-k2' },
      ],
      // 7 was deleted; 5, 6, 8 and 9 never used, whatever the team's last number says
      usedNumbers: { ENG: [1, 2, 4, 7] },
      guests: [{ login: '~cat-wong', githubId: 0, name: 'Cat W.', avatarUrl: '', linearId: 'u-cat' } as never],
      guestEmails: {},
    }
    const e = existingFrom(ws, extras, 'mikolaj')
    expect(e.me).toBe('mikolaj')
    expect(e.archivedByLinear).toEqual({ 'i-2': { id: 'arch', team: 'ENG', number: 2 } })
    expect(e.archivedComments).toEqual({ 'c-k': { id: 'k', issue: 'arch' } })
    expect([...e.usedNumbers.ENG].sort()).toEqual([1, 2, 4, 7])
    expect(Object.keys(e.people!).sort()).toEqual(['mikolaj', '~cat-wong'])
  })
})

describe('running it again after changes here or in Linear', () => {
  const both = { ...choices, teamKeys: { 't-eng': 'ENG', 't-des': 'DES' } }

  test('links follow numbers that moved and keys that changed', () => {
    const linking = {
      ...data,
      issues: data.issues.map((i) => (i.id === 'i-3' ? { ...i, description: 'After https://linear.app/acme/issue/ENG-2/x and https://linear.app/acme/issue/DES-9/y' } : i)),
    }
    const existing = { ...empty(), teams: { ENG: eng }, issues: { mine2: native(2) }, usedNumbers: { ENG: [2] } }
    const r = run(linking, { ...both, teamKeys: { 't-eng': 'ENG', 't-des': 'DSN' } }, existing)
    expect(r.renumbered).toEqual([{ from: 'ENG-2', to: 'ENG-4' }])
    expect(byTitle('Old idea', r.issues).description).toBe('After ENG-4 and DSN-9')
    // one archived here since keeps its number here
    const ws = apply(empty(), run(linking, both, empty(), '2026-10-07T00:00:00.000Z'))
    const axis = ws.archivedByLinear['i-2']
    const again = run({ ...linking, issues: linking.issues.map((i) => (i.id === 'i-3' ? { ...i, title: 'Old idea!' } : i)) }, both, ws, '2026-10-08T00:00:00.000Z')
    expect(byTitle('Old idea!', again.issues).description).toBe(`After ENG-${axis.number} and DES-9`)
  })

  test('a project keeps the teams that weren’t imported this time; a team taken off in Linear goes', () => {
    const shared = { ...data, projects: data.projects.map((p) => (p.id === 'p-launch' ? { ...p, teams: { nodes: [{ id: 't-eng' }, { id: 't-des' }] } } : p)) }
    const ws = apply(empty(), run(shared, both))
    const project = Object.values(ws.projects).find((p) => p.linearId === 'p-launch')!
    expect(project.teams).toEqual(['ENG', 'DES'])
    const desOnly = run(shared, { ...choices, teamKeys: { 't-des': 'DES' } }, ws, '2026-03-02T00:00:00.000Z')
    expect(desOnly.projects).toEqual([])
    expect(desOnly.removedProjectTeams).toEqual([])
    const offEng = { ...shared, projects: data.projects.map((p) => (p.id === 'p-launch' ? { ...p, teams: { nodes: [{ id: 't-des' }] } } : p)) }
    const r = run(offEng, both, ws, '2026-03-02T00:00:00.000Z')
    expect(r.projects).toMatchObject([{ id: project.id, teams: ['DES'] }])
    expect(r.removedProjectTeams).toEqual([{ project: project.id, team: 'ENG' }])
  })

  test('someone who hasn’t joined and was renamed in Linear gets their new name', () => {
    const ws = apply(empty(), run(data, guests))
    const renamed = { ...data, users: data.users.map((u) => (u.id === 'u-old' ? { ...u, name: 'Old Timer Jr', avatarUrl: 'https://example.com/old.png' } : u)) }
    const r = run(renamed, guests, ws, '2026-03-02T00:00:00.000Z')
    expect(r.guests).toEqual([{ login: '~old-timer', githubId: 0, name: 'Old Timer Jr', avatarUrl: 'https://example.com/old.png', linearId: 'u-old' }])
    expect(r.guestEmails).toEqual([])
    expect(run(renamed, guests, apply(ws, r), '2026-03-03T00:00:00.000Z').guests).toEqual([])
  })

  test('a label taken off in Linear goes; labels in another order change nothing', () => {
    const ws = apply(empty(), run())
    const charts = Object.values(ws.issues).find((i) => i.linearId === 'i-1')!
    const reordered = run({ ...data, issues: data.issues.map((i) => (i.id === 'i-1' ? { ...i, labels: { nodes: [{ id: 'l-charts' }, { id: 'l-bug' }] } } : i)) }, choices, ws, '2026-03-02T00:00:00.000Z')
    expect(written(reordered)).toEqual(nothing)
    const off = run({ ...data, issues: data.issues.map((i) => (i.id === 'i-1' ? { ...i, labels: { nodes: [{ id: 'l-charts' }] } } : i)) }, choices, ws, '2026-03-02T00:00:00.000Z')
    expect(off.removedLabels).toEqual([{ issue: charts.id, label: charts.labels[0] }])
    expect(off.issues).toMatchObject([{ id: charts.id, labels: [charts.labels[1]] }])
  })

  test('someone who follows an issue anyway now isn’t listed as following it', () => {
    const withCat = { ...choices, people: { ...choices.people, 'u-cat': 'cwong' } }
    const ws = apply(empty(), run(data, withCat))
    const charts = Object.values(ws.issues).find((i) => i.linearId === 'i-1')!
    expect(charts.subscribers).toEqual(['cwong'])
    const assigned = run({ ...data, issues: data.issues.map((i) => (i.id === 'i-1' ? { ...i, assignee: { id: 'u-cat' } } : i)) }, withCat, ws, '2026-03-02T00:00:00.000Z')
    expect(assigned.removedFollowers).toEqual([{ issue: charts.id, login: 'cwong' }])
  })

  test('who wrote a comment, made an issue or owns a view stays as the first import had it', () => {
    // no comment from Old Timer, so matching him only changes who made "Old idea"
    const quiet = { ...data, comments: data.comments.filter((c) => c.id !== 'c-2') }
    const ws = apply(empty(), run(quiet))
    expect(byTitle('Old idea', Object.values(ws.issues) as IssueRow[]).createdBy).toBe('mikolaj')
    const later = run(quiet, { ...choices, people: { ...choices.people, 'u-old': '~old-timer' } }, ws, '2026-03-02T00:00:00.000Z')
    expect(later.issues).toEqual([])
    // a view whose owner was no one here stays yours
    expect(later.views).toEqual([])

    // a comment that came in as "No one" keeps its author and the line saying who wrote it
    const first = apply(empty(), run())
    const c2 = Object.values(first.comments).flat().find((c) => c.linearId === 'c-2')!
    expect(c2).toMatchObject({ author: 'mikolaj', body: '*From Linear: Old Timer*\n\nBack in my day' })
    expect(run(data, guests, first, '2026-03-02T00:00:00.000Z').comments).toEqual([])
  })

  test('an import that stopped partway: its team gets members, guests get their emails, when it runs again', () => {
    const withEmail = { ...guests, people: { ...guests.people, 'u-bob': '~bob-stone' } }
    const ws = apply(empty(), run(data, withEmail))
    expect(run(data, withEmail, ws, '2026-03-02T00:00:00.000Z').guestEmails).toEqual([])
    // it stopped right after making ENG and Bob, before ENG's members and Bob's email were saved
    const stopped = { ...ws, teams: { ENG: { ...ws.teams.ENG, members: [] } }, guestEmails: {} }
    const again = run(data, withEmail, stopped, '2026-03-02T00:00:00.000Z')
    expect(again.teamMembers).toEqual([{ key: 'ENG', members: ['mikolaj', 'ana-n'] }])
    expect(again.guestEmails).toEqual([{ login: '~bob-stone', email: 'bstone@acme.dev' }])
    expect(again.guests).toEqual([])
    // an email that changed in Linear comes again; a team here with nobody in it that takes in a Linear team gets members too
    const moved = { ...data, users: data.users.map((u) => (u.id === 'u-bob' ? { ...u, email: 'bob@acme.dev' } : u)) }
    expect(run(moved, withEmail, ws, '2026-03-02T00:00:00.000Z').guestEmails).toEqual([{ login: '~bob-stone', email: 'bob@acme.dev' }])
    expect(run(data, withEmail, { ...stopped, teams: { ENG: { ...eng, members: [] } } }, '2026-03-02T00:00:00.000Z').teamMembers).toEqual([{ key: 'ENG', members: ['mikolaj', 'ana-n'] }])
  })

  test('a view keeps its team here, so a later import after the teams swap settles', () => {
    const first = apply(empty(), run(data, both))
    const swapped = { ...choices, teamKeys: { 't-eng': 'DES', 't-des': 'ENG' } }
    const second = run(data, swapped, first, '2026-03-02T00:00:00.000Z')
    expect(second.views.map((v) => v.name)).not.toContain('Open bugs')
    expect(Object.values(first.views!).find((v) => v.name === 'Open bugs')?.team).toBe('ENG')
    const settled = run(data, swapped, apply(first, second), '2026-03-03T00:00:00.000Z')
    expect(written(settled)).toEqual(nothing)
  })

  test('comments on issues archived here count as covered', () => {
    const ws = apply(empty(), run({ ...data, comments: [...data.comments, { id: 'c-a', body: 'Old talk', createdAt: '2026-01-05T00:00:00.000Z', user: { id: 'u-bob', name: 'Bob Stone' }, issue: { id: 'i-2' } }] }, choices, empty(), '2026-10-07T00:00:00.000Z'))
    const again = run({ ...data, comments: [...data.comments, { id: 'c-a', body: 'Old talk', createdAt: '2026-01-05T00:00:00.000Z', user: { id: 'u-bob', name: 'Bob Stone' }, issue: { id: 'i-2' } }] }, choices, ws, '2026-10-08T00:00:00.000Z')
    expect(again.comments).toEqual([])
    expect(again.counts.comments).toBe(3)
  })

  test('the "From Linear" line follows the author here', () => {
    const ws = apply(empty(), run())
    const bobs = (r: ImportResult | Existing) => ('counts' in r ? r.comments : Object.values(r.comments).flat()).find((c) => c.linearId === 'c-1')
    expect(bobs(ws)).toMatchObject({ author: 'bstone', body: 'On it' })
    // Bob is matched to no one now: he stays the author, so no line saying someone else wrote it
    expect(bobs(run(data, { ...choices, people: { ...choices.people, 'u-bob': null } }, ws, '2026-03-02T00:00:00.000Z'))).toBeUndefined()
    // came in as "No one", then matched to you: you are its author, and it says so plainly
    const mine = apply(empty(), run(data, { ...choices, people: { ...choices.people, 'u-old': null } }))
    const now = run(data, { ...choices, people: { ...choices.people, 'u-old': 'mikolaj' } }, mine, '2026-03-02T00:00:00.000Z')
    expect(now.comments.find((c) => c.linearId === 'c-2')).toMatchObject({ author: 'mikolaj', body: 'Back in my day' })
  })

  test('a comment on an issue archived here that came over before stays as it is', () => {
    const ws = apply(empty(), run(data, choices, empty(), '2026-10-07T00:00:00.000Z'))
    const axis = ws.archivedByLinear['i-2']
    const late = { id: 'c-late', body: 'Still broken?', createdAt: '2026-10-01T00:00:00.000Z', user: { id: 'u-bob', name: 'Bob Stone' }, issue: { id: 'i-2' } }
    const known = { ...ws, archivedComments: { 'c-late': { id: 'k-late', issue: axis.id } } }
    expect(run({ ...data, comments: [...data.comments, late] }, choices, known, '2026-10-08T00:00:00.000Z').comments).toEqual([])
  })
})

describe('getting an import ready', () => {
  const extras: ImportExtras = { archived: [], archivedComments: [], usedNumbers: {}, guests: [], guestEmails: {} }
  const store = {
    ...EMPTY,
    me: person('mikolaj', 'Mikołaj'),
    people: { mikolaj: person('mikolaj', 'Mikołaj'), 'ana-n': person('ana-n', 'Ana Nowak'), bstone: person('bstone', 'Robert') },
    members: { mikolaj: { role: 'owner' as const, removedAt: null }, 'ana-n': { role: 'member' as const, removedAt: null }, bstone: { role: 'member' as const, removedAt: null } },
  }
  const o = { now: NOW, newId: ids(), newGuestId: uuids(), plan: () => ({ workspaceId: 'ws', steps: [], total: 0, newTeams: {}, archive: false }) }

  test('works out what comes over and the steps', () => {
    const p = prepareImport(store, extras, data, choices, o)
    expect(p.result.counts.issues).toBe(3)
    expect(p.existing.me).toBe('mikolaj')
    expect(p.plan.total).toBe(0)
  })

  test('someone picked who has left since: it says so in words, not with their login', () => {
    const left = { ...store, members: { ...store.members, bstone: { role: 'member' as const, removedAt: NOW } } }
    expect(() => prepareImport(left, extras, data, choices, o)).toThrow("Robert isn't in this workspace any more. Go back to Who's who and pick someone else.")
    expect(() => prepareImport({ ...store, me: null }, extras, data, choices, o)).toThrow(ImportProblem)
  })
})
