import { useEffect, useState } from 'react'

/** the time now, again every `ms` (for words like "expires tomorrow" on a page left open) */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
