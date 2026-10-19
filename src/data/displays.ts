/**
 * How each page shows its issues (list or board, grouping, ordering…), remembered in this browser only.
 * Saved views carry their own display; this is for built-in pages and personal overrides.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Display } from '@/model/schema'

export const DEFAULT_DISPLAY: Display = { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true }

interface Displays {
  byPage: Record<string, Partial<Display>>
  set: (page: string, patch: Partial<Display>) => void
  reset: (page: string) => void
}

export const useDisplays = create<Displays>()(
  persist(
    (set) => ({
      byPage: {},
      set: (page, patch) => set((s) => ({ byPage: { ...s.byPage, [page]: { ...s.byPage[page], ...patch } } })),
      reset: (page) =>
        set((s) => {
          const { [page]: _, ...rest } = s.byPage
          return { byPage: rest }
        }),
    }),
    { name: 'sprawniej-displays' },
  ),
)

/** the display for a page: built-in default, then the page's own default, then what you picked here */
export function useDisplay(page: string, base?: Partial<Display>) {
  const mine = useDisplays((s) => s.byPage[page])
  const set = useDisplays((s) => s.set)
  const reset = useDisplays((s) => s.reset)
  const display: Display = { ...DEFAULT_DISPLAY, ...base, ...mine }
  // the layout switch isn't a "display option", so changing it alone doesn't offer a reset
  const changed = !!mine && Object.keys(mine).some((k) => k !== 'layout')
  return {
    display,
    setDisplay: (patch: Partial<Display>) => set(page, patch),
    /** back to the page's defaults, keeping List or Board */
    resetDisplay: changed ? () => (reset(page), mine?.layout && set(page, { layout: mine.layout })) : undefined,
  }
}
