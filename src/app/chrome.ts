/**
 * State of the frame around pages: sidebar open or not, the side panel (on lists and boards), the breadcrumbs the
 * current page asked for, and the last page outside Settings (where "Back to Sprawniej" goes).
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isPanelField, type PanelField } from '@/data/quickFilters'
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
  panelTab: PanelField
  /** how many lists of issues with a side panel are on screen (0: no toggle, `]` does nothing) */
  panelPages: number
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
      panelPages: 0,
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
        return { ...now, ...k, panelTab: isPanelField(k.panelTab) ? k.panelTab : now.panelTab }
      },
    },
  ),
)

/** the widths from which the side panel fits beside the list: with the sidebar open, and with it closed */
const PANEL_BESIDE = { withSidebar: '(min-width: 1280px)', alone: '(min-width: 1024px)' }

/** the side panel sits beside the list (true) or opens as a sheet (false) */
function panelBeside(): boolean {
  const q = useChrome.getState().sidebarOpen ? PANEL_BESIDE.withSidebar : PANEL_BESIDE.alone
  return window.matchMedia(q).matches
}

export function usePanelBeside(): boolean {
  const sidebar = useChrome((s) => s.sidebarOpen)
  const wide = useMedia(PANEL_BESIDE.withSidebar)
  const mid = useMedia(PANEL_BESIDE.alone)
  return sidebar ? wide : mid
}

/** a page with a side panel: the top bar's toggle and `]` work while it's on screen */
export function useSidePanelHere() {
  useEffect(() => {
    useChrome.setState((s) => ({ panelPages: s.panelPages + 1 }))
    return () => {
      useChrome.setState((s) => ({ panelPages: Math.max(0, s.panelPages - 1) }))
    }
  }, [])
}

/** after React has drawn the change: focus the first of these that is there */
function focusLater(selector: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus())
}

/** hide the side panel beside the list; focus inside it goes back to the top bar's toggle */
export function hidePanel() {
  const inside = !!document.activeElement?.closest('[data-side-panel]')
  useChrome.setState({ panelOpen: false })
  if (inside) focusLater('[data-panel-toggle]')
}

/**
 * `]`, the top bar's button, the command: show or hide the side panel. `focus` (the key): opening it beside the list
 * moves the focus into it, onto its tabs.
 */
export function togglePanel({ focus = false }: { focus?: boolean } = {}) {
  if (!panelBeside()) return useChrome.setState((s) => ({ panelSheetOpen: !s.panelSheetOpen }))
  if (useChrome.getState().panelOpen) return hidePanel()
  useChrome.setState({ panelOpen: true })
  if (focus) focusLater('[data-side-panel] [role=radio][tabindex="0"], [data-side-panel] [data-quick-filters] button')
}

/** show the side panel (on this tab, when given) */
export function openPanel(tab?: PanelField) {
  useChrome.setState({ ...(panelBeside() ? { panelOpen: true } : { panelSheetOpen: true }), ...(tab && { panelTab: tab }) })
}

/** a page calls this with its trail, e.g. [{ label: 'Engineering' }, { label: 'Issues' }] */
export function useCrumbs(crumbs: Crumb[]) {
  const key = JSON.stringify(crumbs)
  useEffect(() => {
    useChrome.setState({ crumbs: JSON.parse(key) as Crumb[] })
  }, [key])
}
