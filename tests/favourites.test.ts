import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Announcements } from '@dnd-kit/core'
import { stopWrites } from '@/backend/writes'
import { MESSAGES } from '@/backend/writes/problems'
import { addFavourite, createProject, createView, deleteProject, deleteTeam, deleteView, moveFavourite, moveFavouriteBy, removeFavourite } from '@/data/actions'
import { DEFAULT_DISPLAY } from '@/data/displays'
import { endKey, moveText, placeAt, visibleFavourites } from '@/data/favourites'
import { useData } from '@/data/store'
import type { Favourite, Project, View } from '@/model/schema'
import { drain, profileIdOf, seed, WS, type World } from './support/fakeBackend'

const fav = (id: string, sortOrder: string, kind = 'project'): Favourite => ({ id, kind, sortOrder })

describe('what shows, and where a favourite lands', () => {
  test('only favourites whose project or view is here, of a kind we know, in the order kept', () => {
    const projects = { p1: { id: 'p1' } as Project }
    const views = { v1: { id: 'v1' } as View }
    const favourites = [fav('v1', 'a0', 'view'), fav('gone', 'a1'), fav('p1', 'a2'), fav('i1', 'a3', 'issue'), fav('p1x', 'a4', 'view')]
    expect(visibleFavourites({ favourites, projects, views }).map((f) => f.id)).toEqual(['v1', 'p1'])
  })

  test('placeAt: between the new neighbours, or null when it stays', () => {
    const list = [fav('a', 'a0'), fav('b', 'a1'), fav('c', 'a2')]
    const order = (id: string, key: string) => list.map((f) => (f.id === id ? { ...f, sortOrder: key } : f)).sort((x, y) => (x.sortOrder < y.sortOrder ? -1 : 1)).map((f) => f.id)
    expect(order('c', placeAt(list, 'c', 0)!)).toEqual(['c', 'a', 'b'])
    expect(order('a', placeAt(list, 'a', 1)!)).toEqual(['b', 'a', 'c'])
    expect(order('a', placeAt(list, 'a', 2)!)).toEqual(['b', 'c', 'a'])
    expect(placeAt(list, 'b', 1)).toBeNull()
    expect(placeAt(list, 'missing', 0)).toBeNull()
    // two that share a key (made in two tabs at once): a key is still found
    expect(placeAt([fav('a', 'a0'), fav('b', 'a1'), fav('c', 'a1')], 'a', 1)).toBeString()
  })

  test('a new one goes after the last, or anywhere in an empty list', () => {
    expect(endKey([fav('a', 'a0'), fav('b', 'a5')]) > 'a5').toBe(true)
    expect(endKey([])).toBeString()
  })

  test('a screen reader hears the name and the place', () => {
    const say: Announcements = moveText([
      { id: 'a', name: 'Launch' },
      { id: 'b', name: 'Bugs' },
    ])
    const active = { id: 'a' } as Parameters<Announcements['onDragStart']>[0]['active']
    const over = { id: 'b' } as NonNullable<Parameters<Announcements['onDragOver']>[0]['over']>
    expect(say.onDragOver({ active, over })).toBe('Launch is now number 2 of 2.')
    expect(say.onDragEnd({ active, over })).toBe('Dropped Launch at number 2 of 2.')
    expect(say.onDragCancel({ active, over: null })).toBe('Launch was put back.')
  })
})

