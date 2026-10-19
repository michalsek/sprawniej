import { describe, expect, test } from 'bun:test'
import { linearIdsOf } from '@/data/relink'
import { buildImport, guestLogins, emojiFor, freeKey, guessPerson, involvedUsers, mapStatus, rewriteLinks, type Existing, type ImportChoices, type ImportResult, type IssueRow } from '@/features/import/linearMap'
import type { Issue, Project, Team, View } from '@/model/schema'
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
  test('links to imported issues become references', () => {
    expect(rewriteLinks('a https://linear.app/acme/issue/ENG-2/fix and [x](https://linear.app/acme/issue/ENG-2/fix) and https://linear.app/acme/issue/OPS-1/y', new Set(['ENG-2']))).toBe(
      'a ENG-2 and ENG-2 and https://linear.app/acme/issue/OPS-1/y',
    )
  })
})

const NOW = '2026-03-01T00:00:00.000Z'
const empty = (): Existing => ({ me: 'mikolaj', teams: {}, issues: {}, labels: {}, projects: {}, comments: {}, archivedByLinear: {}, usedNumbers: {} })
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
const run = (d = data, c = choices, ws = empty(), now = NOW) => buildImport(d, c, ws, ids(), now, uuids())
const byTitle = (t: string, rows: IssueRow[]) => rows.find((i) => i.title === t)!
const eng: Team = { key: 'ENG', name: 'Eng', emoji: '🛠️', members: ['mikolaj'], createdAt: NOW }
const native = (n: number): Issue => ({ id: `mine${n}`, team: 'ENG', number: n, title: `Made here ${n}`, description: '', status: 'todo', priority: 0, assignee: null, labels: [], project: null, parent: null, sortOrder: `a${n}`, createdBy: 'mikolaj', createdAt: NOW, updatedAt: NOW })
/** every row the import would write */
const written = (r: ImportResult) => ({ guests: r.guests, teams: r.teams, labels: r.labels, projects: r.projects, issues: r.issues, comments: r.comments, views: r.views, links: r.links, removedViews: r.removedViews })
const nothing = { guests: [], teams: [], labels: [], projects: [], issues: [], comments: [], views: [], links: [], removedViews: [] }

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
    usedNumbers: { ...ws.usedNumbers },
  }
  const people = next.people!
  const views = next.views!
  for (const g of r.guests) {
    const { id: _id, email: _email, ...person } = g
    people[g.login] = person
  }
  for (const t of r.teams) {
    const { isNew: _isNew, ...team } = t
    next.teams[t.key] = team
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
  for (const c of r.comments) next.comments[c.issue] = [...(next.comments[c.issue] ?? []).filter((x) => x.id !== c.id), c]
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
  const ws = apply(empty(), r)
  const charts = byTitle('Charts are slow', r.issues)

  test('only the chosen team, with numbers, statuses and people', () => {
    expect(r.counts).toEqual({ teams: 1, labels: 3, projects: 1, issues: 3, comments: 2, archived: 0, views: 9 })
    expect(r.teams).toMatchObject([{ key: 'ENG', isNew: true, linearId: 't-eng', name: 'Engineering', emoji: '🚀' }])
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

  test('running it again brings only what changed', () => {
    const again = run({ ...data, issues: data.issues.map((i) => (i.id === 'i-3' ? { ...i, title: 'Old idea, renamed' } : i)) }, choices, ws, '2026-03-02T00:00:00.000Z')
    expect(again.issues).toHaveLength(1)
    expect(again.issues[0]).toMatchObject({ id: byTitle('Old idea', r.issues).id, number: 3, title: 'Old idea, renamed' })
    expect({ ...written(again), issues: [] }).toEqual(nothing)
    // the counts still say what the import covers
    expect(again.counts).toEqual({ teams: 0, labels: 0, projects: 1, issues: 3, comments: 2, archived: 0, views: 9 })
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

  test('people who aren’t here come as someone who hasn’t joined, and keep their work', () => {
    const g = run(data, guests)
    expect(g.guests.map((p) => p.login)).toEqual(['~old-timer', '~cat-wong'])
    expect(g.guests[0]).toEqual({ id: '00000000-0000-4000-8000-000000000001', login: '~old-timer', githubId: 0, name: 'Old Timer', avatarUrl: '', linearId: 'u-old' })
    expect(g.guests[1]).toMatchObject({ id: '00000000-0000-4000-8000-000000000002', name: 'Cat Wong', avatarUrl: 'https://example.com/cat.png', linearId: 'u-cat' })
    expect('email' in g.guests[1]).toBe(false)
    expect(byTitle('Old idea', g.issues).createdBy).toBe('~old-timer')
    expect(byTitle('Charts are slow', g.issues).subscribers).toEqual(['~cat-wong'])
    // their comment is theirs, with no "From Linear" line
    expect(g.comments.find((c) => c.author === '~old-timer')?.body).toBe('Back in my day')
    // their view works, and they're never made a team member
    expect(g.views.find((v) => v.name === 'Cat')?.filters).toEqual({ subscribers: ['~cat-wong'] })
    expect(g.skippedViews).toEqual([])
    expect(g.teams[0].members).not.toContain('~old-timer')
    // their e-mail address comes along when Linear knows it
    const ana = run(data, { ...guests, people: { ...guests.people, 'u-ana': '~ana-nowak' } })
    expect(ana.guests.find((p) => p.login === '~ana-nowak')?.email).toBe('ana@acme.dev')
    // made once: a later import leaves them
    expect(run(data, guests, apply(empty(), g)).guests).toEqual([])
  })

  test('once someone has joined and is matched, a later import links them to their account', () => {
    const first = run(data, guests)
    const w = apply(empty(), first)
    // an issue, a view and a project made here, about Cat: the link moves them, not the import
    const mine = { ...native(50), assignee: '~cat-wong' }
    const view = { id: 'vh', name: 'Cat’s', emoji: '🐱', description: '', owner: '~cat-wong', team: null, filters: { assignees: ['~cat-wong'] }, display: Object.values(w.views!)[0].display, createdAt: NOW } as View
    const lead = { id: 'pl', name: 'Made here', emoji: '📦', description: '', status: 'planned', lead: '~cat-wong', teams: [], targetDate: null, createdAt: NOW } as Project
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

  test('a person matched to no one: their view is left out', () => {
    const noAna = run(data, { ...choices, people: { ...choices.people, 'u-ana': null } })
    expect(noAna.skippedViews).toContain('Ana')
  })

  test('a view made by an earlier import that can’t come over now goes away', () => {
    const v = Object.values(ws.views!).find((x) => x.name === 'Ana')!
    const again = run(data, { ...choices, people: { ...choices.people, 'u-ana': null } }, ws, '2026-03-02T00:00:00.000Z')
    expect(again.removedViews).toEqual([v.id])
    expect(again.views.map((x) => x.id)).not.toContain(v.id)
  })

  test('a second import updates views and keeps how they look', () => {
    const v = Object.values(ws.views!).find((x) => x.name === 'Open bugs')!
    const mine = { ...ws, views: { ...ws.views, [v.id]: { ...v, display: { ...v.display, layout: 'board' as const } } } }
    const again = run({ ...data, views: data.views!.map((x) => (x.id === 'v-bugs' ? { ...x, name: 'Open bugs!' } : x)) }, choices, mine, '2026-03-02T00:00:00.000Z')
    expect(again.views).toHaveLength(1)
    expect(again.views[0]).toMatchObject({ id: v.id, name: 'Open bugs!', display: { layout: 'board' } })
  })

  test('issues finished long ago go straight into the archive; a second import leaves them there', () => {
    const later = run(data, choices, empty(), '2026-10-07T00:00:00.000Z')
    expect(later.counts).toMatchObject({ issues: 3, archived: 1 })
    const axis = byTitle('Fix the axis', later.issues)
    expect(axis).toMatchObject({ archivedAt: '2026-10-07T00:00:00.000Z', archivedBy: 'mikolaj', number: 2, parent: byTitle('Charts are slow', later.issues).id })
    expect(later.issues.filter((i) => i.archivedAt).map((i) => i.title)).toEqual(['Fix the axis'])
    const ws3 = apply(empty(), later)
    const again = run(data, choices, ws3, '2026-10-08T00:00:00.000Z')
    expect(again.issues).toEqual([])
    expect(again.counts).toMatchObject({ issues: 3, archived: 1 })

    // a comment written in Linear later joins the archived issue, once
    const late = { id: 'c-late', body: 'Still broken?', createdAt: '2026-10-01T00:00:00.000Z', user: { id: 'u-bob', name: 'Bob Stone' }, issue: { id: 'i-2' } }
    const withComment = { ...data, comments: [...data.comments, late] }
    const third = run(withComment, choices, ws3, '2026-10-09T00:00:00.000Z')
    expect(third.comments).toMatchObject([{ issue: axis.id, author: 'bstone', body: 'Still broken?', linearId: 'c-late' }])
    expect(third.counts.comments).toBe(3)
    const fourth = run(withComment, choices, apply(ws3, third), '2026-10-10T00:00:00.000Z')
    expect(fourth.comments).toEqual([])
    // a comment it already had in Linear comes with it, pointing at the archived issue
    const early = run(withComment, choices, empty(), '2026-10-07T00:00:00.000Z')
    expect(early.comments.find((c) => c.linearId === 'c-late')?.issue).toBe(byTitle('Fix the axis', early.issues).id)
  })

  test('into a team that already has issues: clashing numbers move up', () => {
    const existing = { ...empty(), teams: { ENG: eng }, issues: { mine2: native(2) }, usedNumbers: { ENG: [2] } }
    const r2 = run(data, choices, existing)
    expect(r2.counts.teams).toBe(0)
    expect(r2.renumbered).toEqual([{ from: 'ENG-2', to: 'ENG-4' }])
    expect(r2.issues.map((i) => i.number).sort()).toEqual([1, 3, 4])
  })
})

describe('numbers', () => {
  test('a second import never gives a new issue a number an earlier import already used', () => {
    const existing = { ...empty(), teams: { ENG: eng }, issues: { mine1: native(1), mine2: native(2), mine3: native(3) }, usedNumbers: { ENG: [1, 2, 3] } }
    const ws2 = apply(existing, run(data, choices, existing))
    const more = { ...data, issues: [...data.issues, { ...data.issues[2], id: 'i-4', number: 4, title: 'Brand new' }, { ...data.issues[2], id: 'i-5', number: 5, title: 'Newer still' }] }
    const final = apply(ws2, run(more, choices, ws2, '2026-03-02T00:00:00.000Z'))
    const numbers = Object.values(final.issues).filter((i) => i.team === 'ENG').map((i) => i.number)
    expect(numbers).toHaveLength(8)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  test('an import never hands out the number of an issue deleted here', () => {
    const existing = { ...empty(), teams: { ENG: { ...eng, lastNumber: 2 } }, usedNumbers: { ENG: [1, 2] } }
    const numbers = run(data, choices, existing).issues.map((i) => i.number)
    expect(numbers.some((n) => n <= 2)).toBe(false)
  })

  test('a number used here once moves an issue past the highest one', () => {
    const r = run(data, choices, { ...empty(), teams: { ENG: eng }, usedNumbers: { ENG: [1, 7] } })
    expect(r.renumbered).toEqual([{ from: 'ENG-1', to: 'ENG-8' }])
    expect(r.issues.map((i) => i.number).sort()).toEqual([2, 3, 8])
  })

  test('numbers never used here stay free, even below the highest one', () => {
    const r = run(data, choices, { ...empty(), teams: { ENG: { ...eng, lastNumber: 5 } }, usedNumbers: { ENG: [4, 5] } })
    expect(r.renumbered).toEqual([])
    expect(r.issues.map((i) => i.number).sort()).toEqual([1, 2, 3])
  })

  test('two Linear teams joining one team here: one team, and numbers that don’t clash', () => {
    const more = { ...data, issues: [...data.issues, { ...data.issues[3], id: 'i-d1', number: 1, title: 'Design one' }] }
    const r = run(more, { ...choices, teamKeys: { 't-eng': 'ENG', 't-des': 'ENG' } })
    expect(r.teams).toMatchObject([{ key: 'ENG', linearId: 't-eng', isNew: true }])
    expect(r.renumbered).toEqual([{ from: 'ENG-1', to: 'ENG-10' }])
    expect(byTitle('New logo', r.issues).number).toBe(9)
    expect(byTitle('Design one', r.issues).number).toBe(10)
  })
})

describe('running it again', () => {
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

  test('a Linear team that joins a team here is remembered', () => {
    const existing = { ...empty(), teams: { ENG: eng } }
    const r = run(data, choices, existing)
    expect(r.teams).toEqual([{ ...eng, linearId: 't-eng', isNew: false }])
    expect(r.counts.teams).toBe(0)
    expect(run(data, choices, apply(existing, r)).teams).toEqual([])
  })

  test('sub-issues in another team keep their parent when both teams come over', () => {
    const cross = { ...data, issues: data.issues.map((i) => (i.id === 'i-9' ? { ...i, parent: { id: 'i-1' } } : i)) }
    const both = run(cross, { ...choices, teamKeys: { 't-eng': 'ENG', 't-des': 'DES' } })
    expect(byTitle('New logo', both.issues).parent).toBe(byTitle('Charts are slow', both.issues).id)
    const alone = run(cross, { ...choices, teamKeys: { 't-des': 'DES' } })
    expect(byTitle('New logo', alone.issues).parent).toBeNull()
  })

  test('the same thing sent twice by Linear comes over once', () => {
    const twice = { ...data, issues: [...data.issues, data.issues[0]], comments: [...data.comments, data.comments[0]] }
    const r = run(twice)
    expect(r.issues.filter((i) => i.linearId === 'i-1')).toHaveLength(1)
    expect(r.counts).toMatchObject({ issues: 3, comments: 2 })
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
