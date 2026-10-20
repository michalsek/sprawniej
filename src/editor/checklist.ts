/**
 * Checklist items in the editor. Ticking a box doesn't put the cursor in the text (on a phone the keyboard stays
 * away), and the tick says which item it was (`TICK`), so the editor can save just that box (Editor.tsx, onTick)
 * instead of the whole text. ⌘/Ctrl + Shift + Enter ticks the item the cursor is in.
 *
 * Typing "[ ] " (or "[x] ") at the start of a bulleted item makes it a checklist item, like it does on an empty line.
 */
import { InputRule, type Editor } from '@tiptap/core'
import { TaskItem } from '@tiptap/extension-list'
import type { Node as PMNode } from '@tiptap/pm/model'

/** the transaction's meta key for a tick */
export const TICK = 'sprawniejTick'

/** a tick: the how-manieth item (from 0, as in src/data/checklist.ts) and how it is now */
export interface TickMeta {
  index: number
  checked: boolean
}

/** how many checklist items come before the one at `pos` (an item holding it counts: it's written first) */
function itemIndex(doc: PMNode, pos: number): number {
  let n = 0
  doc.nodesBetween(0, pos, (node, at) => {
    if (node.type.name === 'taskItem' && at < pos) n++
  })
  return n
}

function tick(editor: Editor, pos: number, checked: boolean): boolean {
  const { state, view } = editor
  const node = state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'taskItem') return false
  const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked })
  tr.setMeta(TICK, { index: itemIndex(state.doc, pos), checked } satisfies TickMeta)
  view.dispatch(tr)
  return true
}

/** the box's name for screen readers: what the item itself says (its first paragraph, not the items under it) */
const labelOf = (node: PMNode) => node.firstChild?.textContent.trim() || 'Empty checklist item'

export const Checklist = TaskItem.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      'Mod-Shift-Enter': () => {
        const { $from } = this.editor.state.selection
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d)
          if (node.type.name === 'taskItem') return tick(this.editor, $from.before(d), !node.attrs.checked)
        }
        return false
      },
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\s*(\[([ xX])?\])\s$/,
        handler: ({ state, range, match, chain }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.depth < 2 || $from.node(-1).type.name !== 'listItem') return null
          chain()
            .deleteRange(range)
            .toggleList('taskList', 'taskItem')
            .updateAttributes('taskItem', { checked: /x/i.test(match[2] ?? '') })
            .run()
        },
      }),
      ...(this.parent?.() ?? []),
    ]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const li = document.createElement('li')
      const label = document.createElement('label')
      const box = document.createElement('input')
      const content = document.createElement('div')
      label.contentEditable = 'false'
      box.type = 'checkbox'
      // a click on the box never moves the cursor (or opens the keyboard)
      box.addEventListener('mousedown', (e) => e.preventDefault())
      box.addEventListener('change', () => {
        const pos = getPos()
        if (typeof pos !== 'number' || !editor.isEditable || !tick(editor, pos, box.checked)) box.checked = !box.checked
      })
      label.append(box)
      li.append(label, content)
      li.dataset.type = 'taskItem'
      const draw = (n: PMNode) => {
        li.dataset.checked = String(n.attrs.checked)
        box.checked = n.attrs.checked
        box.setAttribute('aria-label', labelOf(n))
      }
      draw(node)
      return {
        dom: li,
        contentDOM: content,
        update: (next) => {
          if (next.type !== node.type) return false
          draw(next)
          return true
        },
        // the box is ours: the editor leaves its clicks and taps alone
        stopEvent: (e) => e.target === box,
        ignoreMutation: (m) => m.type !== 'selection' && !content.contains(m.target),
      }
    }
  },
})
