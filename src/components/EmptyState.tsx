/**
 * What an empty list shows: what belongs here, in plain words, and one button to start. `compact` fits one part of
 * a page (a settings part, say): less room around it, a smaller icon, a dashed outline, and an h3 heading.
 */
import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  children,
  action,
  compact = false,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  const Heading = compact ? 'h3' : 'h2'
  return (
    <div
      className={
        compact
          ? 'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center'
          : 'mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-20 text-center'
      }
    >
      {icon && <div className={compact ? 'text-muted-foreground [&_svg]:size-6' : 'text-muted-foreground [&_svg]:size-8'}>{icon}</div>}
      <Heading className={compact ? 'text-sm font-semibold' : 'text-heading font-semibold'}>{title}</Heading>
      {children && <p className="text-sm text-muted-foreground">{children}</p>}
      {action}
    </div>
  )
}
