/**
 * Notion's rich text (a list of parts, each with its own bold, italic, code and link) as the Markdown an issue's
 * description is written in (docs/notion.md). Pure, so it's unit-tested (tests/notion.test.ts).
 */

export interface RichText {
  type?: string
  plain_text?: string
  href?: string | null
  annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; code?: boolean; color?: string }
}

/** the longest description an issue gets from Notion, the link back included (notion_apply cuts there too) */
export const MAX_DESCRIPTION = 50_000

/** no HTML comes through: the editor would read it as such */
const escapeHtml = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** marks wrap the words, not the spaces around them, or Markdown doesn't see them ("** x**") */
function wrap(text: string, mark: string): string {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!m || !m[2]) return text
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`
}

/** one part: its text with its marks, and its link when it goes to an https address */
function part(p: RichText): string {
  let text = p.plain_text ?? ''
  if (!text) return ''
  const a = p.annotations ?? {}
  // code shows as written, so nothing else goes inside it
  text = a.code ? wrap(text.replace(/`/g, "'"), '`') : escapeHtml(text)
  if (a.bold) text = wrap(text, '**')
  if (a.italic) text = wrap(text, '_')
  if (a.strikethrough) text = wrap(text, '~~')
  if (p.href?.startsWith('https://') && text.trim()) text = `[${text.replace(/[[\]]/g, '\\$&')}](${p.href.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`)})`
  return text
}

/**
 * Rich text as Markdown. A line break inside the text stays a line break (Markdown's two spaces), a blank line a new
 * paragraph. Mentions and equations read as their text. What someone typed as Markdown is left as they wrote it.
 */
export function richTextToMarkdown(parts: readonly RichText[] | undefined): string {
  const text = (parts ?? []).map(part).join('')
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.split('\n').map((line) => line.trimEnd()).join('  \n'))
    .join('\n\n')
    .trim()
}

/** the issue's description: the page's own (cut to fit), then a link back to the page */
export function descriptionFor(parts: readonly RichText[] | undefined, url: string): string {
  const link = `[Notion page](${url})`
  const room = MAX_DESCRIPTION - link.length - 2
  let text = richTextToMarkdown(parts)
  if (text.length > room) text = `${text.slice(0, room - 1).trimEnd()}…`
  return text ? `${text}\n\n${link}` : link
}
