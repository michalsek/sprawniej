import type { Ticks } from '@/components/MarkdownView'
import { fromDay, toDay } from '@/lib/days'

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const MONTH_YEAR = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })

/** "Oct 2", or "Oct 2, 2025" when it's not this year */
export function shortDate(iso: string, now = new Date()): string {
  // a plain date (a project's target) is a day here, not midnight in London
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00` : iso)
  return d.getFullYear() === now.getFullYear() ? MONTH.format(d) : MONTH_YEAR.format(d)
}

/** the plain day `n` days after `from` (today) */
export const addDays = (n: number, from = new Date()) => toDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + n))

/** "Today", "Tomorrow", "Yesterday", else "Oct 31" */
export function dayName(day: string, today = toDay(new Date())): string {
  const now = fromDay(today)
  if (day === today) return 'Today'
  if (day === addDays(1, now)) return 'Tomorrow'
  if (day === addDays(-1, now)) return 'Yesterday'
  return shortDate(day, now)
}

/** overdue (red), due within two days (amber), or later */
export function dueTone(day: string, today = toDay(new Date())): 'overdue' | 'soon' | 'later' {
  if (day < today) return 'overdue'
  return day <= addDays(2, fromDay(today)) ? 'soon' : 'later'
}

export function estimateName(points: number): string {
  return `${points} ${points === 1 ? 'point' : 'points'}`
}

const MINUTE = 60_000
/** "just now", "5 min ago", "3 h ago", "yesterday", else "Oct 2" */
export function timeAgo(iso: string, now = new Date()): string {
  const ms = now.getTime() - Date.parse(iso)
  if (ms < MINUTE) return 'just now'
  if (ms < 60 * MINUTE) return `${Math.floor(ms / MINUTE)} min ago`
  if (ms < 24 * 60 * MINUTE && new Date(iso).getDate() === now.getDate()) return `${Math.floor(ms / (60 * MINUTE))} h ago`
  if (toDay(new Date(iso)) === addDays(-1, now)) return 'yesterday'
  return shortDate(iso, now)
}

/** what each state of a pull request is called on the issue page */
export const pullStateName = (state: 'open' | 'draft' | 'merged' | 'closed'): string =>
  ({ open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' })[state]

/** an archived issue's checklists show as they were */
export const ARCHIVED_TICKS: Ticks = { note: 'Restore this issue to tick its boxes.' }
