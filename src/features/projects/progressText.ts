/**
 * The words for a project's progress: what its ring's tooltip says, and how many issues its card shows. Plain
 * functions, so every wording is tested (tests/progressText.test.ts).
 */
import { progressOf, progressPercent, type ProjectCounts } from '@/data/select'
import { CATEGORIES } from '@/model/status'

const issues = (n: number) => `${n} ${n === 1 ? 'issue' : 'issues'}`

/** what a card says about how many issues count: "12 issues", "1 issue", "No issues" */
export const issueCountText = (total: number): string => (total > 0 ? issues(total) : 'No issues')

/** the categories still open, in their order: Backlog, Todo, In Progress, In Review */
const OPEN = CATEGORIES.filter((c) => c.group !== 'completed' && c.group !== 'canceled')

/**
 * The ring's tooltip, a line each: how much is done ("67% done: 8 of 12 issues"), then what is still open, then what
 * is left out, then how many archived ones count. The first line alone is what a screen reader hears on a card.
 */
export function progressWords(c: Readonly<ProjectCounts>): string[] {
  const { done, total, canceled } = progressOf(c)
  const lines: string[] = []
  if (total === 0) lines.push(canceled ? `No issues to count: ${canceled} canceled ${canceled === 1 ? 'one is' : 'ones are'} left out` : 'No issues yet')
  else if (done === total) lines.push(total === 1 ? 'The 1 issue is done' : `All ${total} issues done`)
  else lines.push(`${progressPercent(done, total)}% done: ${done} of ${issues(total)}`)
  const open = OPEN.filter((cat) => c[cat.id] > 0).map((cat) => `${c[cat.id]} ${cat.name}`)
  if (open.length) lines.push(`Still open: ${open.join(', ')}`)
  const out = [c.canceled && `${c.canceled} canceled`, c.duplicate && `${c.duplicate} ${c.duplicate === 1 ? 'duplicate' : 'duplicates'}`].filter(Boolean)
  if (out.length) lines.push(`Not counted: ${out.join(', ')}`)
  if (c.archived) lines.push(`Counts ${c.archived} archived ${c.archived === 1 ? 'issue' : 'issues'}`)
  return lines
}
