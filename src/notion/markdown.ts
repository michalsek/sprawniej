/**
 * Notion's rich text (a list of parts, each with its own bold, italic, code and link) as the Markdown an issue's
 * description is written in (docs/notion.md). Pure, so it's unit-tested (tests/notion.test.ts). Anything in a part
 * that isn't the shape Notion sends is read as nothing.
 */

export interface RichText {
  type?: string
  plain_text?: string
  href?: string | null
  annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; code?: boolean; color?: string }
}

/** the longest description an issue gets from Notion, the link back included (notion_apply cuts there too) */
export const MAX_DESCRIPTION = 50_000

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** the first `n` characters, never half of one (an emoji is two UTF-16 units; Postgres refuses half of one) */
export const cut = (s: string, n: number): string => (s.length <= n ? s : [...s].slice(0, n).join(''))

/** the length in characters, as Postgres counts them */
const charCount = (s: string): number => [...s].length

/** one part as plain fields; a part that isn't an object is no text */
interface Run {
  text: string
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  /** an https link, or nothing */
  href: string
}

function run(p: unknown): Run {
  const r = isRecord(p) ? p : {}
  const a = isRecord(r.annotations) ? r.annotations : {}
  const href = typeof r.href === 'string' && r.href.startsWith('https://') ? r.href : ''
  return {
    text: typeof r.plain_text === 'string' ? r.plain_text : '',
    bold: a.bold === true,
    italic: a.italic === true,
    strike: a.strikethrough === true,
    code: a.code === true,
    href,
  }
}

const same = (a: Run, b: Run) => a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code && a.href === b.href

/** no HTML comes through: the editor would read it as such */
const escapeHtml = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** what `\s` matches, by character code (the code of the character at `i`) */
function isSpace(text: string, i: number): boolean {
  const c = text.charCodeAt(i)
  return (c >= 9 && c <= 13) || c === 32 || c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 ||
    c === 8239 || c === 8287 || c === 12288 || c === 65279
}

/**
 * marks and links wrap the words, not the spaces around them, or Markdown doesn't see them ("** x**"). Found by
 * walking in from both ends: a pattern for this takes seconds on a long run of spaces.
 */
function around(text: string, f: (words: string) => string): string {
  let from = 0
  let to = text.length
  while (from < to && isSpace(text, from)) from++
  while (to > from && isSpace(text, to - 1)) to--
  if (from === to) return text
  return `${text.slice(0, from)}${f(text.slice(from, to))}${text.slice(to)}`
}

const wrap = (text: string, mark: string) => around(text, (w) => `${mark}${w}${mark}`)

/** a link's address with nothing in it that would end the Markdown link */
const safeHref = (href: string) => href.replace(/[()<>\s"]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`)

/** one run of text with the same marks and link: its text with its marks, and its link */
function render(r: Run): string {
  // code shows as written, so nothing else goes inside it
  let text = r.code ? wrap(r.text.replace(/`/g, "'"), '`') : escapeHtml(r.text)
  if (r.bold) text = wrap(text, '**')
  // `*`, not `_`: it also works inside a word ("**fo**o", "*un*done")
  if (r.italic) text = wrap(text, '*')
  if (r.strike) text = wrap(text, '~~')
  if (r.href) text = around(text, (w) => `[${w.replace(/[[\]]/g, '\\$&')}](${safeHref(r.href)})`)
  return text
}

/** the parts as runs: neighbouring parts with the same marks and link are one */
function runsOf(parts: unknown): Run[] {
  const runs: Run[] = []
  for (const r of (Array.isArray(parts) ? parts : []).map(run)) {
    if (!r.text) continue
    const last = runs.at(-1)
    if (last && same(last, r)) last.text += r.text
    else runs.push(r)
  }
  return runs
}

/**
 * Rich text as Markdown. Neighbouring parts with the same marks and link are one run, so a word bold in part reads
 * right. A line break inside the text stays a line break (Markdown's two spaces), a blank line a new paragraph.
 * Mentions and equations read as their text. What someone typed as Markdown is left as they wrote it.
 */
function markdownOf(runs: Run[]): string {
  return runs
    .map(render)
    .join('')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.split('\n').map((line) => line.trimEnd()).join('  \n'))
    .join('\n\n')
    .trim()
}

/** the runs' first `n` characters (`chars`: each run's text, character by character) */
function firstChars(runs: Run[], chars: string[][], n: number): Run[] {
  const out: Run[] = []
  for (let i = 0; i < runs.length && n > 0; i++) {
    const take = chars[i].slice(0, n)
    out.push({ ...runs[i], text: take.join('') })
    n -= take.length
  }
  return out
}

/**
 * Markdown of at most `room` characters with "…" at the end. The text is cut before its marks go round it, so no
 * `**` or `` ` `` is left open: the most text that fits, found by halving.
 */
function cutMarkdown(runs: Run[], room: number): string {
  const chars = runs.map((r) => [...r.text])
  const fits = (n: number) => charCount(markdownOf(firstChars(runs, chars, n))) + 1 <= room
  let lo = 0
  // each character kept writes at least one (but spaces dropped at a line's end), so the search stops at `room`
  let hi = Math.min(room, chars.reduce((sum, c) => sum + c.length, 0))
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(mid)) lo = mid
    else hi = mid - 1
  }
  const text = markdownOf(firstChars(runs, chars, lo)).trimEnd()
  return text ? `${text}…` : ''
}

/** the issue's description: the page's own (cut to fit), then a link back to the page (`url`: a checked Notion address) */
export function descriptionFor(parts: unknown, url: string): string {
  const link = `[Notion page](${url})`
  const room = MAX_DESCRIPTION - charCount(link) - 2
  const runs = runsOf(parts)
  let text = markdownOf(runs)
  if (charCount(text) > room) text = cutMarkdown(runs, room)
  return text ? `${text}\n\n${link}` : link
}
