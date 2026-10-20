/** The list under the cursor when you type / in the editor (SlashMenu.tsx). Arrows move, Enter picks, a tap picks. */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { SlashItem } from './SlashMenu'

export interface CommandListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
  /** the highlighted item */
  current: () => SlashItem | undefined
}

export const CommandList = forwardRef<CommandListHandle, { items: SlashItem[]; command: (item: SlashItem) => void }>(function CommandList({ items, command }, ref) {
  const [active, setActive] = useState(0)
  const [prevItems, setPrevItems] = useState(items)
  const list = useRef<HTMLDivElement>(null)
  if (prevItems !== items) {
    setPrevItems(items)
    setActive(0)
  }
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])
  useImperativeHandle(ref, () => ({
    current: () => items[active],
    onKeyDown: (e) => {
      if (!items.length) return false
      if (e.key === 'ArrowDown') setActive((a) => (a + 1) % items.length)
      else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + items.length) % items.length)
      else if (e.key === 'Enter' || e.key === 'Tab') command(items[active])
      else return false
      return true
    },
  }))
  if (!items.length) return null
  return (
    <div ref={list} className="max-h-72 w-60 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg" role="listbox" aria-label="Add to the text">
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            // keeps the cursor where it is
            e.preventDefault()
            command(item)
          }}
          // only a pointer that moves picks: one resting where the list opens doesn't
          onMouseMove={() => i !== active && setActive(i)}
          className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', i === active && 'bg-accent')}
        >
          <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{item.title}</span>
          {item.hint && <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
})
