import { describe, expect, test } from 'bun:test'
import { sampleData } from './fixtures/sample'
import {
  FLAT_FIELDS,
  alignDraft,
  andStatuses,
  countConditions,
  describeTree,
  fromFlat,
  isGroup,
  matcher,
  mirrorOf,
  normalise,
  presetFrom,
  storedFilters,
  toFlat,
  treeOf,
  treeWithout,
  viewFilters,
  type MatchContext,
} from '@/data/filterTree'
import { followers } from '@/data/notify'
import { ME, type FilterCondition, type FilterGroup, type FilterNode, type Filters, type Issue } from '@/model/schema'
import { STATUS_IDS } from '@/model/status'

const data = sampleData()
const issues = Object.values(data.issues)
const ctx: MatchContext = { comments: data.comments, people: data.people, projects: data.projects, me: 'ania-k' }

const is = (field: string, ...values: FilterCondition['values']): FilterCondition => ({ field, op: 'is', values })
const not = (field: string, ...values: FilterCondition['values']): FilterCondition => ({ field, op: 'not', values })
const and = (...items: FilterNode[]): FilterGroup => ({ join: 'and', items })
const or = (...items: FilterNode[]): FilterGroup => ({ join: 'or', items })
/** the issues a tree lets through; null: with no context */
const ids = (tree: FilterGroup, c: MatchContext | null = ctx) => issues.filter(matcher(tree, c ?? undefined)).map((i) => i.id)
const where = (fits: (i: Issue) => boolean) => issues.filter(fits).map((i) => i.id)
/** from a newer version: a field this one doesn't know */
const cycle = { field: 'cycle', op: 'is', values: ['c1'] } as FilterCondition

/** matching as it was before trees (2.3.0), to check the flat filters still mean the same */
function oldMatches(issue: Issue, f: Filters, c?: MatchContext): boolean {
  if (f.teams?.length && !f.teams.includes(issue.team)) return false
  if (f.statuses?.length && !f.statuses.includes(issue.status)) return false
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
    // a small fixed-seed random, so a failure can be replayed
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const some = <T,>(xs: readonly T[]) => xs.filter(() => rand() < 0.35)
    const choices = {
      statuses: STATUS_IDS,
      assignees: [...Object.keys(data.people), null],
      subscribers: Object.keys(data.people),
      priorities: [0, 1, 2, 3, 4],
      labels: Object.keys(data.labels),
      projects: [...Object.keys(data.projects), null],
      teams: Object.keys(data.teams),
    }
    for (let n = 0; n < 300; n++) {
      const f = Object.fromEntries(FLAT_FIELDS.filter(() => rand() < 0.4).map((k) => [k, some(choices[k] as readonly unknown[])])) as Filters
      for (const c of [ctx, null]) expect(ids(treeOf(f), c)).toEqual(where((i) => oldMatches(i, f, c ?? undefined)))
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
    expect(ids(and(is('projectStatuses', 'in_progress')))).toEqual(where((i) => i.project === 'p-insights'))
    expect(ids(and(not('projectStatuses', 'in_progress')))).toEqual(where((i) => i.project !== 'p-insights'))
    expect(ids(and(not('projectStatuses', 'in_progress'))).some((id) => data.issues[id].project === null)).toBe(true)
    expect(ids(and(is('projectStatuses', 'in_progress')), { ...ctx, projects: undefined })).toEqual(where(() => true))
  })

  test('empty conditions and groups, and ones from a newer version, are left out of their group', () => {
    const bugs = where((i) => i.labels.includes('bug'))
    expect(ids(and(is('labels', 'bug'), is('statuses'), or()))).toEqual(bugs)
    expect(ids(and(is('labels', 'bug'), cycle))).toEqual(bugs)
    // in an "or", a condition that's left out doesn't let everything through
    expect(ids(or(is('labels', 'bug'), cycle))).toEqual(bugs)
    expect(ids(or(cycle, { join: 'xor', items: [] } as unknown as FilterGroup))).toEqual(where(() => true))
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
    expect(describeTree(tree, (c) => `${c.field} ${c.op} ${c.values.join('/')}`)).toBe('statuses is todo and labels is  and (assignees is @me or a filter from a newer version)')
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
