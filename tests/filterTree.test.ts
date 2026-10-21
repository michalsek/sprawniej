import { describe, expect, test } from 'bun:test'
import { projectStatusIdOf, sampleData, statusIdOf } from './fixtures/sample'
import {
  FLAT_FIELDS,
  alignDraft,
  andStatuses,
  countConditions,
  describeTree,
  fromFlat,
  isGroup,
  matcher,
  movesWithClock,
  mirrorOf,
  normalise,
  presetFrom,
  storedFilters,
  toFlat,
  treeOf,
  treeWithout,
  viewFilters,
  withField,
  type MatchContext,
} from '@/data/filterTree'
import { followers } from '@/data/notify'
import { dateParts, dateReady, isDateCondition, sayDate, withDateField, withDateOp } from '@/data/dateFilters'
import { matchesStatus } from '@/data/statuses'
import { DATE_FIELDS, ME, isFilterField, type DateCondition, type FilterCondition, type FilterGroup, type FilterNode, type Filters, type Issue, type Status } from '@/model/schema'
import { ISSUE_CATEGORIES } from '@/model/status'

const data = sampleData()
const issues = Object.values(data.issues)
const ctx: MatchContext = { comments: data.comments, people: data.people, projects: data.projects, statuses: data.statuses, me: 'ania-k' }

const is = (field: string, ...values: FilterCondition['values']): FilterCondition => ({ field, op: 'is', values })
const not = (field: string, ...values: FilterCondition['values']): FilterCondition => ({ field, op: 'not', values })
const and = (...items: FilterNode[]): FilterGroup => ({ join: 'and', items })
const or = (...items: FilterNode[]): FilterGroup => ({ join: 'or', items })
/** the issues a tree lets through; null: with no context */
const ids = (tree: FilterGroup, c: MatchContext | null = ctx) => issues.filter(matcher(tree, c ?? undefined)).map((i) => i.id)
const where = (fits: (i: Issue) => boolean) => issues.filter(fits).map((i) => i.id)
/** from a newer version: a field this one doesn't know */
const cycle = { field: 'cycle', op: 'is', values: ['c1'] } as FilterCondition

/** matching as it was before trees (2.13.0), to check the flat filters still mean the same */
function oldMatches(issue: Issue, f: Filters, c?: MatchContext): boolean {
  if (f.teams?.length && !f.teams.includes(issue.team)) return false
  if (!matchesStatus(issue, f, c?.statuses ?? {})) return false
  if (f.assignees?.length && !f.assignees.includes(issue.assignee)) return false
  if (f.subscribers?.length && c) {
    const following = followers(issue, c.comments[issue.id] ?? [], c.people)
    if (!f.subscribers.some((l) => following.includes(l))) return false
  }
  if (f.priorities?.length && !f.priorities.includes(issue.priority)) return false
  if (f.labels?.length && !issue.labels.some((l) => f.labels!.includes(l))) return false
  if (f.projects?.length && !f.projects.includes(issue.project)) return false
  return true
}

describe('flat filters', () => {
  const flat: Filters = {
    statuses: ['todo', 'in_progress'],
    assignees: ['ania-k', null],
    subscribers: ['zosia'],
    priorities: [1, 2],
    labels: ['bug'],
    projects: ['p-speed', null],
    teams: ['ENG'],
  }

  test('every old key goes into a tree and back unchanged', () => {
    expect(toFlat(fromFlat(flat))).toEqual(flat)
    expect(toFlat(fromFlat({}))).toEqual({})
  })

  test('a tree the flat keys can’t say exactly has no flat form', () => {
    const plain = is('statuses', 'todo')
    for (const tree of [
      or(plain, is('labels', 'bug')),
      and(not('statuses', 'todo')),
      and(is('assignees', ME)),
      and(is('projectStatuses', 'planned')),
      and(plain, or(is('labels', 'bug'), is('teams', 'ENG'))),
      and(plain, is('statuses', 'done')),
      and({ ...plain, since: 'yesterday' }),
      and(cycle),
    ])
      expect(toFlat(tree)).toBeUndefined()
  })

  test('match the same issues as before trees, for many flat filters', () => {
    // a second In Progress status, which one issue has, so picking some statuses of a category means something
    const testing: Status = { id: 'testing', kind: 'issue', category: 'in_progress', name: 'Testing', color: '#fff', position: 'b0', hidden: false }
    const statuses = { ...data.statuses, testing }
    const one = issues.find((i) => i.status === 'in_progress')!
    const all = issues.map((i) => (i === one ? { ...i, statusId: 'testing' } : i))
    const statusIds = Object.values(statuses).filter((st) => st.kind === 'issue').map((st) => st.id)
    // a small fixed-seed random, so a failure can be replayed
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const some = <T,>(xs: readonly T[]) => xs.filter(() => rand() < 0.35)
    const choices = {
      statuses: ISSUE_CATEGORIES,
      assignees: [...Object.keys(data.people), null],
      subscribers: Object.keys(data.people),
      priorities: [0, 1, 2, 3, 4],
      labels: Object.keys(data.labels),
      projects: [...Object.keys(data.projects), null],
      teams: Object.keys(data.teams),
    }
    for (let n = 0; n < 300; n++) {
      const f = Object.fromEntries(FLAT_FIELDS.filter(() => rand() < 0.4).map((k) => [k, some(choices[k] as readonly unknown[])])) as Filters
      if (f.statuses?.length && rand() < 0.5) f.statusIds = some(statusIds)
      for (const c of [{ ...ctx, statuses }, null]) {
        const test = matcher(treeOf(f), c ?? undefined)
        expect(all.filter(test).map((i) => i.id)).toEqual(all.filter((i) => oldMatches(i, f, c ?? undefined)).map((i) => i.id))
      }
    }
  })
})