describe('starring', () => {
  let w: World
  beforeEach(() => {
    w = seed({ me: 'ana', people: ['bob'], teams: [{ key: 'ENG', name: 'Engineering', members: ['ana'] }, { key: 'DES', name: 'Design' }] })
  })
  afterEach(() => stopWrites())

  const ids = () => useData.getState().favourites.map((f) => f.id)
  const key = (item: string) => ({ profile_id: profileIdOf('ana'), item_id: item })
  const project = async (name = 'Launch') => {
    const p = createProject({ name, emoji: '🚀' })
    await w.settle()
    return p.id
  }

  test('one row of what may be sent, shown at once at the bottom; starring again sends nothing', async () => {
    const a = await project('A')
    const b = await project('B')
    const sent = w.since()
    addFavourite('project', a)
    addFavourite('project', b)
    expect(ids()).toEqual([a, b])
    await w.settle()
    const [first] = sent()
    expect(first).toMatchObject({ kind: 'insert', table: 'favourites' })
    if (first.kind !== 'insert') return
    expect(Object.keys(first.rows[0]).sort()).toEqual(['item_id', 'kind', 'profile_id', 'sort_order', 'workspace_id'])
    expect(w.db.get('favourites', key(a))).toMatchObject({ workspace_id: WS, kind: 'project' })
    const again = w.since()
    addFavourite('project', a)
    addFavourite('view', b)
    await w.settle()
    expect(again()).toEqual([])
  })

  test('starred in another tab meanwhile: still one, and nothing to say', async () => {
    const a = await project()
    w.db.put('favourites', { ...key(a), workspace_id: WS, kind: 'project', item_id: a, sort_order: 'Zz', project_id: a, view_id: null, extra: {} })
    addFavourite('project', a)
    await w.settle()
    expect(w.db.rows('favourites')).toHaveLength(1)
    expect(w.told).toEqual([])
    expect(ids()).toEqual([a])
  })

  test('a move sends only the new order; moving past either end does nothing; unstarring deletes the row', async () => {
    const [a, b, c] = [await project('A'), await project('B'), await project('C')]
    for (const id of [a, b, c]) addFavourite('project', id)
    await w.settle()
    const sent = w.since()
    moveFavourite(c, 0)
    expect(ids()).toEqual([c, a, b])
    moveFavouriteBy(c, -1)
    moveFavouriteBy(b, 1)
    await w.settle()
    expect(sent()).toEqual([{ kind: 'update', table: 'favourites', fields: { sort_order: useData.getState().favourites[0].sortOrder }, keys: [key(c)] }])
    removeFavourite(a)
    expect(ids()).toEqual([c, b])
    await w.settle()
    expect(w.db.get('favourites', key(a))).toBeUndefined()
  })

  test('a project you just made can be starred before it is saved: the star waits for it', async () => {
    w.db.hold()
    const p = createProject({ name: 'Fresh', emoji: '' })
    addFavourite('project', p.id)
    await drain()
    expect(w.db.log.map((r) => (r.kind === 'insert' ? r.table : r.kind))).toEqual(['projects'])
    await w.settle()
    expect(w.db.get('favourites', key(p.id))).toBeDefined()
    expect(w.told).toEqual([])
  })

  test('deleting a starred project, view, or the team of a starred view takes the favourite with it at once', async () => {
    const p = await project()
    const v = createView({ name: 'Mine', emoji: '', team: null, display: DEFAULT_DISPLAY })
    const tv = createView({ name: 'Design bugs', emoji: '', team: 'DES', display: DEFAULT_DISPLAY })
    await w.settle()
    addFavourite('project', p)
    addFavourite('view', v.id)
    addFavourite('view', tv.id)
    await w.settle()
    deleteProject(p)
    deleteView(v.id)
    expect(deleteTeam('DES')).toBe(true)
    expect(ids()).toEqual([])
    await w.settle()
    w.echo()
    expect(w.db.rows('favourites')).toEqual([])
    expect(ids()).toEqual([])
    expect(w.told).toEqual([])
  })

  test('starring what a teammate just deleted is undone, saying what went', async () => {
    const p = await project()
    const v = createView({ name: 'Gone soon', emoji: '', team: null, display: DEFAULT_DISPLAY })
    await w.settle()
    w.db.t('projects').delete(p)
    w.db.t('views').delete(v.id)
    addFavourite('project', p)
    await w.settle()
    addFavourite('view', v.id)
    await w.settle()
    expect(ids()).toEqual([])
    expect(w.told).toEqual([MESSAGES.goneProject, MESSAGES.goneView])
  })
})
