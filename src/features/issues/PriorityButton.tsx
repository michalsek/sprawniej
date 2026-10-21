/**
 * The priority icon on a list row or board card, as a small button that opens the same priority menu as the issue
 * page. A pick saves at once; the issue doesn't open. With several issues picked, a picked one's icon changes all of
 * them. `RowPicker` is the part any property on a row can use: it keeps the menu's presses, touches and keys away from
 * the row (which can be dragged) and puts the focus back on the row afterwards.
 */
import { useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Picker, type PickerItem } from '@/components/Picker'
import { updateIssue, type IssuePatch } from '@/data/actions'
import { useData } from '@/data/store'
import { cn } from '@/lib/utils'
import type { Issue } from '@/model/schema'
import { PRIORITY_NAMES, type Priority } from '@/model/status'
import { PriorityIcon } from './icons'
import { priorityItems } from './pickers'
import { focusRow } from './rowControls'
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
  shortcut?: string
  className?: string
  children: ReactNode
}

export function RowPicker<V>({ issue, items, valueOf, patch, placeholder, name, title, shortcut, className, children }: RowPickerProps<V>) {
  const [open, setOpen] = useState(false)
  // who the menu is for, decided when it opens (picking more issues meanwhile doesn't change it)
  const [ids, setIds] = useState<string[]>([issue.id])
  const issues = useData(useShallow((s) => ids.map((id) => s.issues[id]).filter(Boolean)))
  const values = issues.map(valueOf)
  const shared = values.length > 0 && values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]))
  return (
    <Picker<V | undefined>
      modal
      isolate
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setIds(targetsFor(issue.id, useSelection.getState().ids))
        }
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
      onOpenAutoFocus={(e) => coarse() && e.preventDefault()}
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        focusRow(issue.id)
      }}
    >
      <button
        type="button"
        // the row is the Tab stop; from the keyboard, P on the row opens the same menu
        tabIndex={-1}
        data-row-control
        aria-label={name}
        title={title}
        aria-keyshortcuts={shortcut}
        className={cn(
          // a bigger place to tap on touch screens, without making the row any taller
          'relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-1.25 after:hidden pointer-coarse:after:block',
          className,
        )}
      >
        {children}
      </button>
    </Picker>
  )
}

const priorityPatch = (priority: Priority): IssuePatch => ({ priority })
const priorityOf = (i: Issue) => i.priority as Priority

/** `look`: a plain icon in a row, or the bordered box on a card */
export function PriorityButton({ issue, look }: { issue: Issue; look: 'row' | 'card' }) {
  return (
    <RowPicker
      issue={issue}
      items={priorityItems}
      valueOf={priorityOf}
      patch={priorityPatch}
      placeholder={(n) => (n > 1 ? `Change priority of ${n} issues…` : 'Change priority…')}
      name={`Priority: ${PRIORITY_NAMES[issue.priority as Priority]}`}
      title="Change priority (P)"
      shortcut="P"
      className={look === 'row' ? '-m-1 p-1' : 'h-6 border px-1.5'}
    >
      <PriorityIcon priority={issue.priority as Priority} />
    </RowPicker>
  )
}
