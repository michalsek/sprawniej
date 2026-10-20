import { describe, expect, test } from 'bun:test'
import { slashMatches, slashTrigger } from '@/editor/slashMatch'

const ITEMS = [
  { title: 'Checklist', also: 'todo task box tick' },
  { title: 'Heading 2', also: 'h2 subtitle' },
  { title: 'Numbered list', also: 'ordered steps' },
  { title: 'Add a line below', also: 'table row' },
]
/** the titles "/…" at the end of this text finds; null when it isn't a command */
const finds = (textBefore: string) => {
  const t = slashTrigger(textBefore)
  return (t && slashMatches(t.query, ITEMS)?.map((i) => i.title)) ?? null
}

describe('a slash in ordinary text is not a command', () => {
  test.each(['and / or', 'pages 1 / 2', 'either A / B', 'bug / task', '/ ', 'and/or', 'see https://x/y'])('%p', (text) => {
    expect(finds(text)).toBeNull()
  })
  test('more words that start no title close it, even when a hidden word would match', () => {
    expect(finds('/heading 2 then')).toBeNull()
    expect(finds('/todo list')).toBeNull()
  })
})

describe('what a command finds', () => {
  test('one word: the start of any of its words, also hidden ones; nothing yet stays open', () => {
    expect(finds('/')).toEqual(ITEMS.map((i) => i.title))
    expect(finds('Then /todo')).toEqual(['Checklist'])
    expect(finds('/list')).toEqual(['Numbered list'])
    expect(finds('/zz')).toEqual([])
  })
  test('more words: the start of a title, any case', () => {
    expect(finds('/heading 2')).toEqual(['Heading 2'])
    expect(finds('/Add a l')).toEqual(['Add a line below'])
  })
})
