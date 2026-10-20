import type { Label } from '@/model/schema'
import { cn } from '@/lib/utils'

/** A label's coloured dot, with a thin edge in Light so pale colours (yellow, pink, white) still show. */
export function LabelDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('size-2 shrink-0 rounded-full', className)} style={{ background: color, boxShadow: 'inset 0 0 0 1px var(--dot-edge)' }} />
}

/** A label as a small pill with a coloured dot. */
export function LabelChip({ label }: { label: Label }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs text-muted-foreground">
      <LabelDot color={label.color} />
      {label.name}
    </span>
  )
}
