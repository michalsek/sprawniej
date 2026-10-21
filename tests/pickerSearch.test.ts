import { expect, test } from 'bun:test'
import { searchItems } from '@/components/pickerSearch'

const people = [
  { label: 'Bob Test', keywords: ['dbt-rob2'] },
  { label: 'Cy', keywords: ['cy'] },
  { label: 'Dee', keywords: ['dbt-bob'] },
]
const labels = (items: { label: string }[]) => items.map((i) => i.label)

test('nothing typed: everything, in its own order', () => {
  expect(searchItems(people, '')).toBe(people)
})

test('the best match comes first, so Enter picks it, even when it was hidden a moment ago', () => {
  expect(labels(searchItems(people, 'dbt-rob'))).toEqual(['Bob Test'])
  // typed on: Dee's handle is an exact match, and comes before Bob, who matches by name
  expect(labels(searchItems(people, 'bob'))).toEqual(['Bob Test', 'Dee'])
  expect(labels(searchItems(people, 'dbt-bob'))[0]).toBe('Dee')
})

test('equally good matches keep their order; no match, nothing', () => {
  const two = [{ label: 'Ana One' }, { label: 'Ana Two' }]
  expect(labels(searchItems(two, 'ana'))).toEqual(['Ana One', 'Ana Two'])
  expect(searchItems(people, 'zzz')).toEqual([])
})

test('without Polish letters', () => {
  expect(labels(searchItems([{ label: 'Łukasz' }, { label: 'Zosia' }], 'lukasz'))).toEqual(['Łukasz'])
})
