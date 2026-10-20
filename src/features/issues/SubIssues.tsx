/**
 * An issue's sub-issues, with a row to add more right there: type a title, press Enter, type the next one.
 * New sub-issues join the parent's team and project.
 */
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Plus } from 'lucide-react'
import { createIssue } from '@/data/actions'
import { useData } from '@/data/store'
import type { Issue } from '@/model/schema'
import { Button } from '@/ui/button'
import { openComposer } from './composer'
import { IssueStatusIcon } from './icons'
import { IssueRow } from './IssueList'
import { SubIssueCount } from './SubIssueCount'

/** a new sub-issue starts in Todo's default status */
const NEW = { status: 'todo', statusId: '' } as const

function AddRow({ parent, onClose }: { parent: Issue; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const add = () => {
    if (!title.trim()) return
    createIssue({ team: parent.team, title, parent: parent.id, project: parent.project })
    setTitle('')
  }
  return (
    <div className="flex h-10 items-center gap-3 px-4">
      <IssueStatusIcon issue={NEW} />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        onBlur={() => !title.trim() && onClose()}
        placeholder="Sub-issue title, then Enter"
        aria-label="New sub-issue title"
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
      />
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        // keep the field from closing before the click lands
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          openComposer({ team: parent.team, parent: parent.id, project: parent.project, title })
          onClose()
        }}
      >
        More options
      </Button>
    </div>
  )
}

export function SubIssues({ issue }: { issue: Issue }) {
  // sorted inside the selector: sorting its result in place would change the store's cached answer and loop
  const children = useData(useShallow((s) => Object.values(s.issues).filter((i) => i.parent === issue.id).sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1))))
  const [adding, setAdding] = useState(false)

  if (!children.length && !adding) {
    return (
      <Button variant="ghost" size="sm" className="mt-6 -ml-2 text-muted-foreground" onClick={() => setAdding(true)}>
        <Plus /> Add sub-issues
      </Button>
    )
  }
  return (
    <section className="mt-10">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Sub-issues</h2>
        <SubIssueCount id={issue.id} />
        <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label="Add a sub-issue" onClick={() => setAdding(true)}>
          <Plus />
        </Button>
      </div>
      <div className="rounded-lg border py-1">
        {children.map((c) => (
          <IssueRow key={c.id} issue={c} />
        ))}
        {adding && <AddRow parent={issue} onClose={() => setAdding(false)} />}
      </div>
    </section>
  )
}
