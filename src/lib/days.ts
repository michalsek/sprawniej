/** Plain days ("2026-10-31"), as due dates and date filters keep them: a day in this browser's time zone. */

/** a Date as a plain day in this browser's time zone */
export function toDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** the start of a plain day, here */
export const fromDay = (day: string) => new Date(`${day}T00:00`)

/** the shape of a plain day, "2026-10-31" (`isDay` also checks the calendar has it) */
export const DAY = /^\d{4}-\d{2}-\d{2}$/

/** a real plain day: "2026-02-28", not "2026-02-30" or "2026-13-45" */
export const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && toDay(fromDay(v)) === v

/** a day `n` days later (earlier when `n` is below 0), by the calendar: dayPlus('2026-10-31', 1) is '2026-11-01' */
export function dayPlus(day: string, n: number): string {
  const d = fromDay(day)
  return toDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
}

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
