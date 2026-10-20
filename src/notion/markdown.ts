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

/** marks and links wrap the words, not the spaces around them, or Markdown doesn't see them ("** x**") */
function around(text: string, f: (words: string) => string): string {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!m || !m[2]) return text
  return `${m[1]}${f(m[2])}${m[3]}`
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

/**
 * Rich text as Markdown. Neighbouring parts with the same marks and link are one run, so a word bold in part reads
 * right. A line break inside the text stays a line break (Markdown's two spaces), a blank line a new paragraph.
 * Mentions and equations read as their text. What someone typed as Markdown is left as they wrote it.
 */
export function richTextToMarkdown(parts: unknown): string {
  const runs: Run[] = []
  for (const r of (Array.isArray(parts) ? parts : []).map(run)) {
    if (!r.text) continue
    const last = runs.at(-1)
    if (last && same(last, r)) last.text += r.text
    else runs.push(r)
  }
  return runs
    .map(render)
    .join('')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.split('\n').map((line) => line.trimEnd()).join('  \n'))
    .join('\n\n')
    .trim()
}

/** the issue's description: the page's own (cut to fit), then a link back to the page (`url`: a checked Notion address) */
export function descriptionFor(parts: unknown, url: string): string {
  const link = `[Notion page](${url})`
  const room = MAX_DESCRIPTION - charCount(link) - 2
  let text = richTextToMarkdown(parts)
  if (charCount(text) > room) text = `${cut(text, room - 1).trimEnd()}…`
  return text ? `${text}\n\n${link}` : link
}
