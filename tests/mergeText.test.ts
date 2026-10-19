import { expect, test } from 'bun:test'
import { mergeText, type MergeCount } from '@/editor/mergeText'

test('where both changed the same lines, ours stays and the clash is counted', () => {
  const ctx: MergeCount = { conflicts: 0 }
  expect(mergeText('a\nb\nc', 'a\nX\nc', 'a\nY\nc', ctx)).toBe('a\nX\nc')
  expect(ctx.textConflicts).toBe(1)
})

test('changes to different lines both stay', () => {
  const ctx: MergeCount = { conflicts: 0 }
  expect(mergeText('one\ntwo\nthree\nfour\nfive', 'ONE\ntwo\nthree\nfour\nfive', 'one\ntwo\nthree\nfour\nFIVE', ctx)).toBe(
    'ONE\ntwo\nthree\nfour\nFIVE',
  )
  expect(ctx.textConflicts).toBeUndefined()
})

test('when ours is unchanged, theirs is taken as it is', () => {
  expect(mergeText('a\nb', 'a\nb', 'a\nB')).toBe('a\nB')
})
