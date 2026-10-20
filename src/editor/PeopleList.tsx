/** The list under the cursor when you type @ in the editor. */
import { forwardRef, useImperativeHandle, useState } from 'react'
import { PersonAvatar } from '@/components/Avatar'
import { handleOf, type Person } from '@/model/schema'
import { cn } from '@/lib/utils'

export interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}

export const PeopleList = forwardRef<ListHandle, { items: Person[]; command: (p: Person) => void }>(function PeopleList({ items, command }, ref) {
  const [active, setActive] = useState(0)
  const [prevItems, setPrevItems] = useState(items)
  if (prevItems !== items) {
    setPrevItems(items)
    setActive(0)
  }
  useImperativeHandle(ref, () => ({
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
    <div className="w-64 rounded-lg border bg-popover p-1 shadow-lg" role="listbox">
      {items.map((p, i) => (
        <button
          key={p.login}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            e.preventDefault()
            command(p)
          }}
          className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', i === active && 'bg-accent')}
        >
          <PersonAvatar person={p} />
          <span className="truncate">{p.name}</span>
          <span className="ml-auto truncate text-muted-foreground">@{handleOf(p)}</span>
        </button>
      ))}
    </div>
  )
})