describe('matcher', () => {
  test('(Status is In Progress or In Review) and (Assignee is Me or Labels include Bug)', () => {
    const tree = and(is('statuses', 'in_progress', 'in_review'), or(is('assignees', ME), is('labels', 'bug')))
    const expected = where((i) => ['in_progress', 'in_review'].includes(i.status) && (i.assignee === 'ania-k' || i.labels.includes('bug')))
    expect(expected.length).toBeGreaterThan(2)
    expect(ids(tree)).toEqual(expected)
  })

  test('"is not" lets through issues with no value: no one assigned, no labels', () => {
    expect(ids(and(not('assignees', 'ania-k')))).toEqual(where((i) => i.assignee !== 'ania-k'))
    expect(ids(and(not('assignees', 'ania-k'))).some((id) => data.issues[id].assignee === null)).toBe(true)
    expect(ids(and(not('labels', 'insights', 'bug')))).toEqual(where((i) => !i.labels.some((l) => l === 'insights' || l === 'bug')))
    expect(ids(and(not('assignees', null)))).toEqual(where((i) => i.assignee !== null))
  })

  test('Me is whoever is looking; without knowing who, it is left out', () => {
    expect(ids(and(is('assignees', ME)))).toEqual(where((i) => i.assignee === 'ania-k'))
    expect(ids(and(is('assignees', ME)), { ...ctx, me: 'zosia' })).toEqual(where((i) => i.assignee === 'zosia'))
    expect(ids(and(is('assignees', ME, null)), { ...ctx, me: undefined })).toEqual(where((i) => i.assignee === null))
    expect(ids(and(is('assignees', ME)), { ...ctx, me: undefined })).toEqual(where(() => true))
  })

  test('Subscribers needs the comments and people; without them it is left out', () => {
    const first = issues[0]
    expect(ids(and(is('subscribers', 'zosia')))).toContain(first.id) // she commented
    expect(ids(and(is('subscribers', 'zosia')))).not.toContain(issues[5].id)
    expect(ids(and(is('subscribers', 'zosia')), null)).toEqual(where(() => true))
  })

  test('Project status: an issue with no project never "is" one, and always "is not"', () => {
    const inProgress = projectStatusIdOf('in_progress')
    expect(ids(and(is('projectStatuses', inProgress)))).toEqual(where((i) => i.project === 'p-insights'))
    expect(ids(and(not('projectStatuses', inProgress)))).toEqual(where((i) => i.project !== 'p-insights'))
    expect(ids(and(not('projectStatuses', inProgress))).some((id) => data.issues[id].project === null)).toBe(true)
    expect(ids(and(is('projectStatuses', inProgress)), { ...ctx, projects: undefined })).toEqual(where(() => true))
  })

  test('empty conditions and groups, and ones from a newer version, say nothing: an "and" leaves them out, an "or" lets everything through', () => {
    const bugs = where((i) => i.labels.includes('bug'))
    const all = where(() => true)
    expect(ids(and(is('labels', 'bug'), is('statuses'), or()))).toEqual(bugs)
    expect(ids(and(is('labels', 'bug'), cycle))).toEqual(bugs)
    // in an "or", one choice that says nothing lets every issue through, so a newer line never shows fewer issues
    expect(ids(or(is('labels', 'bug'), cycle))).toEqual(all)
    expect(ids(or(cycle, { join: 'xor', items: [] } as unknown as FilterGroup))).toEqual(all)
    // such an "or" inside an "and" is left out of it
    expect(ids(and(is('labels', 'bug'), or(is('priorities', 1), cycle)))).toEqual(bugs)
    // the same for a choice that needs what wasn't given (who follows what), and a date from a newer version
    expect(ids(or(is('labels', 'bug'), is('subscribers', 'ania-k')), null)).toEqual(all)
    expect(ids(or(is('labels', 'bug'), { field: 'created', op: 'within', amount: 0, unit: 'days' } as unknown as FilterNode))).toEqual(all)
    // an "or" of ones it can read still narrows
    expect(ids(or(is('labels', 'bug'), is('labels', 'bug')))).toEqual(bugs)
  })

  test('Status keeps categories, refined by the statuses it names, as the flat filters do', () => {
    const statuses = { ...data.statuses, testing: { id: 'testing', kind: 'issue' as const, category: 'in_progress', name: 'Testing', color: '#fff', position: 'b0', hidden: false } }
    const c = { ...ctx, statuses }
    const testing = { ...issues.find((i) => i.status === 'in_progress')!, statusId: 'testing' }
    const only = and({ ...is('statuses', 'in_progress'), statusIds: [statusIdOf('in_progress')] })
    expect(matcher(only, c)(testing)).toBe(false)
    expect(matcher(and(is('statuses', 'in_progress')), c)(testing)).toBe(true)
    expect(matcher({ ...only, items: [{ ...(only.items[0] as FilterCondition), op: 'not' }] }, c)(testing)).toBe(true)
    // stored flat, the refinement goes with it, and comes back
    const flat = storedFilters({}, only)
    expect(flat).toEqual({ statuses: ['in_progress'], statusIds: [statusIdOf('in_progress')] })
    expect(treeOf(flat)).toEqual(only)
  })

  test('a Status line this version can’t fully read fails safely', () => {
    // only categories it doesn't know: nothing matches, as in the flat filters
    expect(ids(and(is('statuses', 'blocked')))).toEqual([])
    // a refinement that isn't a list of ids: from a newer version, left out of matching
    const odd = { ...is('statuses', 'todo'), statusIds: { only: 'x' } } as unknown as FilterCondition
    expect(ids(and(odd, is('labels', 'bug')))).toEqual(where((i) => i.labels.includes('bug')))
  })

  test('three levels: Team is ENG and (Priority is Urgent or (Status is Todo and Labels include Bug))', () => {
    const tree = and(is('teams', 'ENG'), or(is('priorities', 1), and(is('statuses', 'todo'), is('labels', 'bug'))))
    expect(ids(tree)).toEqual(where((i) => i.team === 'ENG' && (i.priority === 1 || (i.status === 'todo' && i.labels.includes('bug')))))
  })
})

