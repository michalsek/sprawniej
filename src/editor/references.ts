/**
 * @people and ENG-12 references. They stay plain text in the Markdown, so they read well anywhere; in the editor we only highlight the ones that point at a real person or issue, and clicking an issue
 * reference opens it. A person counts by the @handle they have now (src/data/mentions.ts), so the highlights are drawn
 * again when someone changes theirs.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ISSUE_REF as ISSUE, MENTION, resolveHandle } from '@/data/mentions'
import { findByRef, useData } from '@/data/store'

function decorate(doc: PMNode): DecorationSet {
  const { people, issues } = useData.getState()
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    if (node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return
    for (const m of node.text.matchAll(MENTION)) {
      const login = resolveHandle(m[2], people)
      if (!login) continue
      const from = pos + m.index! + m[1].length
      decos.push(Decoration.inline(from, from + m[2].length + 1, { class: 'mention', title: people[login].name }))
    }
    for (const m of node.text.matchAll(ISSUE)) {
      const issue = findByRef(issues, m[1])
      if (!issue) continue
      const from = pos + m.index!
      decos.push(Decoration.inline(from, from + m[1].length, { class: 'issue-ref', 'data-issue-ref': m[1], title: issue.title }))
    }
  })
  return DecorationSet.create(doc, decos)
}

const key = new PluginKey<DecorationSet>('sprawniej-references')

export const References = Extension.create({
  name: 'references',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? decorate(tr.doc) : old),
        },
        // someone's handle or name changed: draw the highlights again
        view: (view) => ({
          destroy: useData.subscribe((s, prev) => {
            if (s.people !== prev.people && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true))
          }),
        }),
        props: {
          decorations: (state) => key.getState(state),
          handleClick: (_view, _pos, event) => {
            const target = event.target as HTMLElement
            const ref = target.closest('[data-issue-ref]')?.getAttribute('data-issue-ref')
            if (ref && (event.metaKey || event.ctrlKey || !(_view.editable))) {
              location.hash = `#/issue/${ref}`
              return true
            }
            const link = target.closest('a[href]') as HTMLAnchorElement | null
            if (link && (event.metaKey || event.ctrlKey)) {
              window.open(link.href, '_blank', 'noopener')
              return true
            }
            return false
          },
        },
      }),
    ]
  },
})
