import { describe, expect, test } from 'bun:test'
import { hasQuick, impliedBy, isPicked, panelLines, quickScope, quickTree, splitAndCount, toggleQuick, withPicksAt, withQuick, withoutGone, type PanelItem, type QuickFilters } from '@/data/quickFilters'
import { matcher, treeOf, valueKey } from '@/data/filterTree'
import { displayKeeps } from '@/data/select'
import { DEFAULT_DISPLAY } from '@/data/displays'
import type { FilterGroup, Issue } from '@/model/schema'

let n = 0
function issue(p: Partial<Issue>): Issue {
  n++
  return {
    id: `i${n}`,
    number: n,
    title: `Issue ${n}`,
    status: 'todo',
    statusId: 'status-todo',
    priority: 0,
    assignee: null,
    labels: [],
    project: null,
    parent: null,
    sortOrder: `a${n}`,
    createdBy: 'ania',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    team: 'ENG',
    description: '',
    ...p,
  }
}

const all = () => true
const count = (m: Map<string, number>, v: unknown) => m.get(valueKey(v)) ?? 0

describe('toggleQuick', () => {
  test('one pick per tab: another value takes its place, the same one lets go; other tabs stay', () => {
    let q: QuickFilters = { labels: ['bug'] }
    q = toggleQuick(q, 'assignees', 'ania')
    expect(q).toEqual({ labels: ['bug'], assignees: ['ania'] })
    q = toggleQuick(q, 'assignees', null)
    expect(q).toEqual({ labels: ['bug'], assignees: [null] })
    expect(isPicked(q, 'assignees', 'ania')).toBe(false)
    q = toggleQuick(toggleQuick(q, 'assignees', null), 'labels', 'bug')
    expect(q).toEqual({})
    expect(hasQuick(q)).toBe(false)
    // several kept from before (an older version) all go when one of them is clicked
    expect(toggleQuick({ assignees: ['ania', 'ben'] }, 'assignees', 'ben')).toEqual({})
  })
  test('priority 0 and project null are values like any other', () => {
    const q = toggleQuick(toggleQuick({}, 'priorities', 0), 'projects', null)
    expect(q).toEqual({ priorities: [0], projects: [null] })
    expect(isPicked(q, 'priorities', 0)).toBe(true)
    expect(isPicked(q, 'priorities', '0' as never)).toBe(false)
  })
  test('values that are gone come out; nothing gone keeps the same object', () => {
    const q: QuickFilters = { labels: ['bug', 'gone'], projects: ['gone'] }
    const known = (_f: string, v: unknown) => v !== 'gone'
    expect(withoutGone(q, known)).toEqual({ labels: ['bug'] })
    const fine: QuickFilters = { labels: ['bug'] }
    expect(withoutGone(fine, known)).toBe(fine)
  })
})

