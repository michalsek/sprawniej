/**
 * Checklist items in Markdown text ("- [ ] buy milk", "* [x] done", also inside a quote), read and changed as plain
 * text: no editor needed, so lists and boards can count them and a tick changes exactly one character (the box), so
 * `* [X] a` stays `*` and nothing else in the text moves.
 *
 * Lines inside a code block (``` or ~~~, also indented in a list or inside a quote) are never items. The database function set_checklist_item
 * (supabase/migrations/*_checklist_ticks.sql) finds items in exactly the same way: keep the two in step.
 * tests/fixtures/checklists.ts runs the same cases against both.
 */

/** a checklist line: what comes before the box, the box character, and the item's text */
const ITEM = /^((?:[ \t]*>)*[ \t]*[-+*][ \t]+\[)([ xX])\](?:[ \t]+([^\n]*))?\r?$/
/** a box with nothing after it, at the end of a line */
const BARE = /^(?:[ \t]*>)*[ \t]*[-+*][ \t]+\[[ xX]\]\r?$/
const OPEN_FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/
const CLOSE_FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})[ \t\r]*$/

interface ChecklistItem {
  /** the how-manieth item, from 0 */
  index: number
  /** its line, from 0 */
  line: number
  /** where the box character is in the line */
  at: number
  /** what it says, without trailing spaces */
  text: string
  checked: boolean
}

const trimEnd = (s: string) => s.replace(/[ \t\r]+$/, '')

/** each line outside code blocks, with its number */
function* outsideCode(lines: readonly string[]): Generator<[string, number]> {
  let fence: string | null = null
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    if (fence) {
      const close = CLOSE_FENCE.exec(line)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
      continue
    }
    const open = OPEN_FENCE.exec(line)
    if (open) {
      fence = open[1]
      continue
    }
    yield [line, n]
  }
}

export function checklistItems(md: string): ChecklistItem[] {
  const out: ChecklistItem[] = []
  for (const [line, n] of outsideCode(md.split('\n'))) {
    const m = ITEM.exec(line)
    if (m) out.push({ index: out.length, line: n, at: m[1].length, text: trimEnd(m[3] ?? ''), checked: m[2] !== ' ' })
  }
  return out
}

function setBox(md: string, item: ChecklistItem | undefined, checked: boolean): string {
  if (!item || item.checked === checked) return md
  const lines = md.split('\n')
  const line = lines[item.line]
  lines[item.line] = line.slice(0, item.at) + (checked ? 'x' : ' ') + line.slice(item.at + 1)
  return lines.join('\n')
}

/** the text with item `index` ticked (or not); unchanged when it already is, or there is no such item */
export const setChecked = (md: string, index: number, checked: boolean): string => setBox(md, checklistItems(md)[index], checked)

/** the same, for the item on line `line` (from 0) */
export const setCheckedAtLine = (md: string, line: number, checked: boolean): string =>
  setBox(md, checklistItems(md).find((i) => i.line === line), checked)

/**
 * A tick as the database makes it (set_checklist_item): item `index` if it still says `text`, else the only item
 * that says it. Null when neither is there (the item was changed or deleted meanwhile); the text unchanged when the
 * box already is that way.
 */
export function tickItem(md: string, index: number, text: string, checked: boolean): string | null {
  const items = checklistItems(md)
  const same = items.filter((i) => i.text === text)
  const item = items[index]?.text === text ? items[index] : same.length === 1 ? same[0] : undefined
  return item ? setBox(md, item, checked) : null
}

/** done and all items, or null when there are none (cheap: most descriptions have no box at all) */
export function checklistCount(md: string): { done: number; total: number } | null {
  if (!md.includes('[')) return null
  const items = checklistItems(md)
  if (!items.length) return null
  return { done: items.filter((i) => i.checked).length, total: items.length }
}

/** the text with `fill` after the box of every empty item (outside code), each on its own line still */
function fillEmpty(md: string, fill: string, only: (line: string) => boolean): string {
  if (!md.includes('[')) return md
  const lines = md.split('\n')
  let changed = false
  for (const item of checklistItems(md)) {
    const line = lines[item.line]
    if (item.text || !only(line)) continue
    lines[item.line] = line.slice(0, item.at + 2) + fill
    changed = true
  }
  return changed ? lines.join('\n') : md
}

/**
 * For the editor: a space after every box that ends its line ("- [ ]" becomes "- [ ] "), so an empty item opens as
 * an empty item and not as the characters "[ ]".
 */
export const openable = (md: string): string => fillEmpty(md, ' ', (line) => BARE.test(line))

/**
 * For reading views: every empty item gets a blank that shows nothing, because a box with nothing after it isn't a
 * box there. The lines stay where they were, so a tick still names its line.
 */
export const showable = (md: string): string => fillEmpty(md, ' &nbsp;', () => true)

/**
 * Whether a tick made in the editor can be saved as just that box: the text the editor shows now (`now`) is the saved
 * text (`before`) with only that box changed. `pending`: your own edits are still waiting to be saved; then only an
 * exact match counts. The tick to send, or null (the whole text is saved instead).
 */
export function tickFrom(before: string, now: string, tick: { index: number; checked: boolean }, pending: boolean): { index: number; text: string; checked: boolean } | null {
  const was = checklistItems(before)
  const item = was[tick.index]
  if (!item || item.checked === tick.checked) return null
  const single = { index: tick.index, text: item.text, checked: tick.checked }
  if (now === setBox(before, item, tick.checked)) return single
  if (pending) return null
  // the editor writes some things its own way (`*` as `-`): the same items, and only this box changed
  const is = checklistItems(now)
  if (is.length !== was.length || is.some((n, k) => n.checked !== (k === tick.index ? tick.checked : was[k].checked))) return null
  return single
}
