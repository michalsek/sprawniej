/**
 * Reading Markdown into the editor and writing it back, without a browser: what the editor can hold
 * (src/editor/content.ts) must come back as the same Markdown, so opening and saving a description never loses or
 * changes what's in it.
 */
import { describe, expect, test } from 'bun:test'
import { getSchema, type JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { checklistItems, openable } from '@/data/checklist'
import { contentExtensions } from '@/editor/content'
import { tidyMarkdown } from '@/editor/tidy'

const manager = new MarkdownManager({ extensions: contentExtensions() })
const schema = getSchema(contentExtensions())

/** the editor's copy of a text, as it opens it */
const open = (md: string) => schema.nodeFromJSON(manager.parse(openable(md)))
/** opened and saved again, as the editor does */
const resave = (md: string) => tidyMarkdown(manager.serialize(open(md).toJSON() as JSONContent))

/** the checklist boxes the editor shows, in order */
function boxes(md: string): boolean[] {
  const out: boolean[] = []
  open(md).descendants((n) => {
    if (n.type.name === 'taskItem') out.push(n.attrs.checked as boolean)
  })
  return out
}

describe('tables', () => {
  const table = 'Plan:\n\n| Step | Who | Done |\n| :-- | --- | --: |\n| **Write** | @ana | `yes` |\n| Ship |  | no \\| maybe |\n\nAfter the table.'

  test('come back as tables, with one blank line around them, and stay the same when saved again', () => {
    const once = resave(table)
    expect(once).toBe(
      'Plan:\n\n| Step      | Who  | Done        |\n| :--------- | ---- | -----------: |\n| **Write** | @ana | `yes`       |\n| Ship      |      | no \\| maybe |\n\nAfter the table.',
    )
    expect(resave(once)).toBe(once)
  })
})

describe('checklists', () => {
  test('the editor writes them back as they were, or in its own way once', () => {
    expect(resave('- [ ] a\n- [x] b\n  - [ ] nested')).toBe('- [ ] a\n- [x] b\n  - [ ] nested')
    expect(resave('* [X] a\n* [ ] b')).toBe('- [x] a\n- [ ] b')
    expect(resave(resave('* [X] a\n* [ ] b'))).toBe('- [x] a\n- [ ] b')
  })

  test('an empty item, last or not, opens as an empty item again', () => {
    const saved = resave('- [ ] a\n- [ ] ')
    expect(saved).toBe('- [ ] a\n- [ ]')
    expect(boxes(saved)).toEqual([false, false])
    expect(boxes('- [ ]\n- [ ] b')).toEqual([false, false])
  })

  test('the boxes the editor shows are the items the text has, in the same order (a tick names its item by number)', () => {
    const texts = [
      '- [ ] a\n- [x] b\n  - [x] nested\n- [ ] c',
      '* [X] a\n+ [ ] b',
      '> - [x] quoted\n\n- [ ] after',
      '- plain\n- [ ] mixed in',
      '```\n- [ ] in code\n```\n\n- [x] real',
      '1. [ ] numbered\n\n- [ ] real',
      '| a |\n| --- |\n| - [ ] in a cell |\n\n- [ ] real',
    ]
    for (const md of texts) expect(boxes(md)).toEqual(checklistItems(md).map((i) => i.checked))
  })
})

test('quotes, headings, lists, code and struck text stay as they are', () => {
  const md = '# Title\n\n> a quote\n> more\n\n1. one\n2. two\n\n---\n\n~~old~~ and `code`\n\n```js\nconst a = 1\n```'
  expect(resave(md)).toBe(md)
})
