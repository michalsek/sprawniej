import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { create } from 'zustand'
import { useBackend } from '@/backend'
import {
  CHUNK,
  FAILED_RETRY,
  isAlreadyThere,
  makePictures,
  MISSING_RETRY,
  PictureError,
  pictureProblem,
  pictures,
  RESIGN_BEFORE,
  SIGNED_FOR_S,
  type PictureDeps,
  type PicturesState,
} from '@/backend/pictures'
import { addImage, PICTURE_MESSAGES } from '@/data/actions'
import { assetName, pictureName } from '@/data/assets'

// a 1x1 PNG (as in tests/db/storage.test.ts)
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) =>
  c.charCodeAt(0),
)
const png = () => new Blob([PNG], { type: 'image/png' })
const DAY_MS = SIGNED_FOR_S * 1000

type Answer = (paths: string[], n: number) => { path: string; url: string | null }[] | Error

/** pretend storage, a clock that moves only when told, and timers that run when the test says */
function setup(answer: Answer = (ps, n) => ps.map((path) => ({ path, url: `signed:${path}:${n}` }))) {
  let t = 1_000_000
  let signs = 0
  let answerNow = answer
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
      const a = answerNow(paths, signs)
      if (a instanceof Error) throw a
      return a
    },
    upload: (path) => {
      uploads.push(path)
      return uploadAnswer()
    },
    now: () => t,
    later: (fn) => void timers.push(fn),
    objectUrl: () => `blob:${uploads.length + 1}`,
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
    timers,
    /** run the waiting timers, and let the answers come */
    tick: async () => {
      for (const fn of timers.splice(0)) fn()
      await Bun.sleep(0)
    },
    pass: (ms: number) => {
      t += ms
    },
    now: () => t,
    answer: (a: Answer) => {
      answerNow = a
    },
    answerUploads: (fn: () => Promise<'added' | 'there'>) => {
      uploadAnswer = fn
    },
    online: () => online?.(),
  }
}

/** console.warn quiet for one test, put back however it ends */
async function quietly(fn: () => Promise<void>) {
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await fn()
  } finally {
    warn.mockRestore()
  }
}
const failing = () => new Error('offline')

describe('picture names', () => {
  test('workspace pictures are found by their short address; other addresses are not', () => {
    expect(assetName('/assets/ab12.png')).toBe('ab12.png')
    expect(assetName('assets/ab12.png')).toBe('ab12.png')
    expect(assetName('https://uploads.linear.app/x.png')).toBeNull()
    expect(assetName('/assets/../x.png')).toBeNull()
    expect(assetName('/assets/x.svg')).toBeNull()
  })

  test('the name comes from the bytes, so the same picture always has the same name', async () => {
    expect(await pictureName(png(), 'png')).toBe('497790947d4666760ce38f3c.png')
    expect(await pictureName(new Blob([PNG], { type: 'image/jpeg' }), 'jpg')).toBe('497790947d4666760ce38f3c.jpg')
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
    expect(s.p.url('w/a.png')).toBe('signed:w/a.png:1')
    await s.tick()
    expect(s.signed).toHaveLength(1)
  })

  test('more than a hundred at once are asked for a hundred at a time', async () => {
    const s = setup()
    const paths = Array.from({ length: CHUNK + 5 }, (_, i) => `w/${i}.png`)
    for (const p of paths) s.p.url(p)
    await s.tick()
    await Bun.sleep(0)
    expect(s.signed.map((c) => c.length)).toEqual([CHUNK, 5])
    expect(paths.every((p) => s.p.url(p))).toBe(true)
  })

  test('an address about to stop working is still used while a fresh one is asked for; a used-up one never is', async () => {
    const s = setup()
    s.p.url('w/a.png')
    await s.tick()
    s.pass(DAY_MS - 30 * 60_000)
    expect(s.p.nextCheck('w/a.png')).toBe(s.now() + 30 * 60_000)
    expect(s.p.url('w/a.png')).toBe('signed:w/a.png:1')
    await s.tick()
    expect(s.p.url('w/a.png')).toBe('signed:w/a.png:2')

    await quietly(async () => {
      s.answer(failing)
      s.pass(DAY_MS - RESIGN_BEFORE / 2)
      s.p.url('w/a.png')
      await s.tick()
      // signing again failed: the address shown stays while it works
      expect(s.store.getState().entries['w/a.png']).toMatchObject({ state: 'ready', url: 'signed:w/a.png:2' })
      s.pass(RESIGN_BEFORE)
      expect(s.p.url('w/a.png')).toBeUndefined()
    })
  })

  test('a failed signing again is not tried in a loop, even by something that asks on every change', async () => {
    const s = setup()
    s.p.url('w/a.png')
    await s.tick()
    s.answer(failing)
    s.pass(DAY_MS - RESIGN_BEFORE / 2)
    await quietly(async () => {
      s.store.subscribe(() => void s.p.url('w/a.png'))
      s.p.url('w/a.png')
      for (let i = 0; i < 5; i++) await s.tick()
      expect(s.signed).toHaveLength(2)
      expect(s.p.nextCheck('w/a.png')).toBe(s.now() + FAILED_RETRY)
      s.pass(FAILED_RETRY)
      s.p.url('w/a.png')
      for (let i = 0; i < 5; i++) await s.tick()
      expect(s.signed).toHaveLength(3)
    })
  })

  test('a picture that is not there is asked for again only after a while', async () => {
    const s = setup((ps) => ps.map((path) => ({ path, url: null })))
    s.p.url('w/gone.png')
    await s.tick()
    expect(s.store.getState().entries['w/gone.png']?.state).toBe('missing')
    expect(s.p.nextCheck('w/gone.png')).toBe(s.now() + MISSING_RETRY)
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
    const s = setup((ps) => (fail ? failing() : ps.map((path) => ({ path, url: `ok:${path}` }))))
    await quietly(async () => {
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
    })
  })
})

