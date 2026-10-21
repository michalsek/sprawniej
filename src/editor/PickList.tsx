/** The list under the cursor when you type @ (MentionSuggest.tsx) or / (SlashMenu.tsx). Arrows move, Enter picks, a tap picks. */
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/utils'

export interface PickListHandle<T> {
  onKeyDown: (e: KeyboardEvent) => boolean
  /** the highlighted item */
  current: () => T | undefined
}

/** how one list looks: the rest comes from the suggestion */
export interface ListLook<T> {
  label: string
  /** a width class */
  width: string
  keyOf: (item: T) => string
  row: (item: T) => ReactNode
}

interface Props<T> extends ListLook<T> {
  items: T[]
  command: (item: T) => void
  ref?: Ref<PickListHandle<T>>
}

export function PickList<T>({ items, command, label, width, keyOf, row, ref }: Props<T>) {
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
    <div ref={list} className={cn('max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg', width)} role="listbox" aria-label={label}>
      {items.map((item, i) => (
        <button
          key={keyOf(item)}
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
          {row(item)}
        </button>
      ))}
    </div>
  )
}
