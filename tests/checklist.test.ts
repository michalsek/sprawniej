import { describe, expect, test } from 'bun:test'
import { checklistCount, checklistItems, openable, setChecked, setCheckedAtLine, tickItem } from '@/data/checklist'
import { CHECKLISTS } from './fixtures/checklists'

describe.each(CHECKLISTS)('$name', ({ md, items, ticks }) => {
  test('finds the items', () => {
    expect(checklistItems(md).map(({ text, checked }) => ({ text, checked }))).toEqual(items)
  })
  test.each(ticks)('ticking item $item ("$text") to $checked', ({ item, text, checked, after }) => {
    expect(tickItem(md, item, text, checked)).toBe(after)
  })
})

test('a tick changes the box and nothing else, by item or by line', () => {
  const md = 'Intro\n* [X] a  \n> + [ ] b\n'
  expect(setChecked(md, 1, true)).toBe('Intro\n* [X] a  \n> + [x] b\n')
  expect(setCheckedAtLine(md, 1, false)).toBe('Intro\n* [ ] a  \n> + [ ] b\n')
  // a line that isn't an item, or an item that's already that way
  expect(setCheckedAtLine(md, 0, true)).toBe(md)
  expect(setChecked(md, 0, true)).toBe(md)
})

test('the count: done of all, none without a checklist', () => {
  expect(checklistCount(CHECKLISTS[0].md)).toEqual({ done: 1, total: 3 })
  expect(checklistCount('Just text with [brackets]')).toBeNull()
  expect(checklistCount('```\n- [ ] in code\n```')).toBeNull()
})

test('a box at the end of a line gets a space, so it opens as an empty item; code is left alone', () => {
  expect(openable('- [ ] a\n- [ ]\n> - [x]')).toBe('- [ ] a\n- [ ] \n> - [x] ')
  expect(openable('```\n- [ ]\n```')).toBe('```\n- [ ]\n```')
})
