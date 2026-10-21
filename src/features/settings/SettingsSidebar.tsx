/** The left column in Settings: back to where you were, then the settings pages you may open, by group. */
import { ArrowLeft } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useChrome } from '@/app/chrome'
import { NavGroup, NavItem } from '@/app/NavItem'
import { isAdmin } from '@/data/select'
import { useData } from '@/data/store'
import { backTo, GROUPS, listedPages } from './nav'
import { PAGES } from './pages'

export function SettingsSidebar() {
  const last = useChrome((s) => s.lastAppPath)
  const back = useData((s) => backTo(last, s.teams))
  const pages = useData(useShallow((s) => listedPages(PAGES, isAdmin(s), s)))
  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r bg-sidebar md:w-[17.5rem]">
      <div className="flex h-16 items-center px-2">
        <NavItem href={back} icon={<ArrowLeft />}>
          Back to Sprawniej
        </NavItem>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Settings">
        <h2 className="mt-2 px-3 text-title font-semibold tracking-tight">Settings</h2>
        {GROUPS.map((g) => {
          const mine = pages.filter((p) => p.group === g.id)
          return (
            mine.length > 0 && (
              <NavGroup key={g.id} title={g.title}>
                {mine.map((p) => (
                  <NavItem key={p.id} exact href={p.path} icon={<p.icon />}>
                    {p.title}
                  </NavItem>
                ))}
              </NavGroup>
            )
          )
        })}
      </nav>
    </aside>
  )
}