describe('splitAndCount', () => {
  const a1 = issue({ assignee: 'ania', labels: ['bug'], priority: 2 })
  const a2 = issue({ assignee: 'ania', labels: ['bug', 'ui'], priority: 1, project: 'p1' })
  const b1 = issue({ assignee: 'ben', labels: ['ui'], priority: 2 })
  const none = issue({ priority: 0 })
  const base = [a1, a2, b1, none]

  test('nothing picked: everything shown, every value counted', () => {
    const { shown, counts } = splitAndCount(base, {}, all)
    expect(shown).toEqual(base)
    expect(count(counts.assignees, 'ania')).toBe(2)
    expect(count(counts.assignees, null)).toBe(1)
    expect(count(counts.priorities, 0)).toBe(1)
    expect(count(counts.projects, null)).toBe(3)
    expect(count(counts.projects, 'p1')).toBe(1)
  })
  test('labels count per label; an issue without labels counts on none', () => {
    const { counts } = splitAndCount(base, {}, all)
    expect(count(counts.labels, 'bug')).toBe(2)
    expect(count(counts.labels, 'ui')).toBe(2)
    expect([...counts.labels.values()].reduce((x, y) => x + y, 0)).toBe(4)
  })
  test('picking a person keeps the Assignees counts and narrows the other tabs', () => {
    const { shown, counts } = splitAndCount(base, { assignees: ['ania'] }, all)
    expect(shown).toEqual([a1, a2])
    expect(count(counts.assignees, 'ania')).toBe(2)
    expect(count(counts.assignees, 'ben')).toBe(1)
    expect(count(counts.assignees, null)).toBe(1)
    expect(count(counts.labels, 'ui')).toBe(1)
    expect(count(counts.priorities, 2)).toBe(1)
  })
  test('within a tab any pick counts, across tabs all must', () => {
    expect(splitAndCount(base, { assignees: ['ania', 'ben'] }, all).shown).toEqual([a1, a2, b1])
    expect(splitAndCount(base, { assignees: ['ania', 'ben'], labels: ['ui'] }, all).shown).toEqual([a2, b1])
    expect(splitAndCount(base, { labels: ['bug'], priorities: [1] }, all).shown).toEqual([a2])
  })
  test('each count is what picking only that row would show, given the other tabs', () => {
    const q: QuickFilters = { assignees: ['ania'], labels: ['ui'] }
    const { counts } = splitAndCount(base, q, all)
    for (const [field, value] of [['assignees', 'ben'], ['labels', 'bug'], ['priorities', 2]] as const) {
      const only = { ...q, [field]: [value] }
      expect(count(counts[field], value)).toBe(splitAndCount(base, only, all).shown.length)
    }
  })
  test('an issue failing two tabs counts nowhere', () => {
    // b1 fails Assignee (ania) and Labels (bug)
    const { counts } = splitAndCount(base, { assignees: ['ania'], labels: ['bug'] }, all)
    expect(count(counts.priorities, 2)).toBe(1)
    expect(count(counts.assignees, 'ben')).toBe(0)
    expect(count(counts.labels, 'ui')).toBe(1)
  })
  test('kept issues stay shown; the display decides what counts', () => {
    const done = issue({ status: 'done', assignee: 'ben' })
    const sub = issue({ parent: a1.id, assignee: 'ania' })
    const keeps = displayKeeps({ ...DEFAULT_DISPLAY, showCompleted: false, showSubIssues: false }, new Set([done.id]))
    const { shown, counts, total } = splitAndCount([...base, done, sub], { assignees: ['ania'] }, keeps, { keep: new Set([done.id]) })
    expect(shown).toEqual([a1, a2, done, sub])
    expect(count(counts.assignees, 'ben')).toBe(2)
    expect(count(counts.assignees, 'ania')).toBe(2)
    // the sub-issue isn't counted: the display hides it
    expect(total).toBe(base.length + 1)
  })
  test('with the panel hidden, nothing is counted, and the list is the same', () => {
    const q: QuickFilters = { assignees: ['ania'] }
    const quiet = splitAndCount(base, q, all, { count: false })
    expect(quiet.shown).toEqual(splitAndCount(base, q, all).shown)
    expect(quiet.counts.assignees.size).toBe(0)
    expect(quiet.total).toBe(base.length)
  })
})

describe('withQuick', () => {
  test('no picks: the same filters', () => {
    const own = { labels: ['bug'] }
    expect(withQuick(own, {})).toBe(own)
  })
  test('flat filters and picks on other fields stay flat', () => {
    expect(withQuick({ labels: ['bug'] }, { assignees: ['ania', null], priorities: [1] })).toEqual({ labels: ['bug'], assignees: ['ania', null], priorities: [1] })
    expect(withQuick({}, { projects: [null] })).toEqual({ projects: [null] })
  })
  test('an Assignee line and a picked assignee: a tree, with the shared people as the flat copy', () => {
    const f = withQuick({ assignees: ['ania', 'ben'] }, { assignees: ['ben', 'cleo'] })
    expect(f.tree).toEqual({
      join: 'and',
      items: [
        { field: 'assignees', op: 'is', values: ['ania', 'ben'] },
        { field: 'assignees', op: 'is', values: ['ben', 'cleo'] },
      ],
    })
    expect(f.assignees).toEqual(['ben'])
  })
  test('an "or" at the top goes in brackets, and the result matches the same issues', () => {
    const own = { tree: { join: 'or' as const, items: [{ field: 'assignees', op: 'is' as const, values: ['ania'] }, { field: 'labels', op: 'is' as const, values: ['ui'] }] } }
    const q: QuickFilters = { priorities: [2] }
    const f = withQuick(own, q)
    expect(f.tree).toEqual({ join: 'and', items: [own.tree, ...quickTree(q).items] })
    const issues = [issue({ assignee: 'ania', priority: 2 }), issue({ labels: ['ui'], priority: 1 }), issue({ assignee: 'ben', priority: 2 }), issue({ labels: ['ui'], priority: 2 })]
    const test = matcher(treeOf(f))
    const both = (i: Issue) => matcher(treeOf(own))(i) && matcher(quickTree(q))(i)
    expect(issues.map(test)).toEqual(issues.map(both))
    expect(issues.map(test)).toEqual([true, false, false, true])
  })
  test('picks the filters already say add nothing, and flat stays flat', () => {
    const view = { labels: ['bug'] }
    expect(withQuick(view, { labels: ['bug'] })).toBe(view)
    // a view of Ana's issues: picking Ana or Ben says nothing more either
    const ana = { assignees: ['ania'] }
    expect(withQuick(ana, { assignees: ['ania', 'ben'] })).toBe(ana)
    expect(withQuick(view, { labels: ['bug'], priorities: [1] })).toEqual({ labels: ['bug'], priorities: [1] })
    // a pick narrower than the filter does add something
    expect(withQuick({ labels: ['bug', 'ui'] }, { labels: ['bug'] }).tree).toBeDefined()
  })
  test('a tree with the same line at its top "and" counts too; inside an "or" it does not', () => {
    const line = { field: 'labels', op: 'is' as const, values: ['bug'] }
    const and: FilterGroup = { join: 'and', items: [line, { field: 'created', op: 'within', amount: 7, unit: 'days' }] }
    expect(impliedBy(and, 'labels', ['bug'])).toBe(true)
    expect(impliedBy({ join: 'or', items: [line, { field: 'priorities', op: 'is', values: [1] }] }, 'labels', ['bug'])).toBe(false)
    expect(impliedBy({ join: 'and', items: [{ ...line, op: 'not' }] }, 'labels', ['bug'])).toBe(false)
    const own = { tree: and }
    expect(withQuick(own, { labels: ['bug'] })).toBe(own)
  })
  test('other keys in the filters (from a newer version) stay', () => {
    expect(withQuick({ labels: ['bug'], later: 1 } as never, { assignees: ['ania'] })).toEqual({ labels: ['bug'], later: 1, assignees: ['ania'] } as never)
  })
})

