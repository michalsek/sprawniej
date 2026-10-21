import { useEffect, useState } from 'react'

/**
 * the time now, again every `ms` (for words like "expires tomorrow" on a page left open); only while `active`, so a
 * page that doesn't need it isn't redrawn every minute
 */
export function useNow(ms = 60_000, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    // from the moment it's needed, not from whenever the page opened
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick)
    const t = setInterval(tick, ms)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [ms, active])
  return now
}
