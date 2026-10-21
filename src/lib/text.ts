/** Small helpers for showing text. */

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * The start of a longer text on one line: spaces and new lines become single spaces, and past `max` characters it is
 * cut (never inside an emoji or a letter with its accent) and ends with "…". A card shows its first lines and lets CSS
 * cut the rest; this keeps a very long description out of the page.
 */
export function shortText(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  let out = ''
  for (const { segment } of graphemes.segment(flat)) {
    if (out.length + segment.length > max) break
    out += segment
  }
  return `${out.trimEnd()}…`
}
