import { describe, expect, test } from 'bun:test'
import { arrowTarget, columnBeside, keepSame, mostCovered, nearestCard } from '@/features/board/columnsDrag'
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

describe('the column a card is over, without a pointer in one', () => {
  // two board columns, 336 wide with a 16 px gap; the dragged card is 320 wide and 82 tall
  const planned = { id: 'planned', rect: { left: 506, top: 144, width: 336, height: 740 } }
  const going = { id: 'going', rect: { left: 858, top: 144, width: 336, height: 740 } }
  const card = (left: number) => ({ left, top: 320, width: 320, height: 82 })

  test('a card straddling two columns is over the one it covers most, whatever the cards in them are', () => {
    // the board froze here: halfway through the keyboard's scroll the card overlapped a card in each column, and
    // moving it swapped which one it overlapped more, back and forth. Columns don't move when a card does.
    expect(mostCovered([planned, going], card(760))).toBe('going')
    expect(mostCovered([planned, going], card(560))).toBe('planned')
    expect(mostCovered([planned, going], card(1300))).toBeUndefined()
  })

  test('by area, not by share: a long column is not worse than a short one', () => {
    const long = { id: 'long', rect: { left: 0, top: 0, width: 100, height: 2000 } }
    const short = { id: 'short', rect: { left: 100, top: 0, width: 100, height: 50 } }
    expect(mostCovered([long, short], { left: 40, top: 0, width: 100, height: 50 })).toBe('long')
  })

  test('stacked groups in a list: moving the card into the group it covers most keeps it there', () => {
    const rect = { left: 0, top: 170, width: 300, height: 44 }
    // a card on the line between Todo (0 to 200) and Done (200 to 400), more in Todo
    expect(mostCovered([{ id: 'todo', rect: { left: 0, top: 0, width: 300, height: 200 } }, { id: 'done', rect: { left: 0, top: 200, width: 300, height: 200 } }], rect)).toBe('todo')
    // it leaves Done for Todo: Todo grows by a row and Done moves down, so it is even more in Todo
    expect(mostCovered([{ id: 'todo', rect: { left: 0, top: 0, width: 300, height: 244 } }, { id: 'done', rect: { left: 0, top: 244, width: 300, height: 156 } }], rect)).toBe('todo')
  })
})

test('a column whose issues are the same keeps its very list, so its cards aren’t drawn again', () => {
  const prev = { todo: ['a', 'b'], done: ['c'] }
  const next = keepSame(prev, { todo: ['a', 'b'], done: ['c', 'd'] })
  expect(next.todo).toBe(prev.todo)
  expect(next.done).toEqual(['c', 'd'])
  expect(keepSame(prev, { todo: ['a', 'b'], done: ['c'] })).toBe(prev)
  // a column gone or new is a change
  expect(keepSame(prev, { todo: ['a', 'b'] })).not.toBe(prev)
  expect(keepSame(prev, { ...prev, later: [] })).not.toBe(prev)
})
