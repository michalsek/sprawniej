/**
 * Type / at the start of a line (or after a space) for a list of what you can add: a checklist, headings, lists, a
 * quote, code, a table, a divider. Keep typing to narrow it ("/tab" finds Table, "/heading 2" Heading 2). Inside a
 * table it adds and removes lines and columns instead (never more than that line or column; the whole table only with
 * "Remove the table"). When it opens and what it finds: slashMatch.ts. Never in a link or in code.
 */
import { Extension, type Editor, type Range } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { exitSuggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
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
import { CommandList, type CommandListHandle } from './CommandList'
import { slashMatches, slashTrigger, type Findable } from './slashMatch'

export interface SlashItem extends Findable {
  /** what you could type instead */
  hint?: string
  icon: LucideIcon
  /** runs once the typed "/…" is gone */
  run: (editor: Editor) => void
  /** only inside a table, and only when it fits there */
  inTable?: (t: TableHere) => boolean
}

/** the table the cursor is in */
interface TableHere {
  columns: number
  /** lines below the header */
  lines: number
  inHeader: boolean
}

const go = (editor: Editor) => editor.chain().focus()
const always = () => true

const ITEMS: SlashItem[] = [
  { title: 'Checklist', also: 'todo task box tick', hint: '[]', icon: ListChecks, run: (e) => go(e).toggleTaskList().run() },
  { title: 'Heading 1', also: 'h1 title big', hint: '#', icon: Heading1, run: (e) => go(e).setHeading({ level: 1 }).run() },
  { title: 'Heading 2', also: 'h2 subtitle', hint: '##', icon: Heading2, run: (e) => go(e).setHeading({ level: 2 }).run() },
  { title: 'Heading 3', also: 'h3 small', hint: '###', icon: Heading3, run: (e) => go(e).setHeading({ level: 3 }).run() },
  { title: 'Bulleted list', also: 'bullets points', hint: '-', icon: List, run: (e) => go(e).toggleBulletList().run() },
  { title: 'Numbered list', also: 'ordered steps', hint: '1.', icon: ListOrdered, run: (e) => go(e).toggleOrderedList().run() },
  { title: 'Quote', also: 'citation', hint: '>', icon: Quote, run: (e) => go(e).toggleBlockquote().run() },
  { title: 'Code block', also: 'snippet', hint: '```', icon: Code, run: (e) => go(e).toggleCodeBlock().run() },
  { title: 'Table', also: 'grid columns rows', icon: Table, run: (e) => go(e).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Divider', also: 'line separator rule', hint: '---', icon: Minus, run: (e) => go(e).setHorizontalRule().run() },
  { title: 'Add a line below', also: 'table row', icon: BetweenHorizontalEnd, inTable: always, run: (e) => go(e).addRowAfter().run() },
  { title: 'Add a column to the right', also: 'table', icon: BetweenVerticalEnd, inTable: always, run: (e) => go(e).addColumnAfter().run() },
  // the header line stays (a table needs one), and so do the last line and the last column
  { title: 'Remove this line', also: 'table row delete', icon: Rows3, inTable: (t) => !t.inHeader && t.lines > 1, run: (e) => go(e).deleteRow().run() },
  { title: 'Remove this column', also: 'table delete', icon: Columns3, inTable: (t) => t.columns > 1, run: (e) => go(e).deleteColumn().run() },
  { title: 'Remove the table', also: 'delete', icon: Trash2, inTable: always, run: (e) => go(e).deleteTable().run() },
]

function tableHere($from: ResolvedPos): TableHere | null {
  for (let d = $from.depth; d > 0; d--) {
    const table = $from.node(d)
    if (table.type.name !== 'table') continue
    let headers = 0
    table.forEach((line) => {
      if (line.firstChild?.type.name === 'tableHeader') headers++
    })
    return { columns: table.firstChild?.childCount ?? 0, lines: table.childCount - headers, inHeader: $from.node(d + 2)?.type.name === 'tableHeader' }
  }
  return null
}

/** what fits here: a cell holds one line of text, so in a table only the table's own commands */
function itemsHere($at: ResolvedPos): SlashItem[] {
  const table = tableHere($at)
  return ITEMS.filter((i) => (table ? !!i.inTable?.(table) : !i.inTable))
}

/** what "/query" finds here; null: it isn't a command at all */
const found = (query: string, $at: ResolvedPos) => slashMatches(query, itemsHere($at))

const sameItems = (a: readonly SlashItem[], b: readonly SlashItem[]) => a.length === b.length && a.every((x, k) => x === b[k])

/** the typed "/…" goes on its own first, so the command acts on the line or table as it really is */
function pick(editor: Editor, item: SlashItem, range: Range) {
  editor.chain().focus().deleteRange(range).run()
  item.run(editor)
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

const key = new PluginKey('slash-menu')

export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: key,
        char: '/',
        allowSpaces: true,
        findSuggestionMatch: ({ $position }) => {
          const before = $position.nodeBefore
          if (!before?.isText || !before.text) return null
          const t = slashTrigger(before.text)
          if (!t || !found(t.query, $position)) return null
          const from = $position.pos - before.text.length + t.at
          return { range: { from, to: $position.pos }, query: t.query, text: `/${t.query}` }
        },
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.spec.code) return false
          const { link, code } = state.schema.marks
          return !state.doc.rangeHasMark(range.from, range.to, link) && !state.doc.rangeHasMark(range.from, range.to, code)
        },
        items: ({ query, editor }) => found(query, editor.state.selection.$from) ?? [],
        command: ({ editor, range, props }) => pick(editor, props, range),
        render: () => {
          let renderer: ReactRenderer<CommandListHandle> | null = null
          /** the list on screen, and the editor it's for */
          let shown: SlashItem[] = []
          let editor: Editor | null = null
          const close = () => {
            renderer?.destroy()
            renderer?.element.remove()
            renderer = null
          }
          return {
            onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
              shown = props.items
              editor = props.editor
              renderer = new ReactRenderer(CommandList, { props, editor: props.editor })
              document.body.appendChild(renderer.element)
              place(renderer.element, props.clientRect?.())
            },
            onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
              // the list for what was just typed is still being worked out: keep showing the last one
              if (props.loading) return
              shown = props.items
              renderer?.updateProps(props)
              if (renderer) place(renderer.element, props.clientRect?.())
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape' && renderer) {
                close()
                exitSuggestion(props.view, key)
                return true
              }
              if ((props.event.key === 'Enter' || props.event.key === 'Tab') && editor) {
                // typed faster than the list was drawn: what runs is what the words typed find now, never the old list
                const st = key.getState(props.view.state) as { active: boolean; query: string | null; range: Range } | undefined
                const now = st?.active ? (found(st.query ?? '', props.view.state.selection.$from) ?? []) : []
                if (!now.length) return false
                const current = renderer?.ref?.current()
                pick(editor, sameItems(shown, now) && current && now.includes(current) ? current : now[0], st!.range)
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
