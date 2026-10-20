/**
 * What a description or comment can hold, and how each piece is written in Markdown: text and its formatting,
 * headings, lists, checklists, quotes, code, tables and pictures. The editor adds how it behaves on top (Editor.tsx);
 * the Markdown tests read and write with exactly these (tests/markdown.test.ts).
 */
import type { JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-list'
import { renderTableToMarkdown, Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight } from 'lowlight'
import { Checklist } from './checklist'
import { LANGUAGES } from './languages'
import { Picture } from './picture'

const lowlight = createLowlight(LANGUAGES)

/** Markdown has no room for more than one line of text in a cell: a cell holds one paragraph */
const Cell = TableCell.extend({ content: 'paragraph' })
const HeaderCell = TableHeader.extend({ content: 'paragraph' })
/** a line break in a cell is written as <br> (a cell is one line of Markdown): read it back as a line break */
function withBreaks(node: JSONContent): JSONContent {
  const content = node.content?.flatMap((child): JSONContent[] => {
    if (child.type !== 'text' || !child.text || !/<br\s*\/?>/i.test(child.text)) return [withBreaks(child)]
    return child.text.split(/<br\s*\/?>/i).flatMap((text, k) => [...(k ? [{ type: 'hardBreak' }] : []), ...(text ? [{ ...child, text }] : [])])
  })
  return content ? { ...node, content } : node
}

/** a table is a block like any other: one blank line before and after it, not two */
const MarkdownTable = Table.extend({
  parseMarkdown(token, h) {
    return withBreaks(this.parent?.(token, h) as JSONContent)
  },
  renderMarkdown: (node, h) => renderTableToMarkdown(node, h).replace(/^\n+|\n+$/g, ''),
})

export const contentExtensions = () => [
  StarterKit.configure({
    codeBlock: false,
    link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' },
  }),
  CodeBlockLowlight.configure({ lowlight }),
  TaskList,
  Checklist.configure({ nested: true }),
  MarkdownTable.configure({ resizable: false, cellMinWidth: 64 }),
  TableRow,
  HeaderCell,
  Cell,
  Picture,
]
