/** Small helpers for showing text. */

let segmenter: Intl.Segmenter | null | undefined

/** the text's characters as people see them (an emoji, a letter with its accent), made once it's first needed */
function* graphemes(text: string): Generator<string> {
  if (segmenter === undefined) segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  // without Segmenter (an older browser), code points: an emoji made of several, or a letter and an accent written
  // apart, may then be cut, but never half of one code point
  if (segmenter) for (const s of segmenter.segment(text)) yield s.segment
  else yield* text
}

/**
 * The start of a longer text on one line: spaces and new lines become single spaces, and past `max` characters it is
 * cut (never inside an emoji or a letter with its accent) and ends with "…". A first character longer than `max` (a
 * long emoji) is kept whole. A card shows its first lines and lets CSS cut the rest; this keeps a very long
 * description out of the page.
 */
export function shortText(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  let out = ''
  for (const g of graphemes(flat)) {
    if (out && out.length + g.length > max) break
    out += g
    if (out.length >= max) break
  }
  return `${out.trimEnd()}…`
}
