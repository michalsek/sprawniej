import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { stopWrites } from '@/backend/writes'
import { changeHandle } from '@/data/actions'
import { cleanHandle, HANDLE_WORDS, handleProblem } from '@/data/handles'
import { useData } from '@/data/store'
import type { Person } from '@/model/schema'
import { person, seed } from './support/fakeBackend'

const ana = person('ana')
const bob: Person = { ...person('bob'), handle: 'robert' }
const people: Record<string, Person> = { ana, bob }

describe('handles', () => {
  test('what was typed, without spaces or the @ in front', () => {
    expect(cleanHandle(' @neo ')).toBe('neo')
    expect(cleanHandle('@@ neo')).toBe('neo')
  })

  test('checked before anything is sent', () => {
    for (const bad of ['-x', 'a_b', 'a.b', '~x', 'a'.repeat(40)]) expect(handleProblem(bad, ana, people)).toBe('invalid')
    expect(handleProblem('ana', ana, people)).toBe('same')
    // someone's handle now, case aside, is taken; a login they moved off isn't
    expect(handleProblem('Robert', ana, people)).toBe('taken')
    expect(handleProblem('bob', ana, people)).toBeNull()
    // a change of case of your own is fine, and so is going back to your login
    expect(handleProblem('Ana', ana, people)).toBeNull()
    expect(handleProblem('bob', bob, people)).toBeNull()
  })
})

describe('changing your handle', () => {
  beforeEach(() => {
    seed({ me: 'ana', people: ['bob'], teams: [{ key: 'ENG', name: 'Engineering', members: ['ana'] }] })
    useData.setState((s) => ({ people: { ...s.people, bob: { ...s.people.bob, handle: 'robert' } } }))
  })
  afterEach(() => stopWrites())

  test('says what is wrong without sending anything', async () => {
    await expect(changeHandle('a_b')).rejects.toThrow(HANDLE_WORDS.invalid)
    await expect(changeHandle(' @ROBERT')).rejects.toThrow(HANDLE_WORDS.taken('ROBERT'))
    expect(await changeHandle(' @ana ')).toBeUndefined()
  })
})