describe('storing', () => {
  const advanced = [
    and(is('statuses', 'in_progress', 'in_review'), or(is('assignees', ME), is('labels', 'bug'))),
    and(is('assignees', ME, 'bartek'), is('teams', 'ENG')),
    and(is('statuses', 'todo', 'in_progress'), is('statuses', 'in_progress', 'done'), not('priorities', 1)),
    and(is('labels', 'insights', 'bug'), is('labels', 'feature', 'bug'), is('projectStatuses', 'planned')),
    and(is('statuses', 'todo'), is('statuses', 'done')),
    or(is('teams', 'DES'), is('priorities', 1)),
  ]

  test('the flat copy lets through every issue the tree does, and never says Me', () => {
    for (const tree of advanced) {
      const mirror = mirrorOf(tree)
      const shown = ids(tree)
      const old = new Set(where((i) => oldMatches(i, mirror, ctx)))
      expect(shown.every((id) => old.has(id))).toBe(true)
      expect(JSON.stringify(mirror)).not.toContain(ME)
    }
    expect(mirrorOf(advanced[0])).toEqual({ statuses: ['in_progress', 'in_review'] })
    expect(mirrorOf(advanced[2])).toEqual({ statuses: ['in_progress'] })
    expect(mirrorOf(advanced[3])).toEqual({ labels: ['insights', 'bug'] })
  })

  test('a simple filter is stored as the flat keys only; anything else as the tree and its flat copy', () => {
    expect(storedFilters({}, and(is('labels', 'bug'), is('statuses', 'todo')))).toEqual({ labels: ['bug'], statuses: ['todo'] })
    expect(storedFilters({}, advanced[0])).toEqual({ statuses: ['in_progress', 'in_review'], tree: advanced[0] })
    expect(storedFilters({}, and())).toEqual({})
  })

  test('storing replaces the old filter but keeps keys a newer version added', () => {
    const prev = { labels: ['bug'], tree: advanced[1], cycles: ['c1'] } as Filters
    expect(storedFilters(prev, and(is('statuses', 'todo')))).toEqual({ statuses: ['todo'], cycles: ['c1'] } as Filters)
    expect(storedFilters(prev, advanced[0])).toEqual({ statuses: ['in_progress', 'in_review'], tree: advanced[0], cycles: ['c1'] } as Filters)
  })

  test('the stored tree wins over the flat keys', () => {
    expect(treeOf({ labels: ['bug'], tree: advanced[1] })).toBe(advanced[1])
  })
})

describe('normalise', () => {
  test('repeated statuses in a Status line go too', () => {
    const line = { ...is('statuses', 'in_progress', 'in_progress'), statusIds: ['testing', 'testing'] }
    expect(normalise(and(line))).toEqual(and({ ...is('statuses', 'in_progress'), statusIds: ['testing'] }))
  })

  test('drops empty conditions and groups and repeated values, keeps what it can’t read', () => {
    const tree = and(is('statuses'), is('labels', 'bug', 'bug'), or(), or(and()), cycle)
    expect(normalise(tree)).toEqual(and(is('labels', 'bug'), cycle))
  })

  test('a group of one is that one; a group joined like its parent joins it', () => {
    expect(normalise(and(is('teams', 'ENG'), or(is('labels', 'bug'))))).toEqual(and(is('teams', 'ENG'), is('labels', 'bug')))
    expect(normalise(and(is('teams', 'ENG'), and(is('labels', 'bug'), is('priorities', 1))))).toEqual(and(is('teams', 'ENG'), is('labels', 'bug'), is('priorities', 1)))
    // a group of one around an "or" in an "or"
    expect(normalise(or(is('teams', 'ENG'), and(or(is('labels', 'bug'), is('priorities', 1)))))).toEqual(or(is('teams', 'ENG'), is('labels', 'bug'), is('priorities', 1)))
    // the whole filter around one group is that group
    expect(normalise(and(or(is('labels', 'bug'), is('priorities', 1))))).toEqual(or(is('labels', 'bug'), is('priorities', 1)))
  })

  test('a group with fields from a newer version stays as it is', () => {
    const odd = { join: 'or', items: [is('labels', 'bug')], note: 'x' } as FilterGroup
    expect(normalise(and(is('teams', 'ENG'), odd))).toEqual(and(is('teams', 'ENG'), odd))
  })

  test('normalising twice changes nothing more', () => {
    const tree = and(or(and(is('teams', 'ENG')), or(is('labels', 'bug'), and(is('priorities', 1), and(is('statuses', 'todo'))))), is('statuses'))
    const once = normalise(tree)
    expect(normalise(once)).toEqual(once)
  })
})

