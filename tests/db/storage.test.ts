import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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
