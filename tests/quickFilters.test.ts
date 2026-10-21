import { describe, expect, test } from 'bun:test'
import { hasQuick, isPicked, quickTree, splitAndCount, toggleQuick, withQuick, withoutGone, type QuickFilters } from '@/data/quickFilters'
import { matcher, treeOf, valueKey } from '@/data/filterTree'
import { displayKeeps } from '@/data/select'
import { DEFAULT_DISPLAY } from '@/data/displays'
import type { Issue } from '@/model/schema'

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
  test('adds, removes, and drops a field with nothing left', () => {
    let q: QuickFilters = {}
    q = toggleQuick(q, 'assignees', 'ania')
    expect(q).toEqual({ assignees: ['ania'] })
    q = toggleQuick(q, 'assignees', null)
    expect(q).toEqual({ assignees: ['ania', null] })
    expect(isPicked(q, 'assignees', null)).toBe(true)
    q = toggleQuick(q, 'assignees', 'ania')
    q = toggleQuick(q, 'assignees', null)
    expect(q).toEqual({})
    expect(hasQuick(q)).toBe(false)
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
    const { shown, counts } = splitAndCount([...base, done, sub], { assignees: ['ania'] }, keeps, new Set([done.id]))
    expect(shown).toEqual([a1, a2, done, sub])
    expect(count(counts.assignees, 'ben')).toBe(2)
    expect(count(counts.assignees, 'ania')).toBe(2)
  })
  test('5,000 issues take little time', () => {
    const many = Array.from({ length: 5000 }, (_, k) => issue({ assignee: `p${k % 40}`, labels: [`l${k % 30}`, `l${k % 7}`], priority: (k % 5) as Issue['priority'], project: k % 3 ? `p${k % 12}` : null }))
    const q: QuickFilters = { assignees: ['p1', 'p2'], labels: ['l3'] }
    const start = performance.now()
    for (let k = 0; k < 10; k++) splitAndCount(many, q, all)
    expect((performance.now() - start) / 10).toBeLessThan(50)
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
  test('other keys in the filters (from a newer version) stay', () => {
    expect(withQuick({ labels: ['bug'], later: 1 } as never, { assignees: ['ania'] })).toEqual({ labels: ['bug'], later: 1, assignees: ['ania'] } as never)
  })
})

describe('displayKeeps', () => {
  test('matches what groupIssues leaves in', () => {
    const closed = issue({ status: 'done' })
    const sub = issue({ parent: 'x' })
    const open = issue({})
    const keep = displayKeeps({ showCompleted: false, showSubIssues: true })
    expect([closed, sub, open].map(keep)).toEqual([false, true, true])
    expect(displayKeeps({ showCompleted: false, showSubIssues: true }, new Set([closed.id]))(closed)).toBe(true)
    expect(displayKeeps({ showCompleted: true, showSubIssues: false })(sub)).toBe(false)
  })
})
