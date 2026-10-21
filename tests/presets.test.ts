import { describe, expect, test } from 'bun:test'
import { presetForGroup } from '@/data/presets'
import { treeOf } from '@/data/filterTree'
import { ME } from '@/model/schema'

const none = { join: 'and' as const, items: [] }

describe('presetForGroup', () => {
  test('the page: one team, one project', () => {
    expect(presetForGroup({ value: null }, { ownTree: none, filters: { teams: ['ENG'] }, picks: {}, grouping: 'none' })).toEqual({ team: 'ENG' })
    expect(presetForGroup({ value: null }, { ownTree: none, filters: { projects: ['p1'] }, picks: {}, grouping: 'none' })).toEqual({ project: 'p1' })
  })
  test('your filters: Me becomes you, labels go on it', () => {
    const ownTree = treeOf({ assignees: [ME], labels: ['bug'] })
    expect(presetForGroup({ value: null }, { ownTree, filters: {}, picks: {}, grouping: 'none', me: 'ania' })).toEqual({ assignee: 'ania', labels: ['bug'] })
  })
  test('one picked quick value wins; picked labels join the others', () => {
    const ownTree = treeOf({ assignees: ['ania', 'ben'], labels: ['bug'] })
    const p = presetForGroup({ value: null }, { ownTree, filters: {}, picks: { assignees: ['ben'], labels: ['ui', 'bug'], priorities: [2], projects: [null] }, grouping: 'none' })
    expect(p).toEqual({ assignee: 'ben', labels: ['bug', 'ui'], priority: 2, project: null })
  })
  test('two picked people say nothing about who', () => {
    expect(presetForGroup({ value: null }, { ownTree: none, filters: {}, picks: { assignees: ['ania', 'ben'] }, grouping: 'none' })).toEqual({})
  })
  test('the group has the last word', () => {
    const picks = { assignees: ['ben'], priorities: [2] }
    expect(presetForGroup({ value: 'status-1' }, { ownTree: none, filters: {}, picks, grouping: 'status' })).toMatchObject({ statusId: 'status-1', assignee: 'ben' })
    expect(presetForGroup({ value: 4 }, { ownTree: none, filters: {}, picks, grouping: 'priority' }).priority).toBe(4)
    expect(presetForGroup({ value: null }, { ownTree: none, filters: {}, picks, grouping: 'assignee' }).assignee).toBeNull()
    expect(presetForGroup({ value: 'p2' }, { ownTree: none, filters: { projects: ['p1'] }, picks, grouping: 'project' }).project).toBe('p2')
  })
})
