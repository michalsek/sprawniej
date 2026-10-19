import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { stopWrites } from '@/backend/writes'
import { renameMe } from '@/data/actions'
import { useData } from '@/data/store'
import { profileIdOf, seed, type World } from './support/fakeBackend'

let w: World
beforeEach(() => {
  w = seed({ me: 'darekk' })
})
afterEach(() => stopWrites())

const mine = () => useData.getState().people.darekk

describe('your name', () => {
  test('a name you type is tidied, shows at once and is saved as set here', async () => {
    renameMe('  Dariusz   Smith ')
    expect(mine()).toMatchObject({ name: 'Dariusz Smith', nameSetHere: true })
    await w.settle()
    expect(w.db.sent()).toEqual([{ kind: 'update', table: 'profiles', fields: { name: 'Dariusz Smith', name_set_here: true }, keys: [{ id: profileIdOf('darekk') }] }])
    expect(w.db.get('profiles', { id: profileIdOf('darekk') })).toMatchObject({ name: 'Dariusz Smith', name_set_here: true })
  })

  test('empty, or the name you have, changes nothing', async () => {
    renameMe('   ')
    renameMe(mine().name)
    await w.settle()
    expect(w.db.sent()).toEqual([])
  })
})
