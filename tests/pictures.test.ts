import { describe, expect, spyOn, test } from 'bun:test'
import { create } from 'zustand'
import {
  DAY,
  FAILED_RETRY,
  isAlreadyThere,
  makePictures,
  MISSING_RETRY,
  PictureError,
  pictureProblem,
  type PictureDeps,
  type PicturesState,
} from '@/backend/pictures'
import { PICTURE_MESSAGES } from '@/data/actions'
import { assetName, assetUrl, pictureName } from '@/data/assets'

// a 1x1 PNG (as in tests/db/storage.test.ts)
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) =>
  c.charCodeAt(0),
)
const png = () => new Blob([PNG], { type: 'image/png' })

/** pretend storage, a clock that moves only when told, and timers that run when the test says */
function setup(answer: (paths: string[], n: number) => { path: string; url: string | null }[] | Error = (ps, n) => ps.map((path) => ({ path, url: `signed:${path}:${n}` }))) {
  let t = 1_000_000
  let signs = 0
  const timers: (() => void)[] = []
  const signed: string[][] = []
  const uploads: string[] = []
  const revoked: string[] = []
  let uploadAnswer: () => Promise<'added' | 'there'> = async () => 'added'
  let online: (() => void) | undefined
  const deps: PictureDeps = {
    sign: async (paths) => {
      signs++
      signed.push(paths)
      const a = answer(paths, signs)
      if (a instanceof Error) throw a
      return a
    },
    upload: (path) => {
      uploads.push(path)
      return uploadAnswer()
    },
    now: () => t,
    later: (fn) => void timers.push(fn),
    objectUrl: () => `blob:${uploads.length}`,
    revokeUrl: (u) => void revoked.push(u),
    onOnline: (fn) => {
      online = fn
    },
  }
  const store = create<PicturesState>()(() => ({ entries: {} }))
  const p = makePictures(deps, store)
  return {
    p,
    store,
    signed,
    uploads,
    revoked,
    /** run the waiting timers, and let the answers come */
    tick: async () => {
      for (const fn of timers.splice(0)) fn()
      await Bun.sleep(0)
    },
    pass: (ms: number) => {
      t += ms
    },
    now: () => t,
    answerUploads: (fn: () => Promise<'added' | 'there'>) => {
      uploadAnswer = fn
    },
    online: () => online?.(),
  }
}

describe('picture names', () => {
  test('workspace pictures are found by their short address; other addresses stay as they are', () => {
    expect(assetName('/assets/ab12.png')).toBe('ab12.png')
    expect(assetName('assets/ab12.png')).toBe('ab12.png')
    expect(assetName('https://uploads.linear.app/x.png')).toBeNull()
    expect(assetName('/assets/../x.png')).toBeNull()
    expect(assetName('/assets/x.svg')).toBeNull()
    expect(assetUrl('https://uploads.linear.app/x.png')).toBe('https://uploads.linear.app/x.png')
    expect(assetUrl(undefined)).toBeUndefined()
  })

  test('the name comes from the bytes, so the same picture always has the same name', async () => {
    expect(await pictureName(png())).toBe('497790947d4666760ce38f3c.png')
    expect(await pictureName(png())).toBe(await pictureName(new Blob([PNG], { type: 'image/png' })))
    expect(await pictureName(new Blob([PNG], { type: 'image/jpeg' }))).toBe('497790947d4666760ce38f3c.jpg')
    expect(await pictureName(new Blob(['hi'], { type: 'text/plain' }))).toBeNull()
  })
})

