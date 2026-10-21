/** Screen-size checks: `useNarrow` is true on phone-sized screens (under 768 px), where the sidebar becomes a menu. */
import { useCallback, useSyncExternalStore } from 'react'

export function useMedia(query: string): boolean {
  // the same subscribe while the query stays, so React doesn't subscribe again on every render
  const subscribe = useCallback(
    (onChange: () => void) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

export const useNarrow = () => useMedia('(max-width: 767px)')