describe('adding pictures', () => {
  test('a picture is kept once, however often it is pasted, and shows from your own copy at once', async () => {
    const s = setup()
    let release: (v: 'added') => void = () => {}
    s.answerUploads(() => new Promise((r) => (release = r)))
    const first = s.p.add('w/a.png', png())
    expect(s.p.url('w/a.png')).toBe('blob:1')
    const again = s.p.add('w/a.png', png())
    release('added')
    await Promise.all([first, again])
    await s.p.add('w/a.png', png())
    expect(s.uploads).toEqual(['w/a.png'])
    expect(s.store.getState().entries['w/a.png']).toMatchObject({ state: 'ready', local: true })
    await s.tick()
    expect(s.signed).toEqual([])
  })

  test('already kept ("there") is fine; one shown from its signed address is not added again', async () => {
    const s = setup()
    s.answerUploads(async () => 'there')
    await s.p.add('w/b.png', png())
    s.p.url('w/a.png')
    await s.tick()
    await s.p.add('w/a.png', png())
    expect(s.uploads).toEqual(['w/b.png'])
  })

  test('one that can’t be kept: the reason is passed on, and its preview goes', async () => {
    const s = setup()
    s.answerUploads(() => Promise.reject(new PictureError('refused')))
    await expect(s.p.add('w/a.png', png())).rejects.toMatchObject({ kind: 'refused' })
    expect(s.store.getState().entries['w/a.png']).toBeUndefined()
    expect(s.revoked).toEqual(['blob:1'])
  })

  test('clearing forgets everything, lets go of your own copies, and late answers count for nothing', async () => {
    const s = setup()
    await s.p.add('w/a.png', png())
    s.p.url('w/b.png')
    s.p.clear()
    expect(s.revoked).toEqual(['blob:1'])
    expect(s.store.getState().entries).toEqual({})
    await s.tick()
    expect(s.signed).toEqual([])

    s.p.url('w/c.png')
    for (const fn of s.timers.splice(0)) fn()
    s.p.clear()
    await Bun.sleep(0)
    expect(s.store.getState().entries).toEqual({})
    await s.p.add('w/a.png', png())
    expect(s.uploads).toHaveLength(2)
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
})

describe('addImage', () => {
  afterEach(() => {
    useBackend.setState({ phase: 'closed', workspaceId: undefined })
    pictures.clear()
  })
  const open = () => useBackend.setState({ phase: 'open', workspaceId: 'ws1' })

  test('says which pictures can be added, before anything is sent', async () => {
    open()
    const add = spyOn(pictures, 'add')
    try {
      await expect(addImage(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).rejects.toThrow(PICTURE_MESSAGES['wrong-type'])
      await expect(addImage(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' }))).rejects.toThrow(PICTURE_MESSAGES['too-big'])
      useBackend.setState({ phase: 'opening' })
      await expect(addImage(png())).rejects.toThrow('once your workspace is open')
      expect(add).not.toHaveBeenCalled()
    } finally {
      add.mockRestore()
    }
  })

  test('names it, shows it at once, keeps it under the workspace and returns its short address', async () => {
    open()
    const add = spyOn(pictures, 'add').mockImplementation(async () => {})
    const named: string[] = []
    try {
      expect(await addImage(png(), (src) => named.push(src))).toBe('/assets/497790947d4666760ce38f3c.png')
      expect(named).toEqual(['/assets/497790947d4666760ce38f3c.png'])
      expect(add.mock.calls[0][0]).toBe('ws1/497790947d4666760ce38f3c.png')
    } finally {
      add.mockRestore()
    }
  })

  test('what went wrong, in words for people', async () => {
    open()
    const add = spyOn(pictures, 'add')
    try {
      add.mockImplementation(() => Promise.reject(new PictureError('signed-out')))
      await expect(addImage(png())).rejects.toThrow(PICTURE_MESSAGES['signed-out'])
      add.mockImplementation(() => Promise.reject(new Error('boom')))
      await expect(addImage(png())).rejects.toThrow(PICTURE_MESSAGES.network)
    } finally {
      add.mockRestore()
    }
    for (const m of Object.values(PICTURE_MESSAGES)) {
      expect(m).not.toMatch(/storage|server|upload|database|supabase|bucket/i)
      expect(m).not.toContain(String.fromCharCode(0x2014))
    }
  })
})