describe('edits', () => {
  test('a deleted label comes out of nested conditions where others are left; alone, it stays', () => {
    const tree = and(is('labels', 'bug'), or(is('labels', 'bug', 'feature'), not('labels', 'bug', 'insights')))
    expect(treeWithout(tree, 'labels', 'bug')).toEqual(and(is('labels', 'bug'), or(is('labels', 'feature'), not('labels', 'insights'))))
    expect(treeWithout(tree, 'labels', 'performance')).toBe(tree)
  })

  test('a Status line moved to another field leaves its statuses behind, so it can be stored simply again', () => {
    const moved = { ...withField({ ...is('statuses', 'in_progress'), statusIds: ['testing'] }, 'priorities'), values: [1] }
    expect(storedFilters({}, and(moved))).toEqual({ priorities: [1] })
  })

  test('Save as view from a tab: its statuses join the filter', () => {
    const active = ['todo', 'in_progress', 'in_review']
    expect(andStatuses(and(is('statuses', 'todo', 'done'), is('labels', 'bug')), active)).toEqual(and(is('statuses', 'todo'), is('labels', 'bug')))
    // they share none: both stay, so the view shows nothing, as the tab did
    expect(andStatuses(and(is('statuses', 'done')), active)).toEqual(and(is('statuses', 'done'), is('statuses', ...active)))
    expect(andStatuses(or(is('labels', 'bug'), is('teams', 'ENG')), active)).toEqual(and(is('statuses', ...active), or(is('labels', 'bug'), is('teams', 'ENG'))))
    expect(andStatuses(and(), active)).toEqual(and(is('statuses', ...active)))
  })

  test('a new issue starts with what every issue on the list has', () => {
    expect(presetFrom(and(is('assignees', ME), is('labels', 'bug'), not('teams', 'ENG'), or(is('priorities', 1))), 'ania-k')).toEqual({ assignees: ['ania-k'], labels: ['bug'] })
    expect(presetFrom(or(is('labels', 'bug'), is('teams', 'ENG')), 'ania-k')).toEqual({})
  })

  test('counting and saying the filter', () => {
    const tree = and(is('statuses', 'todo'), is('labels'), or(is('assignees', ME), cycle))
    expect(countConditions(tree)).toBe(3)
    expect(describeTree(tree, (c) => `${c.field} ${c.op} ${(c as FilterCondition).values.join('/')}`)).toBe('statuses is todo and labels is  and (assignees is @me or a filter from a newer version)')
  })
})

describe('Save as view', () => {
  const active = ['todo', 'in_progress', 'in_review']

  test('from the Active tab: your status filter keeps only the tab’s statuses, the team is left to the view', () => {
    const own = { statuses: ['in_progress', 'done'], labels: ['bug'] } as Filters
    expect(viewFilters({ teams: ['ENG'] }, own, 'active')).toEqual({ statuses: ['in_progress'], labels: ['bug'] })
  })

  test('your "or" stays a group next to the tab’s statuses', () => {
    const own = { tree: or(is('labels', 'bug'), is('assignees', ME)) }
    const tree = and(is('statuses', ...active), or(is('labels', 'bug'), is('assignees', ME)))
    expect(viewFilters({ teams: ['ENG'] }, own, 'active')).toEqual({ statuses: active, tree } as Filters)
  })

  test('from a project’s page: the project comes along', () => {
    const own = { tree: and(not('labels', 'bug')) }
    const tree = and(is('projects', 'p-speed'), not('labels', 'bug'))
    expect(viewFilters({ projects: ['p-speed'] }, own, 'all')).toEqual({ projects: ['p-speed'], tree })
  })
})

