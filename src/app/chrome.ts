/**
 * State of the frame around pages: sidebar open or not, the breadcrumbs the current page asked for, and the last page
 * outside Settings (where "Back to Sprawniej" goes).
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Crumb {
  label: string
  href?: string
}

interface Chrome {
  sidebarOpen: boolean
  /** the slide-in menu on a phone */
  menuOpen: boolean
  crumbs: Crumb[]
  /** the last page you were on outside Settings (not kept after a reload) */
  lastAppPath: string
  toggleSidebar: () => void
}

export const useChrome = create<Chrome>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      menuOpen: false,
      crumbs: [],
      lastAppPath: '/',
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    { name: 'sprawniej-chrome', partialize: (s) => ({ sidebarOpen: s.sidebarOpen }) },
  ),
)

/** a page calls this with its trail, e.g. [{ label: 'Engineering' }, { label: 'Issues' }] */
export function useCrumbs(crumbs: Crumb[]) {
  const key = JSON.stringify(crumbs)
  useEffect(() => {
    useChrome.setState({ crumbs: JSON.parse(key) as Crumb[] })
  }, [key])
}
