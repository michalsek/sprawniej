import { expect, test } from 'bun:test'
import { targetsFor } from '@/features/issues/selection'

test.each([
  ['nothing else picked', 'a', [], ['a']],
  ['only this one picked', 'a', ['a'], ['a']],
  ['this one among several picked: all of them', 'b', ['a', 'b', 'c'], ['a', 'b', 'c']],
  ['others picked, not this one: just this one', 'd', ['a', 'b', 'c'], ['d']],
] as const)('a change from one row is for… %s', (_, id, picked, want) => {
  expect(targetsFor(id, picked)).toEqual([...want])
})
