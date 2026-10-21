/**
 * The side panel's quick filters: a tab per field (Assignees, Labels, Priority, Projects), and a line per value with
 * how many issues it would show. A click picks a line or lets it go. The picking, counting and the order of the lines
 * are in src/data/quickFilters.ts.
 *
 * No dialog, menu or listbox roles here: the panel stays open beside the list, and those would turn off the app's
 * keys (src/app/shortcuts.ts, isBusy).
 */
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'wouter'
import { Check, Search, Tag } from 'lucide-react'
import { useChrome } from '@/app/chrome'
import { PersonAvatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { Segmented } from '@/components/Segmented'
import { valueKey } from '@/data/filterTree'
import { panelLines, type PanelField, type QuickCounts, type QuickFilters as Picks } from '@/data/quickFilters'
import { plain } from '@/lib/plain'
import { cn } from '@/lib/utils'
import type { FilterValue } from '@/model/schema'
import { Button } from '@/ui/button'
import { priorityItems, useLabelItems, usePeopleItems, useProjectItems } from './pickers'

const TAB_NAMES: Record<PanelField, string> = { assignees: 'Assignees', labels: 'Labels', priorities: 'Priority', projects: 'Projects' }
/** what the find box looks for, past this many lines */
const FIND: Record<PanelField, string> = { assignees: 'Find a person…', labels: 'Find a label…', priorities: 'Find a priority…', projects: 'Find a project…' }
const FIND_FROM = 10

interface Item {
  value: FilterValue
  label: string
  icon?: ReactNode
}

interface Props {
  /** the tabs this page offers (a page leaves out what it already is) */
  fields: PanelField[]
  picks: Picks
  onToggle: (field: PanelField, value: FilterValue) => void
  counts: QuickCounts
  /** issues the list shows now */
  shown: number
  /** the list has issues to filter, quick filters aside */
  any: boolean
}

/** the lines of one tab (src/data/quickFilters.ts, panelLines) */
function useLines(field: PanelField, picks: Picks, counts: QuickCounts) {
  const people = usePeopleItems()
  const labels = useLabelItems()
  const projects = useProjectItems()
  return useMemo(() => {
    const items: Item[] =
      field === 'assignees' ? people.map((p) => (p.value === null ? { ...p, label: 'No assignee' } : p)) : field === 'labels' ? labels : field === 'projects' ? projects : priorityItems
    // someone assigned who isn't among the people (yet): their handle
    return panelLines<Item>(field, items, counts, picks, (login) => ({ value: login, label: login, icon: <PersonAvatar login={login} /> }))
  }, [field, picks, counts, people, labels, projects])
}

export function QuickFilters({ fields, picks, onToggle, counts, shown, any }: Props) {
  // the tab is read here, so switching it doesn't draw the list again
  const tab = useChrome((s) => s.panelTab)
  const here = fields.includes(tab) ? tab : fields[0]
  return (
    <section aria-label="Quick filters" className="flex flex-col gap-3" data-quick-filters>
      <div className="flex flex-col gap-1">
        <h2 className="text-label font-medium text-muted-foreground">Quick filters</h2>
        <p className="text-sm text-muted-foreground">
          Just for you, until you close this browser tab. Shows {shown.toLocaleString('en')} {shown === 1 ? 'issue' : 'issues'}.
        </p>
      </div>
      {fields.length > 1 && (
        <Segmented
          compact
          fill
          label="Quick filters by"
          value={here}
          onChange={(panelTab) => useChrome.setState({ panelTab })}
          options={fields.map((f) => ({ value: f, label: TAB_NAMES[f] }))}
        />
      )}
      {any ? (
        // a new tab starts with its own find box and focus
        <Lines key={here} field={here} picks={picks} counts={counts} onToggle={onToggle} />
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">Nothing to filter yet.</p>
      )}
    </section>
  )
}

function Lines({ field, picks, counts, onToggle }: { field: PanelField; picks: Picks; counts: QuickCounts; onToggle: Props['onToggle'] }) {
  const lines = useLines(field, picks, counts)
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const q = plain(query.trim())
  const found = q ? lines.filter((r) => plain(r.label).includes(q)) : lines
  const focusAt = Math.min(at, Math.max(0, found.length - 1))
  const buttons = () => [...(list.current?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])]

  if (!lines.length) {
    return field === 'labels' ? (
      <EmptyState
        compact
        icon={<Tag />}
        title="No labels on these issues"
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/workspace/labels">Labels in Settings</Link>
          </Button>
        }
      >
        Labels sort issues into kinds, like Bug or Design. Add them in Settings, then give them to issues.
      </EmptyState>
    ) : (
      <p className="py-4 text-center text-sm text-muted-foreground">Nothing to filter yet.</p>
    )
  }

  const move = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
    const to = e.key === 'ArrowDown' ? k + 1 : e.key === 'ArrowUp' ? k - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? found.length - 1 : null
    if (to === null) return
    // ↑ ↓ Home End are ours here, not the issue list's (src/app/shortcuts.ts)
    e.preventDefault()
    e.stopPropagation()
    const next = Math.max(0, Math.min(found.length - 1, to))
    setAt(next)
    buttons()[next]?.focus()
  }

  const toggle = (k: number) => {
    const l = found[k]
    onToggle(field, l.value)
    // a picked line at 0 goes away when let go: the focus moves on to the line after it (or the one before, at the end)
    if (l.picked && l.count === 0) {
      const next = Math.min(k, found.length - 2)
      setAt(Math.max(0, next))
      requestAnimationFrame(() => buttons()[next]?.focus())
      return
    }
    // picked lines come first, so the line may move; moving it can drop the focus, which stays with it
    const key = valueKey(l.value)
    const had = list.current?.contains(document.activeElement)
    requestAnimationFrame(() => {
      if (had && !list.current?.contains(document.activeElement)) buttons().find((b) => b.dataset.key === key)?.focus()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {lines.length > FIND_FROM && (
        <label className="flex h-9 items-center gap-2 rounded-lg border px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-4 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setAt(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                e.stopPropagation()
                setQuery('')
              }
            }}
            placeholder={FIND[field]}
            aria-label={FIND[field].replace('…', '')}
            className="min-w-0 flex-1 bg-transparent text-field text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </label>
      )}
      <div ref={list} role="group" aria-label={TAB_NAMES[field]} className="-mx-1 flex flex-col">
        {found.map((r, k) => (
          <button
            key={valueKey(r.value)}
            data-key={valueKey(r.value)}
            type="button"
            aria-pressed={r.picked}
            aria-label={`${r.label}, ${r.count.toLocaleString('en')} ${r.count === 1 ? 'issue' : 'issues'}`}
            title={r.label}
            tabIndex={k === focusAt ? 0 : -1}
            onFocus={() => setAt(k)}
            onClick={() => toggle(k)}
            onKeyDown={(e) => move(e, k)}
            className={cn(
              'flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-2 text-left text-ui hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              r.picked && 'bg-accent hover:bg-accent',
              r.picked && r.count === 0 && 'text-muted-foreground',
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-4">{r.icon}</span>
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            {r.picked && <Check className="size-4 shrink-0 text-foreground" aria-hidden />}
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{r.count.toLocaleString('en')}</span>
          </button>
        ))}
        {!found.length && <p className="px-2 py-3 text-sm text-muted-foreground">Nothing matches “{query.trim()}”.</p>}
      </div>
    </div>
  )
}
