import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { supabasePictureDeps } from '@/backend/pictures'
import { closeChannels, enabled, getWorld, newWorkspace, ok, type Someone, type World } from './support'

// a 1x1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) =>
  c.charCodeAt(0),
)

describe.skipIf(!enabled)('pictures', () => {
  let w: World
  let path: string
  beforeAll(async () => {
    w = await getWorld()
    path = `${w.ws}/${crypto.randomUUID().replaceAll('-', '')}.png`
  }, 60_000)
  afterAll(closeChannels)

  const upload = (who: Someone, to: string, type = 'image/png') =>
    who.db.storage.from('pictures').upload(to, new Blob([PNG], { type }), { contentType: type, upsert: false })

  test('members add pictures to their workspace and see them', async () => {
    await ok(upload(w.bob, path))
    const signed = await ok(w.bob.db.storage.from('pictures').createSignedUrl(path, 60))
    expect(signed.signedUrl).toContain('/pictures/')
    const again = await upload(w.ana, path)
    expect(again.error).not.toBeNull()   // already there: the name is the hash, so that's fine for the app
  })

  test("the app's adding and signing", async () => {
    const deps = supabasePictureDeps(() => w.bob.db)
    const mine = `${w.ws}/${crypto.randomUUID().replaceAll('-', '')}.png`
    expect(await deps.upload(mine, new Blob([PNG], { type: 'image/png' }))).toBe('added')
    expect(await deps.upload(mine, new Blob([PNG], { type: 'image/png' }))).toBe('there')
    const signed = await deps.sign([mine, `${w.ws}/nothere.png`])
    expect(signed).toHaveLength(2)
    expect(signed[0]).toMatchObject({ path: mine })
    expect(signed[0].url).toContain(`/storage/v1/object/sign/pictures/${mine}`)
    expect(signed[1]).toEqual({ path: `${w.ws}/nothere.png`, url: null })
    const res = await fetch(signed[0].url!)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    // kept with a long cache time (the signed answer itself sends no cache-control on this project, only expires and etag)
    expect(res.headers.get('etag')).toBeTruthy()
    const listed = await ok(w.bob.db.storage.from('pictures').list(w.ws, { search: mine.split('/')[1] }))
    expect(listed.map((o) => o.metadata?.cacheControl)).toEqual(['max-age=31536000'])
    // someone outside the workspace gets no address
    const theirs = await supabasePictureDeps(() => w.cy.db)
      .sign([mine])
      .catch(() => null)
    expect(theirs === null || theirs[0].url === null).toBe(true)
    // nor can they add one there
    await expect(supabasePictureDeps(() => w.cy.db).upload(`${w.ws}/cy2.png`, new Blob([PNG], { type: 'image/png' }))).rejects.toMatchObject({ kind: 'refused' })
  })

  test('nobody else sees them or adds to other workspaces', async () => {
    expect((await w.cy.db.storage.from('pictures').createSignedUrl(path, 60)).error).not.toBeNull()
    expect((await w.cy.db.storage.from('pictures').download(path)).error).not.toBeNull()
    expect((await upload(w.cy, `${w.ws}/cy.png`)).error).not.toBeNull()
    const elsewhere = await newWorkspace(w.ana, 'pictures')
    expect((await upload(w.bob, `${elsewhere.ws}/bob.png`)).error).not.toBeNull()
    const odd = await upload(w.bob, 'not-a-uuid/x.png')
    expect(odd.error).not.toBeNull()
    expect(odd.error?.status).toBeGreaterThanOrEqual(400)
    expect(odd.error?.status).toBeLessThan(500)
    expect((await upload(w.bob, `${w.ws}/notes.txt`, 'text/plain')).error).not.toBeNull()
  })
})
