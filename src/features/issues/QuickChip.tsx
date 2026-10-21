/**
 * The line under the toolbar while quick filters are picked: "Quick filter: Assignee is Ana and Labels include Bug".
 * Clicking it shows them in the side panel, × clears them. On a view, "Add to view" puts them into the view for
 * everyone; elsewhere "Save as view" sits here when there's no other filter line to carry it.
 */
import type { ReactNode } from 'react'
import { ListPlus } from 'lucide-react'
import { toast } from 'sonner'
import { openPanel, useChrome, usePanelBeside } from '@/app/chrome'
import { quickTree, withQuick, type PanelField, type QuickFilters } from '@/data/quickFilters'
import type { Filters } from '@/model/schema'
import { Button } from '@/ui/button'
import { FilterSummary } from './FilterBar'

interface Props {
  picks: QuickFilters
  setPicks: (picks: QuickFilters) => void
  /** the tabs this page offers */
  fields: PanelField[]
  /** on a saved view: its filters, and how to change them */
  view?: { filters: Filters; onFilters: (f: Filters) => void }
  /** the "Save as view" button, when this line should carry it */
  saveAsView?: ReactNode
}

export function QuickChip({ picks, setPicks, fields, view, saveAsView }: Props) {
  const beside = usePanelBeside()

  /** show the panel, on the tab of something picked; beside the list, straight to the first picked line */
  const show = () => {
    const tab = useChrome.getState().panelTab
    const first = fields.find((f) => picks[f]?.length)
    openPanel(first && !picks[tab]?.length ? first : undefined)
    if (beside) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-quick-filters] [aria-pressed="true"]')?.focus())
  }

  /** the quick filters become part of the view, for everyone (with a way back) */
  const addToView = () => {
    if (!view) return
    const before = { filters: view.filters, picks }
    const next = withQuick(view.filters, picks)
    setPicks({})
    if (next === view.filters) return void toast('The view already shows only these issues')
    view.onFilters(next)
    toast('Added to the view', {
      action: {
        label: 'Undo',
        onClick: () => {
          view.onFilters(before.filters)
          setPicks(before.picks)
        },
      },
    })
  }

  return (
    <FilterSummary
      tree={quickTree(picks)}
      kind={{ name: 'Quick filter', open: 'Show in the side panel', clear: 'Clear quick filters' }}
      popup={!beside}
      open={false}
      onOpen={show}
      onClear={() => setPicks({})}
      extra={
        view ? (
          <Button variant="outline" size="sm" onClick={addToView}>
            <ListPlus /> Add to view
          </Button>
        ) : (
          saveAsView
        )
      }
    />
  )
}
