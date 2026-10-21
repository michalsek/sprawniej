/**
 * How each page shows its issues (list or board, grouping, ordering…), remembered in this browser only.
 * Saved views carry their own display; this is for built-in pages and personal overrides.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DISPLAY_PROPERTIES, type Display, type DisplayProperty } from '@/model/schema'

export const DEFAULT_DISPLAY: Display = { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true }

export type Shown = Record<DisplayProperty, boolean>

const ALL_ON = Object.fromEntries(DISPLAY_PROPERTIES.map((k) => [k, true])) as Shown

/** what rows and cards show until someone switches something: how they looked before there were switches */
export const PROPERTY_DEFAULTS: Record<Display['layout'], Shown> = {
  list: { ...ALL_ON, project: false },
  board: { ...ALL_ON, project: false, created: false },
}

/**
 * What this display shows on each issue: the layout's defaults, then what a person turned on or off (one set of
 * choices covers List and Board). Anything that isn't a yes or no, or that this version doesn't know, is left out.
 */
export function propertiesOf(display: Pick<Display, 'layout' | 'properties'>): Shown {
  const shown = { ...PROPERTY_DEFAULTS[display.layout === 'board' ? 'board' : 'list'] }
  const own = ownProperties(display)
  for (const k of DISPLAY_PROPERTIES) if (typeof own[k] === 'boolean') shown[k] = own[k]
  return shown
}

/** the stored choices; rows aren't checked when read, so anything but an object counts as none */
const ownProperties = (display: Pick<Display, 'properties'>): Record<string, unknown> =>
  display.properties && typeof display.properties === 'object' && !Array.isArray(display.properties) ? display.properties : {}

/** the change that turns one property on or off: always the whole set, so other choices (and a newer version's) stay */
export function withProperty(display: Pick<Display, 'properties'>, key: DisplayProperty, on: boolean): Pick<Display, 'properties'> {
  return { properties: { ...(ownProperties(display) as Record<string, boolean>), [key]: on } }
}

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
