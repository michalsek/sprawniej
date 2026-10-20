/**
 * What a description or comment can hold, and how each piece is written in Markdown: text and its formatting,
 * headings, lists, checklists, quotes, code, tables and pictures. The editor adds how it behaves on top (Editor.tsx);
 * the Markdown tests read and write with exactly these (tests/markdown.test.ts).
 */
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
/** a table is a block like any other: one blank line before and after it, not two */
const MarkdownTable = Table.extend({
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
