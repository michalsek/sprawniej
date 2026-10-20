/**
 * When typing "/" opens the list of what you can add (SlashMenu.tsx), and what it finds. Plain functions, so the
 * rules are tested (tests/slashMenu.test.ts): ordinary text with a slash in it ("and/or", "and / or", "1 / 2", a
 * link) never opens it, so Enter there is always a new line.
 */
import { plain } from '@/lib/plain'

/** something the list offers: found by its title, or (one word only) by its other words too */
export interface Findable {
  title: string
  /** more words it's found by */
  also?: string
}

/**
 * The "/" that starts a command in the text before the cursor, and what was typed after it. None when the slash is
 * inside a word or a link ("and/or", "https://x/y") or a space follows it ("and / or").
 */
export function slashTrigger(textBefore: string): { at: number; query: string } | null {
  const at = textBefore.lastIndexOf('/')
  if (at < 0 || (at > 0 && !/\s/.test(textBefore[at - 1]))) return null
  const query = textBefore.slice(at + 1)
  return /^\s/.test(query) ? null : { at, query }
}

/**
 * What the typed words find. One word: every item one of whose words starts with it ("/num", "/list", "/todo"; an
 * empty list stays open while you correct a typo). More words: only items whose title starts with them ("heading 2",
 * "add a line"); none means it was just a slash in a sentence, and the list closes (null).
 */
export function slashMatches<T extends Findable>(query: string, items: readonly T[]): T[] | null {
  const q = plain(query).replace(/\s+/g, ' ')
  if (!q.includes(' ')) return items.filter((i) => plain(`${i.title} ${i.also ?? ''}`).split(/\s+/).some((w) => w.startsWith(q)))
  const found = items.filter((i) => plain(i.title).startsWith(q))
  return found.length ? found : null
}
