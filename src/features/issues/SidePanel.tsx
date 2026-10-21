/**
 * The side panel on lists and boards: the page's details, then quick filters. Beside the list where there's room
 * (`usePanelBeside`), otherwise a sheet from the right that opens only when asked for.
 *
 * Beside the list it is a plain <aside>: a dialog, menu or listbox role would turn off the app's keys while it's
 * open (src/app/shortcuts.ts, isBusy).
 */
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useChrome, usePanelBeside } from '@/app/chrome'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/ui/sheet'

const quiet = 'flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function SidePanel({ children, shown }: { children: ReactNode; shown: number }) {
  const beside = usePanelBeside()
  const open = useChrome((s) => s.panelOpen)
  const sheetOpen = useChrome((s) => s.panelSheetOpen)
  if (beside) {
    if (!open) return null
    return (
      <aside aria-label="Side panel" className="flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-background" data-side-panel>
        <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
          <span className="text-label font-medium text-muted-foreground">Side panel</span>
          <button type="button" className={quiet} aria-label="Hide the side panel" onClick={() => useChrome.setState({ panelOpen: false })}>
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-6 px-4 pb-8">{children}</div>
      </aside>
    )
  }
  return (
    <Sheet open={sheetOpen} onOpenChange={(o) => useChrome.setState({ panelSheetOpen: o })}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-80 max-w-[85vw] gap-0 overflow-y-auto sm:max-w-80"
        data-side-panel
        // the sheet itself takes the focus, not its first row (which would look picked)
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus()
        }}
      >
        <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
          <SheetTitle className="text-label font-medium text-muted-foreground">Side panel</SheetTitle>
          <button type="button" className={quiet} aria-label="Hide the side panel" onClick={() => useChrome.setState({ panelSheetOpen: false })}>
            <X className="size-4" />
          </button>
        </div>
        <SheetDescription className="sr-only" aria-live="polite">
          Shows {shown} {shown === 1 ? 'issue' : 'issues'}
        </SheetDescription>
        <div className="flex flex-col gap-6 px-4 pb-8">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
