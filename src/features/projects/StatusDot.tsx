/** A project status's dot, in the status's own colour (painted like issue statuses: paintColor). */
import type { Status } from '@/model/schema'
import { paintColor } from '@/model/status'
import { cn } from '@/lib/utils'

export function StatusDot({ status, className }: { status: Pick<Status, 'kind' | 'category' | 'color'>; className?: string }) {
  return <span className={cn('size-2.5 shrink-0 rounded-full', className)} style={{ background: paintColor(status) }} />
}
