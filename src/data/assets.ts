/**
 * Pictures pasted into descriptions and comments are written as `![name](/assets/<name>)` in the Markdown, where the
 * name comes from the picture's own bytes. They are kept with the workspace (src/backend/pictures.ts) and shown from
 * an address that only works for a while, so the Markdown keeps the short form and screens ask here what to load.
 */
import { useEffect } from 'react'
import { useBackend } from '@/backend'
import { pictures, usePictures } from '@/backend/pictures'

/** the kinds of pictures that can be added, and the ending their name gets */
export const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
export const MAX_IMAGE_MB = 10

/** "/assets/<hash>.png" or "assets/<hash>.png" → "<hash>.png"; anything else → null (other addresses stay as they are) */
export function assetName(src: string): string | null {
  return /^\/?assets\/[\w-]+\.(png|jpg|gif|webp)$/.test(src) ? src.replace(/^\/?assets\//, '') : null
}

/** the name a picture is kept under: the first 24 hex digits of its SHA-256 and its ending; null for kinds we don't keep */
export async function pictureName(file: Blob): Promise<string | null> {
  const ext = IMAGE_TYPES[file.type]
  if (!ext) return null
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 24)}.${ext}`
}

/** where a workspace picture is kept, while a workspace is open */
function picturePath(name: string): string | undefined {
  const ws = useBackend.getState().workspaceId
  return ws ? `${ws}/${name}` : undefined
}

/** what an <img> should load: a signed address for workspace pictures (undefined until it's here), the address itself for others */
export function assetUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined
  const name = assetName(src)
  if (!name) return src
  const path = picturePath(name)
  return path ? pictures.url(path) : undefined
}

/** the same, for a screen: it redraws when the picture arrives. `missing`: it isn't there (or can't be shown) */
export function usePictureUrl(src: string | undefined): { url?: string; missing: boolean } {
  const name = src ? assetName(src) : null
  const ws = useBackend((s) => s.workspaceId)
  const path = name && ws ? `${ws}/${name}` : undefined
  const entry = usePictures((s) => (path ? s.entries[path] : undefined))
  // asking for it changes the store later, so it happens after drawing
  useEffect(() => {
    if (path) pictures.url(path)
  }, [path, entry])
  if (!name) return { url: src, missing: false }
  if (entry?.state === 'ready') return { url: entry.url, missing: false }
  return { missing: entry?.state === 'missing' }
}

/** calls `fn` whenever any picture arrives or changes (the editor redraws its pictures) */
export function onPicturesChange(fn: () => void): () => void {
  return usePictures.subscribe(fn)
}
