/** "2/5" with a checklist mark on a row or card: ticked items of the description's checklists. Hidden when it has none. */
import { useMemo } from 'react'
import { ListChecks } from 'lucide-react'
import { checklistCount } from '@/data/checklist'
import { cn } from '@/lib/utils'

export function ChecklistCount({ description, className }: { description: string; className?: string }) {
  // counted again only when the text changes: lists show many rows
  const count = useMemo(() => checklistCount(description), [description])
  if (!count) return null
  const words = `${count.done} of ${count.total} checklist items done`
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs leading-5 text-muted-foreground tabular-nums', className)} title={words}>
      <ListChecks className="size-3.5" aria-hidden />
      <span aria-hidden>
        {count.done}/{count.total}
      </span>
      <span className="sr-only">{words}</span>
    </span>
  )
}