describe('a teammate’s change while the builder is open', () => {
  /** what the result means: the same as what's saved */
  const means = (tree: FilterGroup) => storedFilters({}, normalise(tree))
  const pending = is('priorities')
  const from = (pairs: [FilterNode, FilterNode][], d: FilterNode) => pairs.find(([x]) => x === d)?.[1]

  test('your unfinished condition stays, and your lines stay the same lines', () => {
    const status = is('statuses', 'todo')
    const draft = and(status, pending)
    const saved = and(is('statuses', 'todo', 'done'), is('teams', 'ENG'))
    const { tree, pairs } = alignDraft(draft, saved)
    expect(tree).toEqual(and(is('statuses', 'todo', 'done'), is('teams', 'ENG'), pending))
    expect(tree.items[2]).toBe(pending)
    expect(from(pairs, status)).toBe(saved.items[0])
    expect(from(pairs, draft)).toBe(tree)
  })

  test('a removed line is gone, and no other line on its field takes its place', () => {
    const removed = is('statuses', 'in_progress', 'in_review')
    const other = not('statuses', 'in_review')
    const draft = and(removed, is('priorities', 1), other)
    const saved = and(is('priorities', 1), not('statuses', 'in_review'))
    const { tree, pairs } = alignDraft(draft, saved)
    expect(tree).toEqual(saved)
    expect(from(pairs, removed)).toBeUndefined()
    expect(from(pairs, other)).toBe(saved.items[1])
  })

  test('a group the teammate left with one line keeps its shape and your unfinished line', () => {
    const me = is('assignees', ME)
    const group = or(me, is('labels', 'bug'), pending)
    const draft = and(is('statuses', 'in_progress'), group)
    // saved, the group of one is just its line
    const saved = and(is('statuses', 'in_progress'), is('assignees', ME))
    const { tree, pairs } = alignDraft(draft, saved)
    expect(tree).toEqual(and(is('statuses', 'in_progress'), or(is('assignees', ME), pending)))
    expect(from(pairs, me)).toBe(saved.items[1])
    expect(from(pairs, group)).toBe(tree.items[1])
    expect(means(tree)).toEqual(means(saved))
  })

  test('a group saved as part of its parent (same join) keeps its shape and your unfinished line', () => {
    const inner = and(is('labels', 'bug'), is('statuses', 'todo'))
    const draft = and(is('teams', 'ENG'), or(inner, pending))
    const saved = and(is('teams', 'ENG'), is('labels', 'bug'), is('statuses', 'todo', 'done'))
    const { tree, pairs } = alignDraft(draft, saved)
    expect(tree).toEqual(and(is('teams', 'ENG'), or(and(is('labels', 'bug'), is('statuses', 'todo', 'done')), pending)))
    expect(from(pairs, inner.items[1])).toBe(saved.items[2])
    expect(means(tree)).toEqual(means(saved))
  })

  test('your one group, saved as the whole filter, keeps its place and takes new lines', () => {
    const group = or(is('labels', 'bug'), is('teams', 'ENG'))
    const draft = and(group, pending)
    const saved = or(is('labels', 'bug', 'feature'), is('teams', 'ENG'), is('priorities', 1))
    const { tree, pairs } = alignDraft(draft, saved)
    expect(tree).toEqual(and(or(is('labels', 'bug', 'feature'), is('teams', 'ENG'), is('priorities', 1)), pending))
    expect(from(pairs, group)).toBe(tree.items[0])
  })

  test('a teammate who switches your group’s join keeps your group and your unfinished line in it', () => {
    const group = or(is('labels', 'bug'), is('teams', 'ENG'), pending)
    const draft = and(is('statuses', 'todo'), group)
    // switched to "and", the group is saved as part of the top
    const saved = and(is('statuses', 'todo'), is('labels', 'bug'), is('teams', 'ENG'))
    const { tree, pairs } = alignDraft(draft, saved)
    expect(tree).toEqual(and(is('statuses', 'todo'), and(is('labels', 'bug'), is('teams', 'ENG'), pending)))
    expect(from(pairs, group)).toBe(tree.items[1])
  })

  test('a teammate’s new line goes into your group that stands for theirs', () => {
    const group = or(is('labels', 'bug'), is('teams', 'ENG'))
    const draft = and(is('statuses', 'todo'), group, pending)
    const saved = and(is('statuses', 'todo'), or(is('labels', 'bug'), is('teams', 'ENG'), is('priorities', 1)))
    const { tree, pairs } = alignDraft(draft, saved)
    expect(tree).toEqual(and(is('statuses', 'todo'), or(is('labels', 'bug'), is('teams', 'ENG'), is('priorities', 1)), pending))
    expect(from(pairs, group)).toBe(tree.items[1])
  })

  test('saved in the simple flat shape, your lines keep their order, groups and unfinished line', () => {
    // flat filters come back in a fixed order (Status, …, Labels, …, Team): not yours
    const flat = (tree: FilterGroup) => treeOf(storedFilters({}, normalise(tree)))
    const draft = and(is('teams', 'ENG'), or(and(is('labels', 'bug'), is('statuses', 'todo')), pending))
    const saved = flat(and(is('teams', 'ENG'), is('labels', 'bug'), is('statuses', 'todo', 'done')))
    expect(alignDraft(draft, saved).tree).toEqual(and(is('teams', 'ENG'), or(and(is('labels', 'bug'), is('statuses', 'todo', 'done')), pending)))
    const mine = and(is('priorities', 1), is('statuses', 'todo'), pending)
    expect(alignDraft(mine, flat(and(is('priorities', 1), is('statuses', 'todo', 'done')))).tree).toEqual(and(is('priorities', 1), is('statuses', 'todo', 'done'), pending))
  })

  test('your group alone under a top or keeps its unfinished line', () => {
    // a top "or" of one line means the same as "and", which is how it comes back saved
    const draft = or(and(is('statuses', 'todo'), pending))
    const saved = treeOf(storedFilters({}, normalise(and(is('statuses', 'todo', 'done')))))
    expect(alignDraft(draft, saved).tree).toEqual(or(and(is('statuses', 'todo', 'done'), pending)))
  })

  test('when the draft’s shape can’t say it, the saved shape wins, with the same lines and your top unfinished line', () => {
    // the teammate moved Team into a group with Labels
    const team = is('teams', 'ENG')
    const draft = and(team, or(is('labels', 'bug'), is('priorities', 1)), pending)
    const saved = and(or(is('teams', 'ENG'), is('labels', 'bug')), is('priorities', 1))
    const { tree, pairs } = alignDraft(draft, saved)
    expect(tree).toEqual(and(or(is('teams', 'ENG'), is('labels', 'bug')), is('priorities', 1), pending))
    expect(from(pairs, team)).toBe((saved.items[0] as FilterGroup).items[0])
    expect(from(pairs, draft)).toBe(tree)
  })

  test('the whole filter and a group inside it never share a key', () => {
    const draft = and(is('statuses', 'todo'), is('teams', 'ENG'), pending)
    const saved = or(and(is('statuses', 'todo'), is('teams', 'ENG')), is('labels', 'bug'))
    const { tree, pairs } = alignDraft(draft, saved)
    expect(means(tree)).toEqual(means(saved))
    expect(pairs.filter(([d]) => d === draft).map(([, to]) => to)).toEqual([tree])
  })

  test('around a teammate’s three-level tree, yours doesn’t go to four', () => {
    const deep = or(is('labels', 'bug'), and(is('teams', 'ENG'), or(is('statuses', 'todo'), is('priorities', 1))))
    const { tree } = alignDraft(and(or(is('labels', 'bug'), is('teams', 'ENG')), pending), deep)
    expect(means(tree)).toEqual(means(deep))
    const depth = (n: FilterNode): number => (isGroup(n) ? 1 + Math.max(0, ...n.items.map(depth)) : 0)
    expect(depth(tree)).toBe(3)
  })
})

