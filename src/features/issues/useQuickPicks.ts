/**
 * A page's quick filters, kept per page (a team's tab, a view, a project, My issues) for as long as the browser tab is
 * open: opening an issue and going back finds them as they were, and another team has its own. Only in this browser
 * tab (sessionStorage), never saved anywhere else.
 */
import { useCallback, useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { QUICK_KEY, quickScope, withPicksAt, withoutGone, type QuickFilters } from '@/data/quickFilters'
import { useData } from '@/data/store'
import { sessionStore } from '@/lib/storage'

/** nothing picked (one object, so it doesn't count as a change) */
const NO_PICKS: QuickFilters = {}

const useKept = create<{ byScope: Record<string, QuickFilters> }>()(
  persist(() => ({ byScope: {} }), {
    name: QUICK_KEY,
    // where the browser keeps nothing (blocked site data), they last until the page reloads
    storage: createJSONStorage(() => sessionStore),
  }),
)

/** `page`: the page's key, as for its display ("team:ENG:active", "view:01J…") */
export function useQuickPicks(page: string) {
  const workspace = useData((s) => s.workspace?.id)
  const scope = quickScope(workspace, page)
  const kept = useKept((s) => s.byScope[scope] ?? NO_PICKS)
  const labels = useData((s) => s.labels)
  const projects = useData((s) => s.projects)
  // a label or project a teammate deleted comes out
  const picks = useMemo(
    () => withoutGone(kept, (f, v) => (f === 'labels' ? !!labels[v as string] : f === 'projects' ? v === null || !!projects[v as string] : true)),
    [kept, labels, projects],
  )
  const setPicks = useCallback((next: QuickFilters) => useKept.setState((s) => ({ byScope: withPicksAt(s.byScope, scope, next) })), [scope])
  return { picks, setPicks }
}
