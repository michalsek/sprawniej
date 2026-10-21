/**
 * The priority icon on a list row or board card, as a small button that opens the same priority menu as the issue
 * page. A pick saves at once; the issue doesn't open. With several issues picked, a picked one's icon changes all of
 * them. `RowPicker` is the part any property on a row can use: it keeps the menu's presses, touches and keys away from
 * the row (which can be dragged) and puts the focus back on the row afterwards.
 */
import { useState, type ComponentProps, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useBackend } from '@/backend'
import { useAuth } from '@/backend/auth'
import { Picker, type PickerItem } from '@/components/Picker'
import { updateIssue, type IssuePatch } from '@/data/actions'
import { useData } from '@/data/store'
import { cn } from '@/lib/utils'
import type { Issue } from '@/model/schema'
import { PRIORITY_NAMES, type Priority } from '@/model/status'
import { PriorityIcon } from './icons'
import { priorityItems } from './pickers'
import { rowReturn } from './rowControls'
import { targetsFor, useSelection } from './selection'

/** a phone or tablet: the menu opens without putting the cursor in its search box (no on-screen keyboard) */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

interface RowPickerProps<V> {
  issue: Issue
  items: PickerItem<V>[]
  /** what an issue has now */
  valueOf: (issue: Issue) => V
  /** the change that gives an issue the picked value */
  patch: (value: V) => IssuePatch
  /** the search box's hint, for how many issues the menu changes */
  placeholder: (count: number) => string
  /** the button's name for screen readers ("Priority: High") */
  name: string
  title: string
  className?: string
  children: ReactNode
}

export function RowPicker<V>(props: RowPickerProps<V>) {
  // the menu is only made once it's first opened: a list of hundreds of issues has one of these per row
  const [made, setMade] = useState(false)
  if (made) return <RowMenu {...props} />
  // the first click makes the menu, open (a ⌘ or Shift click picked the row instead: nothing opens, as later)
  return (
    <RowButton name={props.name} title={props.title} className={props.className} onClick={(e) => !e.defaultPrevented && setMade(true)}>
      {props.children}
    </RowButton>
  )
}

type Look = Pick<RowPickerProps<unknown>, 'name' | 'title' | 'className' | 'children'>

/** the trigger: Radix passes its ref, open state and click handler through `rest` */
function RowButton({ name, className, children, ...rest }: Look & Omit<ComponentProps<'button'>, 'name'>) {
  return (
    <button
      {...rest}
      type="button"
      // the row is the Tab stop; from the keyboard, P on the row opens the same menu
      tabIndex={-1}
      data-row-control
      aria-label={name}
      className={cn(
        // a bigger place to tap on touch screens, without making the row any taller
        'relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-1.25 after:hidden pointer-coarse:after:block',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** made by the first click, so it starts open */
function RowMenu<V>({ issue, items, valueOf, patch, placeholder, name, title, className, children }: RowPickerProps<V>) {
  // who the menu is for, decided when it opens (picking more issues meanwhile doesn't change it), and where focus goes
  // back to when it closes
  const opening = () => ({ ids: targetsFor(issue.id, useSelection.getState().ids), back: rowReturn(issue.id) })
  const [open, setOpen] = useState(true)
  const [round, setRound] = useState(opening)
  const issues = useData(useShallow((s) => round.ids.map((id) => s.issues[id]).filter(Boolean)))
  // a question that blocks everything (signed out, no longer in the workspace) closes the menu
  const gone = useBackend((s) => s.phase === 'gone')
  const signedIn = useAuth((s) => !!s.user)
  const values = issues.map(valueOf)
  const shared = values.length > 0 && values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]))
  return (
    <Picker<V | undefined>
      modal
      isolate
      open={open && !gone && signedIn}
      onOpenChange={(o) => {
        if (o) setRound(opening())
        setOpen(o)
      }}
      items={items}
      // several issues with different values: nothing is ticked
      value={shared ? values[0] : undefined}
      onSelect={(v) => {
        if (v === undefined) return
        for (const i of issues) updateIssue(i.id, patch(v))
      }}
      placeholder={placeholder(issues.length)}
      focusList={coarse}
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        round.back()
      }}
    >
      <RowButton name={name} title={title} className={className}>
        {children}
      </RowButton>
    </Picker>
  )
}

const priorityPatch = (priority: Priority): IssuePatch => ({ priority })
const priorityOf = (i: Issue) => i.priority

/** `look`: a plain icon in a row, or the bordered box on a card */
export function PriorityButton({ issue, look }: { issue: Issue; look: 'row' | 'card' }) {
  return (
    <RowPicker
      issue={issue}
      items={priorityItems}
      valueOf={priorityOf}
      patch={priorityPatch}
      placeholder={(n) => (n > 1 ? `Change priority of ${n} issues…` : 'Change priority…')}
      name={issue.priority ? `Priority: ${PRIORITY_NAMES[issue.priority]}` : PRIORITY_NAMES[0]}
      title="Change priority (P)"
      className={look === 'row' ? '-m-1 p-1' : 'h-6 border px-1.5'}
    >
      <PriorityIcon priority={issue.priority} />
    </RowPicker>
  )
}