describe('displayKeeps', () => {
  test('leaves out finished issues and sub-issues as the display says, and keeps dropped ones', () => {
    const closed = issue({ status: 'done' })
    const sub = issue({ parent: 'x' })
    const open = issue({})
    const keep = displayKeeps({ showCompleted: false, showSubIssues: true })
    expect([closed, sub, open].map(keep)).toEqual([false, true, true])
    expect(displayKeeps({ showCompleted: false, showSubIssues: true }, new Set([closed.id]))(closed)).toBe(true)
    expect(displayKeeps({ showCompleted: true, showSubIssues: false })(sub)).toBe(false)
  })
})

describe('panelLines', () => {
  const items = [
    { value: null, label: 'No assignee' },
    { value: 'ania', label: 'Ania' },
    { value: 'ben', label: 'Ben' },
    { value: 'cleo', label: 'Cleo' },
  ]
  const counts = (m: Record<string, number>) => ({ assignees: new Map(Object.entries(m).map(([k, v]) => [valueKey(k === 'null' ? null : k), v])), labels: new Map(), priorities: new Map(), projects: new Map() })
  const unknown = (login: string) => ({ value: login, label: login })
  test('values with issues, most first, then by name', () => {
    const lines = panelLines('assignees', items, counts({ ania: 2, ben: 5, null: 2 }), {}, unknown)
    expect(lines.map((l) => [l.label, l.count])).toEqual([['Ben', 5], ['Ania', 2], ['No assignee', 2]])
  })
  test('a pick keeps its place; one at 0 stays, at the end', () => {
    const lines = panelLines('assignees', items, counts({ ania: 2, ben: 5 }), { assignees: ['ania'] }, unknown)
    expect(lines.map((l) => [l.label, l.count, l.picked])).toEqual([['Ben', 5, false], ['Ania', 2, true]])
    const gone = panelLines('assignees', items, counts({ ania: 2, ben: 5 }), { assignees: ['cleo'] }, unknown)
    expect(gone.map((l) => [l.label, l.count, l.picked])).toEqual([['Ben', 5, false], ['Ania', 2, false], ['Cleo', 0, true]])
  })
  test('someone assigned who is not among the people gets a line', () => {
    const lines = panelLines('assignees', items, counts({ ghost: 1 }), { assignees: ['gone'] }, unknown)
    expect(lines.map((l) => l.label).sort()).toEqual(['ghost', 'gone'])
  })
  test('Priority keeps its own order, picked or not', () => {
    const c = { ...counts({}), priorities: new Map([0, 1, 2, 3, 4].map((p) => [valueKey(p), 10 - p])) }
    const prio: PanelItem[] = [0, 1, 2, 3, 4].map((p) => ({ value: p, label: `P${p}` }))
    expect(panelLines('priorities', prio, c, {}, unknown).map((l) => l.value)).toEqual([1, 2, 3, 4, 0])
    expect(panelLines('priorities', prio, c, { priorities: [3] }, unknown).map((l) => l.value)).toEqual([1, 2, 3, 4, 0])
  })
})

describe('picks per page', () => {
  test('each page keeps its own; letting go of everything takes the page out', () => {
    const eng = quickScope('ws1', 'team:ENG:active')
    const des = quickScope('ws1', 'team:DES:active')
    let kept = withPicksAt({}, eng, { labels: ['bug'] })
    kept = withPicksAt(kept, des, { assignees: ['ben'] })
    expect(kept[eng]).toEqual({ labels: ['bug'] })
    expect(kept[des]).toEqual({ assignees: ['ben'] })
    kept = withPicksAt(kept, eng, {})
    expect(Object.keys(kept)).toEqual([des])
    expect(quickScope('ws2', 'team:ENG:active')).not.toBe(eng)
  })
})