describe('dates', () => {
  // Wednesday Oct 21 2026, noon, in this computer's time zone
  const now = new Date(2026, 9, 21, 12)
  const at = (...a: [number, number, number, number?]) => new Date(...(a as [number, number, number, number])).toISOString()
  const base = issues[0]
  const issue = (o: Partial<Issue>): Issue => ({ ...base, completedAt: null, dueDate: null, ...o })
  const date = (field: DateCondition['field'], op: DateCondition['op'], more: Partial<DateCondition> = {}): DateCondition => ({ field, op, ...more })
  const fits = (c: FilterNode, i: Issue) => matcher(and(c), { ...ctx, now })(i)

  test('times: in the last, more than … ago, before and after a day', () => {
    const week = date('created', 'within', { amount: 7, unit: 'days' })
    expect(fits(week, issue({ createdAt: at(2026, 9, 18) }))).toBe(true)
    expect(fits(week, issue({ createdAt: at(2026, 9, 11) }))).toBe(false)
    const old = date('created', 'ago', { amount: 7, unit: 'days' })
    expect(fits(old, issue({ createdAt: at(2026, 9, 18) }))).toBe(false)
    expect(fits(old, issue({ createdAt: at(2026, 9, 11) }))).toBe(true)
    const hours = date('updated', 'within', { amount: 2, unit: 'hours' })
    expect(fits(hours, issue({ updatedAt: at(2026, 9, 21, 11) }))).toBe(true)
    expect(fits(hours, issue({ updatedAt: at(2026, 9, 21, 9) }))).toBe(false)
    // a month back is Sep 21, a week two Oct 7
    expect(fits(date('updated', 'within', { amount: 1, unit: 'months' }), issue({ updatedAt: at(2026, 8, 25) }))).toBe(true)
    expect(fits(date('updated', 'within', { amount: 1, unit: 'months' }), issue({ updatedAt: at(2026, 8, 20) }))).toBe(false)
    expect(fits(date('updated', 'within', { amount: 2, unit: 'weeks' }), issue({ updatedAt: at(2026, 9, 8) }))).toBe(true)
    // days here: before Oct 1 ends when Oct 1 starts; after Oct 1 starts on Oct 2
    expect(fits(date('updated', 'before', { date: '2026-10-01' }), issue({ updatedAt: at(2026, 8, 30, 23) }))).toBe(true)
    expect(fits(date('updated', 'before', { date: '2026-10-01' }), issue({ updatedAt: at(2026, 9, 1, 1) }))).toBe(false)
    expect(fits(date('updated', 'after', { date: '2026-10-01' }), issue({ updatedAt: at(2026, 9, 1, 23) }))).toBe(false)
    expect(fits(date('updated', 'after', { date: '2026-10-01' }), issue({ updatedAt: at(2026, 9, 2, 0) }))).toBe(true)
  })

  test('finished: not yet is empty, and matches no time', () => {
    const open = issue({ completedAt: null })
    const done = issue({ completedAt: at(2026, 9, 20, 18) })
    expect([fits(date('completed', 'empty'), open), fits(date('completed', 'empty'), done)]).toEqual([true, false])
    expect([fits(date('completed', 'set'), open), fits(date('completed', 'set'), done)]).toEqual([false, true])
    const day = date('completed', 'within', { amount: 1, unit: 'days' })
    expect([fits(day, open), fits(day, done)]).toEqual([false, true])
    expect(fits(date('completed', 'ago', { amount: 1, unit: 'days' }), open)).toBe(false)
  })

  test('due dates are days', () => {
    const due = (dueDate: string | null) => issue({ dueDate })
    const next = date('due', 'next', { amount: 7, unit: 'days' })
    expect(['2026-10-20', '2026-10-21', '2026-10-28', '2026-10-29'].map((d) => fits(next, due(d)))).toEqual([false, true, true, false])
    expect(fits(next, due(null))).toBe(false)
    expect(['2026-10-20', '2026-10-21'].map((d) => fits(date('due', 'overdue'), due(d)))).toEqual([true, false])
    const lately = date('due', 'within', { amount: 3, unit: 'days' })
    expect(['2026-10-17', '2026-10-18', '2026-10-21', '2026-10-22'].map((d) => fits(lately, due(d)))).toEqual([false, true, true, false])
    const ago = date('due', 'ago', { amount: 3, unit: 'days' })
    expect(['2026-10-17', '2026-10-18'].map((d) => fits(ago, due(d)))).toEqual([true, false])
    expect(fits(date('due', 'next', { amount: 1, unit: 'months' }), due('2026-11-21'))).toBe(true)
    expect(['2026-10-20', '2026-10-21'].map((d) => fits(date('due', 'before', { date: '2026-10-21' }), due(d)))).toEqual([true, false])
    expect(['2026-10-21', '2026-10-22'].map((d) => fits(date('due', 'after', { date: '2026-10-21' }), due(d)))).toEqual([false, true])
    expect([fits(date('due', 'empty'), due(null)), fits(date('due', 'set'), due(null))]).toEqual([true, false])
  })

  test('with the other conditions, in groups; counted from the time of matching when no clock is given', () => {
    const mine = issue({ assignee: 'ania-k', completedAt: at(2026, 9, 21, 9) })
    const tree = and(is('assignees', ME), or(date('completed', 'within', { amount: 1, unit: 'days' }), date('due', 'overdue')))
    expect(matcher(tree, { ...ctx, now })(mine)).toBe(true)
    expect(matcher(tree, { ...ctx, now: new Date(2026, 9, 25) })(mine)).toBe(false)
    expect(matcher(and(date('created', 'within', { amount: 1, unit: 'hours' })), ctx)(issue({ createdAt: new Date().toISOString() }))).toBe(true)
  })

  test('one with no amount, unit or day yet is a draft line: left out, tidied away, not counted', () => {
    const draft = date('created', 'within', { unit: 'days' })
    const half = date('updated', 'before')
    const noUnit = date('created', 'ago', { amount: 3 })
    expect([draft, half, noUnit].every(isDateCondition)).toBe(true)
    expect([dateReady(draft), dateReady(half), dateReady(noUnit), dateReady(date('due', 'overdue'))]).toEqual([false, false, false, true])
    expect(ids(and(draft, half))).toEqual(ids(and()))
    expect(normalise(and(draft, is('labels', 'bug')))).toEqual(and(is('labels', 'bug')))
    expect(countConditions(and(draft, date('due', 'set'), is('labels')))).toBe(1)
    // a teammate's change keeps your unfinished one
    const { tree } = alignDraft(and(is('labels', 'bug'), draft), and(is('labels', 'bug'), is('teams', 'ENG')))
    expect(tree.items).toContain(draft)
  })

  test('anything the builder can’t show is from a newer version: kept, counted, left out of matching', () => {
    const newer = [
      date('due', 'before', { date: '2026-10-31T12:00' }),
      date('created', 'within', { amount: 0, unit: 'days' }),
      date('created', 'within', { amount: 1.5, unit: 'days' }),
      date('created', 'within', { amount: 3651, unit: 'days' }),
      date('due', 'within', { amount: 3, unit: 'hours' }),
      date('created', 'overdue'),
      date('updated', 'set'),
      date('created', 'before', { amount: 1, date: '2026-10-01' }),
      { ...date('created', 'within', { amount: 1, unit: 'days' }), zone: 'Europe/Warsaw' },
      { field: 'due', op: 'between', from: 1, to: 3 },
    ] as unknown as FilterNode[]
    for (const n of newer) {
      expect(isDateCondition(n)).toBe(false)
      expect(normalise(and(n, is('labels', 'bug'))).items).toContain(n)
      expect(countConditions(and(n))).toBe(1)
    }
    // only real days
    expect(isDateCondition(date('due', 'before', { date: '2026-02-30' }))).toBe(false)
    expect(isDateCondition(date('due', 'before', { date: '2026-13-45' }))).toBe(false)
    expect(isDateCondition(date('due', 'before', { date: '2028-02-29' }))).toBe(true)
    // a version before dates knows none of the date fields
    expect(DATE_FIELDS.some(isFilterField)).toBe(false)
    // the most there can be: ten years of each
    expect(isDateCondition(date('created', 'within', { amount: 3650, unit: 'days' }))).toBe(true)
    expect(isDateCondition(date('created', 'within', { amount: 8760, unit: 'hours' }))).toBe(true)
    // a teammate's line from a newer version isn't an unfinished one of yours
    const { tree } = alignDraft(and(newer[0]), and(is('labels', 'bug')))
    expect(tree.items).not.toContain(newer[0])
  })

  test('stored: only in the tree; the flat copy leaves them out', () => {
    const day = date('completed', 'within', { amount: 1, unit: 'days' })
    expect(storedFilters({}, and(day))).toEqual({ tree: and(day) })
    expect(storedFilters({}, and(is('statuses', 'done'), day))).toEqual({ statuses: ['done'], tree: and(is('statuses', 'done'), day) })
    expect(mirrorOf(and(is('labels', 'bug'), day))).toEqual({ labels: ['bug'] })
    expect(toFlat(and(day))).toBeUndefined()
    expect(treeOf(storedFilters({}, and(day)))).toEqual(and(day))
  })

  test('in words', () => {
    const say = (c: FilterNode) => (isDateCondition(c) ? sayDate(c) : 'x')
    const tree = and(date('completed', 'within', { amount: 1, unit: 'days' }), or(date('due', 'overdue'), date('created', 'before', { date: '2026-10-01' })))
    expect(describeTree(tree, say)).toBe('Completed in the last 1 day and (Due date is overdue or Created before 2026-10-01)')
    expect(sayDate(date('updated', 'ago', { amount: 2, unit: 'weeks' }))).toBe('Updated more than 2 weeks ago')
    expect(sayDate(date('due', 'next', { amount: 3, unit: 'days' }))).toBe('Due date in the next 3 days')
    expect(sayDate(date('completed', 'empty'))).toBe('Completed is empty')
    expect(sayDate(date('created', 'within', { amount: 1, unit: 'hours' }))).toBe('Created in the last 1 hour')
    expect(dateParts(date('updated', 'ago', { amount: 1, unit: 'months' }))).toEqual(['Updated more than', '1 month ago'])
    expect(dateParts(date('updated', 'after', { date: '2026-10-01' }), (d) => `day ${d}`)).toEqual(['Updated after', 'day 2026-10-01'])
    expect(dateParts(date('due', 'overdue'))).toEqual(['Due date', 'is overdue'])
  })

  test('a month back or on ends at the month’s last day', () => {
    const due = (dueDate: string) => issue({ dueDate })
    // Mar 31 a month back is Feb 28 (Feb 29 in a leap year); Jan 31 a month on is Feb 28
    const lastMonth = date('due', 'within', { amount: 1, unit: 'months' })
    const march = { ...ctx, now: new Date(2026, 2, 31, 12) }
    expect(['2026-02-27', '2026-02-28'].map((d) => matcher(and(lastMonth), march)(due(d)))).toEqual([false, true])
    const leap = { ...ctx, now: new Date(2028, 2, 31, 12) }
    expect(['2028-02-28', '2028-02-29'].map((d) => matcher(and(lastMonth), leap)(due(d)))).toEqual([false, true])
    const nextMonth = date('due', 'next', { amount: 1, unit: 'months' })
    const january = { ...ctx, now: new Date(2026, 0, 31, 12) }
    expect(['2026-02-28', '2026-03-01'].map((d) => matcher(and(nextMonth), january)(due(d)))).toEqual([true, false])
    // times too, keeping the time of day
    const created = date('created', 'within', { amount: 1, unit: 'months' })
    expect([at(2026, 1, 28, 11), at(2026, 1, 28, 13)].map((t) => matcher(and(created), march)(issue({ createdAt: t })))).toEqual([false, true])
  })

  test('a list keeps up with the clock only while a line moves with it', () => {
    expect(movesWithClock(and(is('labels', 'bug'), or(date('due', 'overdue'))))).toBe(true)
    expect(movesWithClock(and(date('completed', 'within', { amount: 1, unit: 'hours' })))).toBe(true)
    expect(movesWithClock(and(date('created', 'before', { date: '2026-10-01' }), date('due', 'empty')))).toBe(false)
    // an unfinished line doesn't count yet
    expect(movesWithClock(and(date('created', 'within', { unit: 'days' })))).toBe(false)
  })

  test('a teammate changing a date line keeps it the same line, so it keeps its place and key', () => {
    const mine = date('created', 'within', { amount: 7, unit: 'days' })
    const theirs = date('created', 'within', { amount: 3, unit: 'days' })
    const draft = and(is('labels', 'bug'), mine)
    const { tree, pairs } = alignDraft(draft, and(is('labels', 'bug'), theirs))
    expect(tree.items[1]).toBe(theirs)
    expect(pairs.find(([from]) => from === mine)?.[1]).toBe(theirs)
  })

  test('changing what it says or its field keeps what fits', () => {
    const c = date('created', 'within', { amount: 3, unit: 'hours' })
    expect(withDateOp(c, 'ago')).toMatchObject({ op: 'ago', amount: 3, unit: 'hours' })
    expect(withDateOp(c, 'before')).toEqual({ field: 'created', op: 'before', amount: undefined, unit: undefined, date: undefined })
    // a due date has no hours, and created has no "overdue"
    expect(withDateField(c, 'due')).toMatchObject({ field: 'due', op: 'within', amount: 3, unit: 'days' })
    expect(withDateField(date('due', 'overdue'), 'created')).toMatchObject({ field: 'created', op: 'within', amount: 7, unit: 'days' })
  })
})
