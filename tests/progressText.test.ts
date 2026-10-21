import { describe, expect, test } from 'bun:test'
import { arcShare, ringClick } from '@/components/ringTip'
import { NO_ISSUES, type ProjectCounts } from '@/data/select'
import { issueCountText, progressWords } from '@/features/projects/progressText'
import { shortText } from '@/lib/text'

const counts = (c: Partial<ProjectCounts>): ProjectCounts => ({ ...NO_ISSUES, ...c })

describe('what a project ring says', () => {
  test('part done: the percent, the numbers and what is still open, in category order', () => {
    expect(progressWords(counts({ done: 8, in_progress: 3, todo: 1 }))).toEqual(['66% done: 8 of 12 issues', 'Still open: 1 Todo, 3 In Progress'])
    expect(progressWords(counts({ backlog: 1, todo: 2, in_progress: 3, in_review: 1, done: 1 }))).toEqual([
      '12% done: 1 of 8 issues',
      'Still open: 1 Backlog, 2 Todo, 3 In Progress, 1 In Review',
    ])
  })

  test('one in two hundred is 1%, one short of two hundred is 99%', () => {
    expect(progressWords(counts({ done: 1, todo: 199 }))[0]).toBe('1% done: 1 of 200 issues')
    expect(progressWords(counts({ done: 199, todo: 1 }))[0]).toBe('99% done: 199 of 200 issues')
  })

  test('nothing done yet, with one issue', () => {
    expect(progressWords(counts({ todo: 1 }))).toEqual(['0% done: 0 of 1 issue', 'Still open: 1 Todo'])
  })

  test('all done', () => {
    expect(progressWords(counts({ done: 12 }))).toEqual(['All 12 issues done'])
    expect(progressWords(counts({ done: 1 }))).toEqual(['The 1 issue is done'])
  })

  test('no issues, and only canceled ones', () => {
    expect(progressWords(NO_ISSUES)).toEqual(['No issues yet'])
    expect(progressWords(counts({ canceled: 2, duplicate: 1 }))).toEqual(['No issues to count: 3 issues are left out', 'Not counted: 2 canceled, 1 duplicate'])
    expect(progressWords(counts({ canceled: 1 }))).toEqual(['No issues to count: 1 issue is left out', 'Not counted: 1 canceled'])
  })

  test('says what is left out and how many archived ones count', () => {
    expect(progressWords(counts({ done: 4, todo: 1, duplicate: 2, archived: 4 }))).toEqual([
      '80% done: 4 of 5 issues',
      'Still open: 1 Todo',
      'Not counted: 2 duplicates',
      'Counts 4 archived issues',
    ])
    expect(progressWords(counts({ done: 1, archived: 1 }))).toEqual(['The 1 issue is done', 'Counts 1 archived issue'])
  })

})

describe('how many issues a card shows', () => {
  test('one, many or none', () => {
    expect(issueCountText(0)).toBe('No issues')
    expect(issueCountText(1)).toBe('1 issue')
    expect(issueCountText(12)).toBe('12 issues')
  })
})

describe('the ring', () => {
  test('a little done still shows, nearly done still leaves a gap, only all done closes it', () => {
    expect(arcShare(0, 0)).toBe(0)
    expect(arcShare(0, 4)).toBe(0)
    expect(arcShare(1, 200)).toBe(0.06)
    expect(arcShare(199, 200)).toBe(0.94)
    expect(arcShare(1, 2)).toBe(0.5)
    expect(arcShare(5, 5)).toBe(1)
  })
})

describe('a click on the ring', () => {
  test('a tap opens or closes the tooltip; a mouse click, or the click that ends a drag, opens the link', () => {
    expect(ringClick('touch', false)).toBe('toggle')
    expect(ringClick('pen', false)).toBe('toggle')
    expect(ringClick('mouse', false)).toBe('link')
    expect(ringClick('touch', true)).toBe('link')
    // a click with no press on the ring (Enter on the link around it)
    expect(ringClick(undefined, false)).toBe('link')
  })
})

describe('the start of a description', () => {
  test('new lines and runs of spaces become one space', () => {
    expect(shortText('  # Goal\n\n- item one\n- item\ttwo  ')).toBe('# Goal - item one - item two')
    expect(shortText('')).toBe('')
    expect(shortText(' \n ')).toBe('')
  })

  test('a long one is cut with an ellipsis', () => {
    const long = 'https://example.com/' + 'a'.repeat(300)
    const out = shortText(long)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(201)
    expect(shortText('word '.repeat(10), 12)).toBe('word word wo…')
  })

  test('never cuts inside an emoji or a Polish letter', () => {
    const family = '👨‍👩‍👧'
    const out = shortText(`ab${family}cd`, 4)
    expect(out).toBe('ab…')
    expect(shortText(`ab${family}cd`, 2 + family.length)).toBe(`ab${family}…`)
    // "ó" written as o and a combining accent stays whole
    const accent = 'Zazólc'
    expect(shortText(accent, 4)).toBe('Zaz…')
    expect(shortText('Zażółć gęślą jaźń', 6)).toBe('Zażółć…')
    // a first character longer than the room is kept whole, not dropped
    expect(shortText(`${family}${family}`, 3)).toBe(`${family}…`)
  })
})
