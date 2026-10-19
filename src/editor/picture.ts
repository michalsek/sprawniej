/**
 * Pictures in the editor. They keep their workspace address in the Markdown and show from a signed one, which may
 * arrive a moment later: each picture redraws itself when it does.
 *
 * A pasted or dropped picture goes in at once, where it landed, and is marked `pending` until it's kept with the
 * workspace. A pending picture isn't saved: the Markdown leaves it out until it's kept, and it goes again if it can't be.
 */
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import type { Node as PMNode } from '@tiptap/pm/model'
import { assetUrl, watchPicture } from '@/data/assets'

export const Picture = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-src') ?? el.getAttribute('src'),
        renderHTML: (attrs: { src?: string | null }) => ({ src: assetUrl(attrs.src), 'data-src': attrs.src }),
      },
      /** a picture still being added (a token for finding it again); never written anywhere */
      pending: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    }
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'picture'
      const img = document.createElement('img')
      const note = document.createElement('span')
      note.className = 'text-xs text-muted-foreground'
      note.textContent = 'This picture can’t be shown.'
      dom.append(img)
      let current = node
      const src = (): string | null => current.attrs.src
      const draw = ({ url, missing }: { url?: string; missing: boolean }) => {
        if (url) {
          if (img.getAttribute('src') !== url) img.src = url
        } else img.removeAttribute('src')
        img.alt = current.attrs.alt ?? ''
        img.dataset.src = src() ?? ''
        if (current.attrs.title) img.title = current.attrs.title
        else img.removeAttribute('title')
        // a picture still on its way shows its grey space, not "can't be shown"
        const gone = missing && !current.attrs.pending && !!src()
        img.hidden = gone
        if (gone) dom.append(note)
        else note.remove()
      }
      const watch = watchPicture(src, draw)
      return {
        dom,
        update: (next) => {
          if (next.type !== current.type) return false
          current = next
          watch.redraw()
          return true
        },
        destroy: watch.stop,
      }
    }
  },
})

const isPending = (n: JSONContent) => n.type === 'image' && !!n.attrs?.pending

export function hasPending(doc: PMNode): boolean {
  let found = false
  doc.descendants((n) => {
    if (n.type.name === 'image' && n.attrs.pending) found = true
    return !found
  })
  return found
}

/** the Markdown to save: pictures still being added are left out */
export function savedMarkdown(editor: TiptapEditor): string {
  if (!hasPending(editor.state.doc) || !editor.markdown) return editor.getMarkdown()
  const strip = (n: JSONContent): JSONContent => (n.content ? { ...n, content: n.content.filter((c) => !isPending(c)).map(strip) } : n)
  return editor.markdown.serialize(strip(editor.getJSON()))
}

/** the pictures with this token: their attributes changed (`attrs`), or taken out (null) */
export function settlePicture(editor: TiptapEditor, token: string, attrs: Record<string, unknown> | null) {
  if (editor.isDestroyed) return
  const found: { pos: number; node: PMNode }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.pending === token) found.push({ pos, node })
  })
  if (!found.length) return
  const { tr } = editor.state
  // from the end, so earlier positions stay right
  for (const { pos, node } of found.reverse()) {
    if (attrs) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
    else tr.delete(pos, pos + node.nodeSize)
  }
  // undo steps over these: they finish what the paste started
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}
