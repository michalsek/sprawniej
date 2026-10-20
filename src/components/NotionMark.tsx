/** A small, plain mark for things that came from Notion (an issue made from a page, its Inbox notes). Grey, like
 * every mark that isn't a status, priority or label. */
import { cn } from '@/lib/utils'

export function NotionMark({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground', className)}
      aria-label="Notion"
      role="img"
    >
      <svg viewBox="0 0 16 16" className="size-[60%]" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <rect x="2" y="2" width="12" height="12" rx="2" />
        <path d="M5.5 11V5l5 6V5" strokeLinecap="round" />
      </svg>
    </span>
  )
}
