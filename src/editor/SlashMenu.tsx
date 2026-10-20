/**
 * Type / at the start of a line (or after a space) for a list of what you can add: a checklist, headings, lists, a
 * quote, code, a table, a divider. Keep typing to narrow it ("/tab" finds Table). Inside a table it also adds and
 * removes rows and columns. Not in the middle of a word ("and/or"), in a link or in code.
 */
import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Rows3,
  Table,
  Columns3,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { plain } from '@/lib/plain'
import { CommandList, type CommandListHandle } from './CommandList'

export interface SlashItem {
  title: string
  /** more words it's found by */
  also?: string
  /** what you could type instead */
  hint?: string
  icon: LucideIcon
  run: (editor: Editor, range: Range) => void
  /** only inside a table */
  inTable?: boolean
}

const go = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range)

const ITEMS: SlashItem[] = [
  { title: 'Checklist', also: 'todo task box tick', hint: '[]', icon: ListChecks, run: (e, r) => go(e, r).toggleTaskList().run() },
  { title: 'Heading 1', also: 'h1 title big', hint: '#', icon: Heading1, run: (e, r) => go(e, r).setHeading({ level: 1 }).run() },
  { title: 'Heading 2', also: 'h2 subtitle', hint: '##', icon: Heading2, run: (e, r) => go(e, r).setHeading({ level: 2 }).run() },
  { title: 'Heading 3', also: 'h3 small', hint: '###', icon: Heading3, run: (e, r) => go(e, r).setHeading({ level: 3 }).run() },
  { title: 'Bulleted list', also: 'bullets points', hint: '-', icon: List, run: (e, r) => go(e, r).toggleBulletList().run() },
  { title: 'Numbered list', also: 'ordered steps', hint: '1.', icon: ListOrdered, run: (e, r) => go(e, r).toggleOrderedList().run() },
  { title: 'Quote', also: 'citation', hint: '>', icon: Quote, run: (e, r) => go(e, r).toggleBlockquote().run() },
  { title: 'Code block', also: 'snippet', hint: '```', icon: Code, run: (e, r) => go(e, r).toggleCodeBlock().run() },
  { title: 'Table', also: 'grid columns rows', icon: Table, run: (e, r) => go(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Divider', also: 'line separator rule', hint: '---', icon: Minus, run: (e, r) => go(e, r).setHorizontalRule().run() },
  { title: 'Add a row below', also: 'table', icon: BetweenHorizontalEnd, inTable: true, run: (e, r) => go(e, r).addRowAfter().run() },
  { title: 'Add a column to the right', also: 'table', icon: BetweenVerticalEnd, inTable: true, run: (e, r) => go(e, r).addColumnAfter().run() },
  { title: 'Remove this row', also: 'table delete', icon: Rows3, inTable: true, run: (e, r) => go(e, r).deleteRow().run() },
  { title: 'Remove this column', also: 'table delete', icon: Columns3, inTable: true, run: (e, r) => go(e, r).deleteColumn().run() },
  { title: 'Remove the table', also: 'delete', icon: Trash2, inTable: true, run: (e, r) => go(e, r).deleteTable().run() },
]

/** what fits here, narrowed by what was typed after the / (any word's start: "/num", "/list") */
export function slashItems(query: string, inTable: boolean): SlashItem[] {
  const q = plain(query.trim())
  // a cell holds one line of text: in a table, only the table's own commands
  return ITEMS.filter((i) => !!i.inTable === inTable && (!q || plain(`${i.title} ${i.also ?? ''}`).split(/\s+/).some((w) => w.startsWith(q))))
}

/** under the cursor, inside the screen (above the line when there's no room below) */
function place(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return
  const view = window.visualViewport
  const width = view?.width ?? window.innerWidth
  const height = view?.height ?? window.innerHeight
  el.style.position = 'fixed'
  el.style.zIndex = '60'
  const box = { width: el.offsetWidth || 240, height: el.offsetHeight || 288 }
  el.style.left = `${Math.max(8, Math.min(rect.left, width - box.width - 8))}px`
  const below = rect.bottom + 4
  el.style.top = `${below + box.height > height - 8 && rect.top - box.height - 4 > 8 ? rect.top - box.height - 4 : below}px`
}

const inTable = (editor: Editor) => editor.isActive('table')

export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slash-menu'),
        char: '/',
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.spec.code) return false
          const { link, code } = state.schema.marks
          return !state.doc.rangeHasMark(range.from, range.to, link) && !state.doc.rangeHasMark(range.from, range.to, code)
        },
        items: ({ query, editor }) => slashItems(query, inTable(editor)),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<CommandListHandle> | null = null
          const close = () => {
            renderer?.destroy()
            renderer?.element.remove()
            renderer = null
          }
          return {
            onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
              renderer = new ReactRenderer(CommandList, { props, editor: props.editor })
              document.body.appendChild(renderer.element)
              place(renderer.element as HTMLElement, props.clientRect?.())
            },
            onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
              renderer?.updateProps(props)
              if (renderer) place(renderer.element as HTMLElement, props.clientRect?.())
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape' && renderer) {
                close()
                return true
              }
              return renderer?.ref?.onKeyDown(props.event) ?? false
            },
            onExit: close,
          }
        },
      }),
    ]
  },
})
