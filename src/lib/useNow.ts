import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * the time now, again every `ms` (for words like "expires tomorrow" on a page left open); only while `active`, so a
 * page that doesn't need it isn't redrawn every minute
 */
export function useNow(ms = 60_000, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  const wasActive = useRef(active)
  // catching up when it's switched on, or when what it holds is old: before the page is drawn, and never on a plain
  // first render (what it holds is fresh then)
  useLayoutEffect(() => {
    const switchedOn = active && !wasActive.current
    wasActive.current = active
    if (active && (switchedOn || Date.now() - now >= ms)) setNow(Date.now())
  }, [active, ms, now])
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms, active])
  return now
}
