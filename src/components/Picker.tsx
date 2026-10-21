/**
 * A searchable menu for picking one value (status, assignee…) or several (labels). It opens from any trigger,
 * filters as you type, works with the keyboard, and can offer "Create …" for what doesn't exist yet.
 * The open state can be controlled from outside, so keyboard shortcuts can open a picker too.
 */
import { useRef, useState, type ReactNode } from 'react'
import { Check, Plus } from 'lucide-react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { cn } from '@/lib/utils'
import { searchItems } from './pickerSearch'

export interface PickerItem<V> {
  value: V
  label: string
  icon?: ReactNode
  /** extra words to match when searching (e.g. a handle) */
  keywords?: string[]
  hint?: string
}

interface Common<V> {
  items: PickerItem<V>[]
  placeholder: string
  children: ReactNode
  /** create something new from the typed text (e.g. a label) */
  onCreate?: (text: string) => void
  createLabel?: (text: string) => string
  align?: 'start' | 'center' | 'end'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** the trigger is not a button of its own (it's wrapped) */
  asChild?: boolean
  /** a click outside only closes the menu (it doesn't also reach what's under it) */
  modal?: boolean
  /**
   * presses, touches and keys inside the menu stay in it: the menu is drawn elsewhere on the page but its events
   * still pass through the trigger's parents (a row that can be dragged would start a drag)
   */
  isolate?: boolean
  /**
   * asked as the menu opens: true puts the focus on the list rather than the search box (on a touch screen, so no
   * on-screen keyboard comes up; screen readers and a tablet's keyboard still land in the menu)
   */
  focusList?: () => boolean
  onCloseAutoFocus?: (e: Event) => void
}

type Props<V> = Common<V> & ({ multiple?: false; value: V; onSelect: (v: V) => void } | { multiple: true; value: V[]; onSelect: (v: V[]) => void })

/** an item's key: it keeps items apart in the menu, and is never searched (a hidden login) */
const keyOf = (v: unknown) => JSON.stringify(v)

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

export function Picker<V>(props: Props<V>) {
  const { items, placeholder, children, onCreate, createLabel, align = 'start', asChild = true, modal, isolate, focusList, onCloseAutoFocus } = props
  const list = useRef<HTMLDivElement>(null)
  const [ownOpen, setOwnOpen] = useState(false)
  const [query, setQuery] = useState('')
  const open = props.open ?? ownOpen
  const setOpen = (o: boolean) => {
    if (!o) setQuery('')
    setOwnOpen(o)
    props.onOpenChange?.(o)
  }
  const chosen = new Set(props.multiple ? props.value.map(keyOf) : [keyOf(props.value)])
  const exact = items.some((i) => i.label.toLowerCase() === query.trim().toLowerCase())

  function pick(v: V) {
    if (props.multiple) {
      const k = keyOf(v)
      props.onSelect(chosen.has(k) ? props.value.filter((x) => keyOf(x) !== k) : [...props.value, v])
    } else {
      props.onSelect(v)
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild={asChild}>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-64 p-0"
        onClick={(e) => e.stopPropagation()}
        {...(isolate && { onPointerDown: stop, onMouseDown: stop, onTouchStart: stop, onKeyDown: stop })}
        onOpenAutoFocus={(e) => {
          if (!focusList?.()) return
          e.preventDefault()
          list.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <Command shouldFilter={false} ref={list} tabIndex={-1} className="outline-none">
          <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{onCreate ? 'Nothing yet. Type a name to create it.' : 'Nothing found.'}</CommandEmpty>
            <CommandGroup>
              {searchItems(items, query).map((i) => (
                <CommandItem key={keyOf(i.value)} value={keyOf(i.value)} onSelect={() => pick(i.value)}>
                  {i.icon}
                  <span className="truncate">{i.label}</span>
                  {i.hint && <span className="ml-auto truncate text-xs text-muted-foreground">{i.hint}</span>}
                  <Check className={cn('ml-auto size-4', !chosen.has(keyOf(i.value)) && 'invisible', i.hint && 'ml-2')} />
                </CommandItem>
              ))}
              {onCreate && query.trim() && !exact && (
                <CommandItem
                  value={`create ${query}`}
                  onSelect={() => {
                    onCreate(query.trim())
                    setQuery('')
                  }}
                >
                  <Plus />
                  {createLabel ? createLabel(query.trim()) : `Create “${query.trim()}”`}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
