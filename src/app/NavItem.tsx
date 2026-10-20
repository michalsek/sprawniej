/** The pieces both sidebars are made of (the main one and Settings'): a link that lights up, and a titled group. */
import type { ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { cn } from '@/lib/utils'

/** how a sidebar link looks (favourites use it too) */
export const NAV_LINK = 'flex h-9 items-center gap-3 rounded-lg px-3 text-[15px] text-sidebar-foreground/90 [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-sidebar-foreground/80'

/** a link in the sidebar, lit while you're on its page (or below it, unless `exact`) */
export function NavItem({ href, icon, children, count, indent, exact }: { href: string; icon: ReactNode; children: ReactNode; count?: number; indent?: boolean; exact?: boolean }) {
  const [location] = useLocation()
  const active = location === href || (!exact && href !== '/' && location.startsWith(`${href}/`))
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        NAV_LINK,
        'transition-colors hover:bg-sidebar-accent/60',
        active && 'bg-sidebar-accent text-sidebar-foreground',
        indent && 'pl-9',
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
      {!!count && <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground">{count}</span>}
    </Link>
  )
}

/** a group of links under a small grey title, with an optional button at its right */
export function NavGroup({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-1 flex items-center px-3 text-[13px] font-medium text-muted-foreground">
        {title}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}
