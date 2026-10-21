/** Page tabs that are links (Active / Backlog / All issues), styled as outlined buttons. */
import { Link } from 'wouter'
import { cn } from '@/lib/utils'

export function LinkTabs({ tabs, current }: { tabs: { href: string; label: string }[]; current: string }) {
  return (
    <nav className="flex max-w-full gap-1.5 overflow-x-auto sm:gap-2">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            'flex h-10 shrink-0 items-center rounded-lg border px-3 text-ui whitespace-nowrap text-muted-foreground hover:bg-accent/60 hover:text-foreground sm:px-4',
            t.href === current && 'border-foreground/80 bg-accent text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
