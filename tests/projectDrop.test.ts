import { describe, expect, test } from 'bun:test'
import { arrowTarget, columnBeside, nearestCard } from '@/features/board/columnsDrag'
import { dropMove, type Drop } from '@/features/projects/drop'

const drop = (more: Partial<Drop>): Drop => ({ id: 'p', from: 'planned', to: 'planned', ids: ['a', 'p', 'b'], was: 1, over: 'planned', closed: new Set(['on-hold']), ...more })

describe('a project let go on the board', () => {
  test('over a hidden status’s column it goes back where it came from, even after passing another column', () => {
    expect(dropMove(drop({ over: 'on-hold' }))).toBeNull()
    expect(dropMove(drop({ to: 'canceled', ids: ['x', 'p'], over: 'on-hold' }))).toBeNull()
  })

  test('within the hidden status it already has, it may move', () => {
    expect(dropMove(drop({ from: 'on-hold', to: 'on-hold', ids: ['p', 'a'], was: 1, over: 'on-hold' }))).toEqual({ place: { prev: null, next: 'a' } })
  })

  test('where it was, nothing; into another column, its status and neighbours', () => {
    expect(dropMove(drop({}))).toBeNull()
    expect(dropMove(drop({ to: 'paused', ids: ['x', 'p'], over: 'paused' }))).toEqual({ statusId: 'paused', place: { prev: 'x', next: null } })
  })
})

describe('arrow keys between columns', () => {
  const columns = [
    { key: 'backlog', left: 0, top: 0 },
    { key: 'planned', left: 350, top: 0 },
    { key: 'paused', left: 700, top: 0 },
  ]
  test('left and right go to the column beside; at the edge, or in a list of stacked groups, there is none', () => {
    expect(columnBeside(columns, { left: 350 }, -1, 100)).toBe('backlog')
    expect(columnBeside(columns, { left: 350 }, 1, 100)).toBe('paused')
    expect(columnBeside(columns, { left: 0 }, -1, 100)).toBeUndefined()
    expect(columnBeside([{ key: 'todo', left: 0, top: 0 }, { key: 'done', left: 0, top: 400 }], { left: 0 }, 1, 100)).toBeUndefined()
  })

  test('among columns stacked at that edge, the one nearest in height; next to the card nearest in height', () => {
    expect(columnBeside([...columns, { key: 'later', left: 700, top: 500 }], { left: 350 }, 1, 480)).toBe('later')
    expect(nearestCard([{ id: 'top', top: 50 }, { id: 'lower', top: 200 }], 180)).toBe('lower')
    expect(nearestCard([], 180)).toBeUndefined()
  })

  test('the arrow keys start from a hidden column the card is over; Left in the first column stays; Right past the last is dnd-kit’s', () => {
    const board = [...columns, { key: 'hidden', left: 1050, top: 0 }]
    const keys = (side: -1 | 1, live: string, over?: string) => arrowTarget({ side, live, over, closed: new Set(['hidden']), columns: board, top: 100 })
    expect(keys(-1, 'paused', 'hidden')).toBe('paused')
    expect(keys(-1, 'paused', 'paused')).toBe('planned')
    expect(keys(-1, 'backlog')).toBe('stay')
    expect(keys(1, 'paused')).toBeUndefined()
    // a list: groups stacked, no sides
    expect(arrowTarget({ side: -1, live: 'todo', over: 'todo', closed: new Set(), columns: [{ key: 'todo', left: 0, top: 0 }, { key: 'done', left: 0, top: 400 }], top: 100 })).toBeUndefined()
  })
})