describe('showing pictures', () => {
  test('pictures wanted together are asked for in one go, and asking never changes anything at once', async () => {
    const s = setup()
    let heard = 0
    s.store.subscribe(() => heard++)
    expect(s.p.url('w/a.png')).toBeUndefined()
    expect(s.p.url('w/b.png')).toBeUndefined()
    expect(heard).toBe(0)
    await s.tick()
    expect(s.signed).toEqual([['w/a.png', 'w/b.png']])
    expect(heard).toBeGreaterThan(0)
    expect(s.store.getState().entries['w/a.png']).toMatchObject({ state: 'ready', url: 'signed:w/a.png:1' })
    expect(s.p.url('w/a.png')).toBe('signed:w/a.png:1')
    await s.tick()
    expect(s.signed).toHaveLength(1)
  })

  test('an address about to stop working is still used while a fresh one is asked for', async () => {
    const s = setup()
    s.p.url('w/a.png')
    await s.tick()
    s.pass(DAY * 1000 - 30 * 60_000)
    expect(s.p.url('w/a.png')).toBe('signed:w/a.png:1')
    await s.tick()
    expect(s.signed).toHaveLength(2)
    expect(s.p.url('w/a.png')).toBe('signed:w/a.png:2')
    await s.tick()
    expect(s.signed).toHaveLength(2)
  })

  test('a picture that is not there is asked for again only after a while', async () => {
    const s = setup((ps) => ps.map((path) => ({ path, url: null })))
    s.p.url('w/gone.png')
    await s.tick()
    expect(s.store.getState().entries['w/gone.png']?.state).toBe('missing')
    s.pass(MISSING_RETRY - 1000)
    s.p.url('w/gone.png')
    await s.tick()
    expect(s.signed).toHaveLength(1)
    s.pass(2000)
    s.p.url('w/gone.png')
    await s.tick()
    expect(s.signed).toHaveLength(2)
  })

  test('asking failed: tried again after a moment, or as soon as the browser is back online', async () => {
    let fail = true
    const s = setup((ps) => (fail ? new Error('offline') : ps.map((path) => ({ path, url: `ok:${path}` }))))
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    s.p.url('w/a.png')
    await s.tick()
    expect(s.store.getState().entries['w/a.png']?.state).toBe('failed')
    s.p.url('w/a.png')
    await s.tick()
    expect(s.signed).toHaveLength(1)
    s.pass(FAILED_RETRY)
    fail = false
    s.p.url('w/a.png')
    await s.tick()
    expect(s.p.url('w/a.png')).toBe('ok:w/a.png')

    fail = true
    s.p.url('w/b.png')
    await s.tick()
    fail = false
    s.online()
    await s.tick()
    expect(s.p.url('w/b.png')).toBe('ok:w/b.png')
    warn.mockRestore()
  })
})

describe('adding pictures', () => {
  test('a picture is kept once, however often it is pasted, and shows from your own copy', async () => {
    const s = setup()
    await s.p.add('w/a.png', png())
    await s.p.add('w/a.png', png())
    expect(s.uploads).toEqual(['w/a.png'])
    expect(s.store.getState().entries['w/a.png']).toMatchObject({ state: 'ready', local: true, url: 'blob:1' })
    expect(s.p.url('w/a.png')).toBe('blob:1')
    await s.tick()
    expect(s.signed).toEqual([])

    let release: (v: 'there') => void = () => {}
    s.answerUploads(() => new Promise((r) => (release = r)))
    const both = Promise.all([s.p.add('w/b.png', png()), s.p.add('w/b.png', png())])
    release('there')
    await both
    expect(s.uploads).toEqual(['w/a.png', 'w/b.png'])
  })

  test('a picture already shown from its signed address is not added again', async () => {
    const s = setup()
    s.p.url('w/a.png')
    await s.tick()
    await s.p.add('w/a.png', png())
    expect(s.uploads).toEqual([])
  })

  test('what went wrong is passed on', async () => {
    const s = setup()
    s.answerUploads(() => Promise.reject(new PictureError('refused')))
    await expect(s.p.add('w/a.png', png())).rejects.toMatchObject({ kind: 'refused' })
  })

  test('the storage answers, read', () => {
    expect(isAlreadyThere({ status: 400, statusCode: '409', message: 'The resource already exists' })).toBe(true)
    expect(isAlreadyThere({ status: 409 })).toBe(true)
    expect(isAlreadyThere({ status: 413 })).toBe(false)
    expect(pictureProblem({ status: 413 })).toBe('too-big')
    expect(pictureProblem({ status: 400, statusCode: '413', message: 'The object exceeded the maximum allowed size' })).toBe('too-big')
    expect(pictureProblem({ statusCode: '415' })).toBe('wrong-type')
    expect(pictureProblem({ status: 400, statusCode: '403', message: 'new row violates row-level security policy' })).toBe('refused')
    expect(pictureProblem({ status: 401 })).toBe('signed-out')
    expect(pictureProblem({ name: 'StorageUnknownError', message: 'fetch failed' })).toBe('network')
    expect(pictureProblem({ status: 503 })).toBe('network')
  })

  test('clearing forgets everything and lets go of your own copies', async () => {
    const s = setup()
    await s.p.add('w/a.png', png())
    s.p.url('w/b.png')
    s.p.clear()
    expect(s.revoked).toEqual(['blob:1'])
    expect(s.store.getState().entries).toEqual({})
    await s.tick()
    expect(s.signed).toEqual([])
    await s.p.add('w/a.png', png())
    expect(s.uploads).toHaveLength(2)
  })

  test('what people are told says nothing technical', () => {
    for (const m of Object.values(PICTURE_MESSAGES)) {
      expect(m).not.toMatch(/storage|server|upload|database|supabase|bucket/i)
      expect(m).not.toContain(String.fromCharCode(0x2014))
    }
  })
})
