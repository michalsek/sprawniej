/** Plain days ("2026-10-31"), as due dates and date filters keep them: a day in this browser's time zone. */

/** a Date as a plain day in this browser's time zone */
export function toDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** the start of a plain day, here */
export const fromDay = (day: string) => new Date(`${day}T00:00`)

/** a plain day, "2026-10-31" */
export const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * `d` moved by whole months, keeping its time; a day the month doesn't have becomes its last one (Mar 31 one month
 * back is Feb 28, or Feb 29 in a leap year)
 */
export function plusMonths(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(1)
  out.setMonth(out.getMonth() + n)
  const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()
  out.setDate(Math.min(d.getDate(), last))
  return out
}
