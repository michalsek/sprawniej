/**
 * Drag-n-drop for the issue list and board (the shared parts: src/features/board/columnsDrag.ts). While you drag,
 * the issue moves between groups on screen. On drop it gets one change: a new place among its neighbours, plus the
 * status, priority, assignee or project of the group it landed in. Picked issues move along with it.
 */
import { useMemo } from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { toast } from 'sonner'
import { moveIssue, moveIssues } from '@/data/actions'
import { changedOnly, groupPatch, neighbours } from '@/data/ordering'
import { nestChildren, type Group } from '@/data/select'
import type { Display, Issue } from '@/model/schema'
import { columnKey, isColumnId, useColumnsDrag } from '@/features/board/columnsDrag'
import { clearSelection, useSelection } from './selection'

const ORDER_NAMES: Record<Display['ordering'], string> = { manual: 'manual', priority: 'priority', due: 'due date', updated: 'last update', created: 'creation date' }

/** the order each group shows its issues in: sub-issues right under their parent in a list */
function baseOrder(groups: Group[], nest: boolean): Record<string, string[]> {
  return Object.fromEntries(groups.map((g) => [g.key, nest ? nestChildren(g.issues).map((r) => r.issue.id) : g.issues.map((i) => i.id)]))
}

/**
 * `nest`: sub-issues sit under their parent (list). `park`: empty groups are shown apart (the board's hidden
 * columns); dropping on one moves the issue there, but nothing moves on screen while you hover it. `onDrop` hears
 * which issues were dropped, so the page can keep showing them.
 */
export function useIssueDrag(groups: Group[], display: Display, { nest = false, park = false, onDrop }: { nest?: boolean; park?: boolean; onDrop?: (ids: string[]) => void } = {}) {
  const base = useMemo(() => baseOrder(groups, nest), [groups, nest])
  const parked = useMemo(() => new Set(park ? groups.filter((g) => g.issues.length === 0).map((g) => g.key) : []), [groups, park])
  const issues = useMemo(() => new Map(groups.flatMap((g) => g.issues.map((i) => [i.id, i] as const))), [groups])
  const cols = useColumnsDrag(base, parked)

  const reset = () => {
    cols.reset()
    useSelection.setState({ dragging: false, draggingMany: false })
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id)
    cols.start(id)
    // dragging an issue you didn't pick moves just that one
    const picked = useSelection.getState().ids
    if (!picked.includes(id)) clearSelection()
    useSelection.setState({ dragging: true, draggingMany: picked.includes(id) && picked.length > 1 })
  }

  /** the other picked issues that move along, in the order they're shown */
  const companions = (id: string): string[] => {
    const picked = new Set(useSelection.getState().ids)
    if (!picked.has(id) || picked.size < 2) return []
    return Object.values(base)
      .flat()
      .filter((x) => x !== id && picked.has(x))
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id)
    const from = cols.startedIn()
    // a hidden column takes the drop as it is; otherwise the issue is wherever the live order put it
    const onParked = over && isColumnId(over.id) && parked.has(columnKey(over.id))
    const to = onParked ? columnKey(over.id) : cols.columnOf(active.id)
    cols.ended()
    const issue = issues.get(id)
    if (!over || !from || !to || !issue) return reset()

    let ids = onParked ? [id] : cols.finalOrder(id, over.id, to)
    const others = companions(id)
    // the others land right after the dragged one
    if (others.length) ids = ids.filter((x) => !others.includes(x))
    const group = groups.find((g) => g.key === to)
    const groupChange = group ? groupPatch(display.grouping, group.value) : {}
    const patch = from !== to ? changedOnly(issue, groupChange) : {}
    const manual = display.ordering === 'manual'
    const movedWithin = from === to && ids.indexOf(id) !== base[from].indexOf(id)
    const othersChange = others.some((x) => {
      const o = issues.get(x)
      return o && Object.keys(changedOnly(o, groupChange)).length > 0
    })

    if (!manual && movedWithin && !Object.keys(patch).length && !othersChange) {
      toast(`This list is sorted by ${ORDER_NAMES[display.ordering]}`, { description: 'To arrange issues by hand, choose Manual order under Display.' })
    }
    if (Object.keys(patch).length || othersChange || (manual && (movedWithin || from !== to || others.length > 0))) {
      // in a list, a sub-issue stays among its siblings and a top-level issue among top-level ones
      const parentHere = (x: string) => {
        const p = issues.get(x)?.parent
        return nest && p && ids.includes(p) ? p : null
      }
      // a hidden column keeps the issue's place: there are no neighbours to see there
      const near = manual && !onParked ? neighbours(ids, id, parentHere) : null
      onDrop?.([id, ...others])
      if (others.length) moveIssues([id, ...others], { patch: groupChange, place: near })
      else moveIssue(id, { patch, place: near })
    }
    reset()
  }

  return {
    order: cols.order,
    /** groups shown apart under "Hidden columns" (board) */
    parked,
    activeId: cols.activeId,
    issue: (id: string): Issue | undefined => issues.get(id),
    /** true right after a drop, so the click that ends a drag doesn't open the issue */
    justDropped: cols.justDropped,
    dnd: { sensors: cols.sensors, collisionDetection: cols.collisionDetection, onDragStart, onDragOver: cols.over, onDragEnd, onDragCancel: reset },
  }
}
