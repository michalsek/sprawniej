/**
 * The @handle field (picking one at the start, changing it in Settings): the @ in front, no spell check, and the
 * usual red border when `aria-invalid` is set. Point `aria-describedby` at the hint or problem shown under it.
 */
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function HandleInput({ className, ...input }: ComponentProps<'input'>) {
  return (
    <div
      className={cn(
        'flex h-10 overflow-hidden rounded-md border bg-input/30 text-field focus-within:ring-2 focus-within:ring-ring',
        'has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-destructive',
        className,
      )}
    >
      <span className="flex items-center border-r bg-muted px-3 text-muted-foreground select-none" aria-hidden>
        @
      </span>
      <input className="min-w-0 flex-1 bg-transparent px-3 outline-none" spellCheck={false} {...input} />
    </div>
  )
}
