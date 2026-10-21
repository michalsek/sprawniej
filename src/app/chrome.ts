/**
 * State of the frame around pages: sidebar open or not, the side panel (on lists and boards), the breadcrumbs the
 * current page asked for, and the last page outside Settings (where "Back to Sprawniej" goes).
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isQuickField, type QuickField } from '@/data/quickFilters'
import { useMedia } from '@/lib/useNarrow'

export interface Crumb {
  label: string
  href?: string
}

interface Chrome {
  sidebarOpen: boolean
  /** the slide-in menu on a phone */
  menuOpen: boolean
  /** the side panel beside a list or board, where there's room (kept per browser) */
  panelOpen: boolean
  /** its quick filters' tab (kept per browser) */
  panelTab: QuickField
  /** this page has a side panel (lists and boards of issues) */
  panelHere: boolean
  /** where there's no room beside the list: the side panel as a sheet from the right (never open after a reload) */
  panelSheetOpen: boolean
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
      panelOpen: true,
      panelTab: 'assignees',
      panelHere: false,
      panelSheetOpen: false,
      crumbs: [],
      lastAppPath: '/',
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    {
      name: 'sprawniej-chrome',
      partialize: (s) => ({ sidebarOpen: s.sidebarOpen, panelOpen: s.panelOpen, panelTab: s.panelTab }),
      // a tab this version doesn't know (or a broken value) falls back to the first
      merge: (kept, now) => {
        const k = (kept ?? {}) as Partial<Chrome>
        return { ...now, ...k, panelTab: isQuickField(k.panelTab) ? k.panelTab : now.panelTab }
      },
    },
  ),
)

/** the widths from which the side panel fits beside the list: with the sidebar open, and with it closed */
export const PANEL_BESIDE = { withSidebar: '(min-width: 1280px)', alone: '(min-width: 1024px)' }

/** the side panel sits beside the list (true) or opens as a sheet (false) */
export function panelBeside(): boolean {
  const q = useChrome.getState().sidebarOpen ? PANEL_BESIDE.withSidebar : PANEL_BESIDE.alone
  return window.matchMedia(q).matches
}

export function usePanelBeside(): boolean {
  const sidebar = useChrome((s) => s.sidebarOpen)
  const wide = useMedia(PANEL_BESIDE.withSidebar)
  const mid = useMedia(PANEL_BESIDE.alone)
  return sidebar ? wide : mid
}

/** `]`, the top bar's button, the command: show or hide the side panel */
export function togglePanel() {
  if (panelBeside()) useChrome.setState((s) => ({ panelOpen: !s.panelOpen }))
  else useChrome.setState((s) => ({ panelSheetOpen: !s.panelSheetOpen }))
}

/** show the side panel (on this tab, when given) */
export function openPanel(tab?: QuickField) {
  useChrome.setState({ ...(panelBeside() ? { panelOpen: true } : { panelSheetOpen: true }), ...(tab && { panelTab: tab }) })
}

/** a page calls this with its trail, e.g. [{ label: 'Engineering' }, { label: 'Issues' }] */
export function useCrumbs(crumbs: Crumb[]) {
  const key = JSON.stringify(crumbs)
  useEffect(() => {
    useChrome.setState({ crumbs: JSON.parse(key) as Crumb[] })
  }, [key])
}
