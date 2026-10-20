/**
 * Checklist items in Markdown text ("- [ ] buy milk", "* [x] done", also inside a quote), read and changed as plain
 * text: no editor needed, so lists and boards can count them and a tick changes exactly one character (the box), so
 * `* [X] a` stays `*` and nothing else in the text moves.
 *
 * Lines inside a code block (``` or ~~~) are never items. The database function set_checklist_item
 * (supabase/migrations/*_checklist_ticks.sql) finds items in exactly the same way: keep the two in step.
 * tests/fixtures/checklists.ts runs the same cases against both.
 */

/** a checklist line: what comes before the box, the box character, and the item's text */
const ITEM = /^((?:[ \t]*>)*[ \t]*[-+*][ \t]+\[)([ xX])\](?:[ \t]+([^\n]*))?$/
/** a box with nothing after it, at the end of a line */
const BARE = /^((?:[ \t]*>)*[ \t]*[-+*][ \t]+\[[ xX]\])$/
const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})/
const CLOSE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

export interface ChecklistItem {
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

/**
 * The text with a space after every box that ends its line ("- [ ]" becomes "- [ ] "), so an empty item reads back
 * as an empty item and not as the characters "[ ]".
 */
export function openable(md: string): string {
  if (!md.includes('[')) return md
  const lines = md.split('\n')
  let changed = false
  for (const [line, n] of outsideCode(lines)) {
    if (BARE.test(line)) {
      lines[n] = `${line} `
      changed = true
    }
  }
  return changed ? lines.join('\n') : md
}
