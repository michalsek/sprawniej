import { describe, expect, test } from 'bun:test'
import { checklistCount, checklistItems, openable, setChecked, setCheckedAtLine, showable, tickFrom, tickItem } from '@/data/checklist'
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

test('empty items: a space for the editor, a blank for reading views, on the same lines; code is left alone', () => {
  expect(openable('- [ ] a\n- [ ]\n> - [x]\r')).toBe('- [ ] a\n- [ ] \n> - [x] ')
  expect(showable('- [ ] a\n- [ ]  \n```\n- [ ]\n```')).toBe('- [ ] a\n- [ ] &nbsp;\n```\n- [ ]\n```')
})

describe('a tick in the editor goes on its own only when it is the one change', () => {
  const before = '* [ ] a\n* [x] b'
  const tick = (index: number, checked: boolean) => ({ index, checked })
  test('the saved text with that box changed, even while an edit seemed to wait', () => {
    expect(tickFrom(before, '* [x] a\n* [x] b', tick(0, true), true)).toEqual({ index: 0, text: 'a', checked: true })
  })
  test('written the editor’s way, with nothing else waiting', () => {
    expect(tickFrom(before, '- [x] a\n- [x] b', tick(0, true), false)).toEqual({ index: 0, text: 'a', checked: true })
  })
  test('not when typing waits to be saved, another box changed, the items differ, it already is so, or there is no such item', () => {
    expect(tickFrom(before, '- [x] a typed\n- [x] b', tick(0, true), true)).toBeNull()
    expect(tickFrom(before, '- [x] a\n- [ ] b', tick(0, true), false)).toBeNull()
    expect(tickFrom(before, '- [x] a\n- [x] b\n- [ ] c', tick(0, true), false)).toBeNull()
    expect(tickFrom(before, '* [ ] a\n* [x] b', tick(1, true), false)).toBeNull()
    expect(tickFrom(before, '* [ ] a\n* [x] b', tick(5, true), false)).toBeNull()
  })
})
