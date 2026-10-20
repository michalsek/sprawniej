/** The left column in Settings: back to where you were, then the settings pages you may open, by group. */
import { Link } from 'wouter'
import { ArrowLeft } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useChrome } from '@/app/chrome'
import { NavItem, Section } from '@/app/Sidebar'
import { isAdmin } from '@/data/select'
import { useData } from '@/data/store'
import { GROUPS, listedPages } from './nav'
import { PAGES } from './pages'

export function SettingsSidebar() {
  const back = useChrome((s) => s.lastAppPath)
  const pages = useData(useShallow((s) => listedPages(PAGES, isAdmin(s), s)))
  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r bg-sidebar md:w-[17.5rem]">
      <div className="flex h-16 items-center px-2">
        <Link
          href={back}
          className="flex h-9 items-center gap-3 rounded-lg px-3 text-[15px] text-sidebar-foreground/90 transition-colors hover:bg-sidebar-accent/60 [&_svg]:size-[18px] [&_svg]:text-sidebar-foreground/80"
        >
          <ArrowLeft /> Back to Sprawniej
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Settings">
        <h2 className="mt-2 px-3 text-xl font-semibold tracking-tight">Settings</h2>
        {GROUPS.map((g) => {
          const mine = pages.filter((p) => p.group === g.id)
          return (
            mine.length > 0 && (
              <Section key={g.id} title={g.title}>
                {mine.map((p) => (
                  <NavItem key={p.id} exact href={p.path} icon={<p.icon />}>
                    {p.title}
                  </NavItem>
                ))}
              </Section>
            )
          )
        })}
      </nav>
    </aside>
  )
}
