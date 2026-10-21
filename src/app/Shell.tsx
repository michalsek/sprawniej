/** The frame: sidebar (or the settings menu) on the left, top bar and the page on the right. */
import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'wouter'
import { useNarrow } from '@/lib/useNarrow'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/ui/sheet'
import { preloadEditor } from '@/editor/load'
import { NewIssueDialog } from '@/features/issues/NewIssueDialog'
import { QuickEdit } from '@/features/issues/QuickEdit'
import { clearSelection } from '@/features/issues/selection'
import { SelectionBar } from '@/features/issues/SelectionBar'
import { isSettingsPath } from '@/features/settings/nav'
import { SettingsSidebar } from '@/features/settings/SettingsSidebar'
import { CommandPalette } from './CommandPalette'
import { JoinTeams } from './JoinTeams'
import { Tour } from './Tour'
import { useChrome } from './chrome'
import { useShortcuts } from './shortcuts'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function Shell({ children }: { children: ReactNode }) {
  const open = useChrome((s) => s.sidebarOpen)
  const menuOpen = useChrome((s) => s.menuOpen)
  const narrow = useNarrow()
  const [location] = useLocation()
  // in Settings, its own menu takes the sidebar's place
  const inSettings = isSettingsPath(location)
  useShortcuts()
  // a phone's menu (and the side panel's sheet) closes once you've picked where to go
  useEffect(() => {
    useChrome.setState({ menuOpen: false, panelSheetOpen: false })
    if (!inSettings) useChrome.setState({ lastAppPath: location })
    clearSelection()
  }, [location, inSettings])
  // fetch the editor while you look around, so the first issue you open is ready at once
  useEffect(() => {
    const t = setTimeout(preloadEditor, 1500)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex h-full">
      {narrow ? (
        <Sheet open={menuOpen} onOpenChange={(o) => useChrome.setState({ menuOpen: o })}>
          <SheetContent
            side="left"
            className="w-[17.5rem] max-w-[85vw] gap-0 p-0"
            showCloseButton={false}
            // focus the menu itself, not its first button (which would pop up that button's tooltip)
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              ;(e.currentTarget as HTMLElement).focus()
            }}
          >
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">{inSettings ? 'Settings pages' : 'Pages, teams and your account'}</SheetDescription>
            {inSettings ? <SettingsSidebar /> : <Sidebar />}
          </SheetContent>
        </Sheet>
      ) : (
        open && (inSettings ? <SettingsSidebar /> : <Sidebar />)
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </main>
      <NewIssueDialog />
      <CommandPalette />
      <QuickEdit />
      <SelectionBar />
      <JoinTeams />
      <Tour />
    </div>
  )
}
