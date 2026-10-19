/**
 * Pictures pasted into descriptions and comments are written as `![name](/assets/<name>)` in the Markdown, where the
 * name comes from the picture's own bytes. They are kept with the workspace (src/backend/pictures.ts) and shown from
 * an address that only works for a while, so the Markdown keeps the short form and screens ask here what to load.
 */
import { useEffect, useState } from 'react'
import { useBackend, type BackendState } from '@/backend'
import { pictures, usePictures } from '@/backend/pictures'

/** the kinds of pictures that can be added, and the ending their name gets */
export const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
export const MAX_IMAGE_MB = 10

/** "/assets/<hash>.png" or "assets/<hash>.png" → "<hash>.png"; anything else → null (other addresses stay as they are) */
export function assetName(src: string): string | null {
  return /^\/?assets\/[\w-]+\.(png|jpg|gif|webp)$/.test(src) ? src.replace(/^\/?assets\//, '') : null
}

/** the name a picture is kept under: the first 24 hex digits of its SHA-256, and the ending for its kind */
export async function pictureName(file: Blob, ext: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 24)}.${ext}`
}

/** where a workspace picture is kept */
export const picturePath = (workspaceId: string, name: string) => `${workspaceId}/${name}`

const openId = (s: BackendState) => (s.phase === 'open' ? s.workspaceId : undefined)
/** the open workspace, if one is open */
export const openWorkspaceId = () => openId(useBackend.getState())

/** addresses of other pictures (imported ones) that are fine to load: web addresses, and nothing that runs code */
const safe = (src: string) => /^(https?:\/\/|\/(?!\/)|blob:|data:image\/)/i.test(src.trim())

/** what a picture shows, from what's known now (never asks for anything) */
export interface PictureView {
  url?: string
  /** it isn't there, or can't be shown */
  missing: boolean
  /** a workspace picture: the path it's kept under, once a workspace is open */
  path?: string
}

function view(src: string | null | undefined, ws: string | undefined, now: number): PictureView {
  if (!src) return { missing: true }
  const name = assetName(src)
  if (!name) return safe(src) ? { url: src, missing: false } : { missing: true }
  if (!ws) return { missing: false }
  const path = picturePath(ws, name)
  const e = usePictures.getState().entries[path]
  if (e?.state === 'ready' && e.until > now) return { url: e.url, missing: false, path }
  return { missing: e?.state === 'missing', path }
}

/** asks for the picture when needed, and again when it's time (a retry, or signing again); returns the stop */
function keepFresh(path: string | undefined, redraw: () => void): () => void {
  if (!path) return () => {}
  pictures.url(path)
  const at = pictures.nextCheck(path)
  if (at === undefined) return () => {}
  const t = setTimeout(
    () => {
      pictures.url(path)
      redraw()
    },
    Math.max(1000, at - Date.now()),
  )
  return () => clearTimeout(t)
}

/** what an <img> should load right now: a signed address for workspace pictures, the address itself for safe others */
export function assetUrl(src: string | null | undefined): string | undefined {
  const v = view(src, openWorkspaceId(), Date.now())
  if (v.path) pictures.url(v.path)
  return v.url
}

/** the same, for a screen: it redraws when the picture arrives, and keeps it signed while it shows */
export function usePictureUrl(src: string | undefined): PictureView {
  const ws = useBackend(openId)
  // only this picture's entry: other pictures arriving don't redraw it
  const name = src ? assetName(src) : null
  const entry = usePictures((s) => (name && ws ? s.entries[picturePath(ws, name)] : undefined))
  // the time it was last looked at: moves on when it's time to look again (an address running out)
  const [now, setNow] = useState(() => Date.now())
  const v = view(src, ws, now)
  // asking changes the store later, so it happens after drawing
  useEffect(() => keepFresh(v.path, () => setNow(Date.now())), [v.path, entry, now])
  return v
}

/**
 * For the editor's pictures: `draw` runs now, whenever pictures arrive or change, when it's time to look again, and
 * on `redraw()` (the picture's own address changed).
 */
export function watchPicture(src: () => string | null | undefined, draw: (v: PictureView) => void): { redraw(): void; stop(): void } {
  let stopTimer = () => {}
  const run = () => {
    const v = view(src(), openWorkspaceId(), Date.now())
    draw(v)
    stopTimer()
    stopTimer = keepFresh(v.path, run)
  }
  run()
  const unsubscribe = usePictures.subscribe(run)
  return {
    redraw: run,
    stop: () => {
      unsubscribe()
      stopTimer()
    },
  }
}
