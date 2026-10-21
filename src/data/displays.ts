/**
 * How each page shows its issues (list or board, grouping, ordering…), remembered in this browser only.
 * Saved views carry their own display; this is for built-in pages and personal overrides.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DISPLAY_PROPERTIES, type Display, type DisplayProperty } from '@/model/schema'

export const DEFAULT_DISPLAY: Display = { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true }

/** what rows and cards show besides status and title: one yes or no for each */
export type Fields = Record<DisplayProperty, boolean>

const ALL_ON = Object.fromEntries(DISPLAY_PROPERTIES.map((k) => [k, true])) as Fields

/** what rows and cards show until someone switches something: how they looked before there were switches */
export const PROPERTY_DEFAULTS: Record<Display['layout'], Fields> = {
  list: { ...ALL_ON, project: false },
  board: { ...ALL_ON, project: false, created: false },
}

/**
 * What this display shows on each issue: the layout's defaults, then what a person turned on or off (one set of
 * choices covers List and Board). Anything that isn't a yes or no, or that this version doesn't know, is left out.
 */
export function propertiesOf(display: Pick<Display, 'layout' | 'properties'>): Fields {
  const fields = { ...PROPERTY_DEFAULTS[display.layout === 'board' ? 'board' : 'list'] }
  const own = ownProperties(display)
  for (const k of DISPLAY_PROPERTIES) {
    const v = own[k]
    if (typeof v === 'boolean') fields[k] = v
  }
  return fields
}

/** the stored choices; rows aren't checked when read, so anything but an object counts as none */
const ownProperties = (display: Pick<Display, 'properties'>): Record<string, unknown> =>
  display.properties && typeof display.properties === 'object' && !Array.isArray(display.properties) ? display.properties : {}

/** the change that turns one property on or off: always the whole set, so other choices (and a newer version's) stay */
export function withProperty(display: Pick<Display, 'properties'>, key: DisplayProperty, on: boolean): Pick<Display, 'properties'> {
  return { properties: { ...ownProperties(display), [key]: on } }
}

/**
 * A saved view's display after a change: the whole display (one column) with the change on top, so what this version
 * doesn't know stays.
 */
export const changedDisplay = (display: Display, patch: Partial<Display>): Display => ({ ...display, ...patch })

/** what a page shows the same on every issue, so it offers no switch for it: a project's page, its project */
export function lockedFields(filters: { projects?: readonly (string | null)[] }): DisplayProperty[] {
  return filters.projects?.length === 1 && filters.projects[0] ? ['project'] : []
}

/** what rows and cards on a page show: the display's choices, less what the page has locked */
export function fieldsFor(display: Pick<Display, 'layout' | 'properties'>, locked: readonly DisplayProperty[]): Fields {
  const fields = propertiesOf(display)
  for (const k of locked) fields[k] = false
  return fields
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
