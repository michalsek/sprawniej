/**
 * The side panel's quick filters: a tab per field (Assignees, Labels, Priority, Projects), and a row per value with
 * how many issues it would show. A click picks a row or lets it go. The picking and counting is in
 * src/data/quickFilters.ts.
 *
 * No dialog, menu or listbox roles here: the panel stays open beside the list, and those would turn off the app's
 * keys (src/app/shortcuts.ts, isBusy).
 */
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'wouter'
import { Check, Search, Tag } from 'lucide-react'
import { PersonAvatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { Segmented } from '@/components/Segmented'
import { valueKey } from '@/data/filterTree'
import { isPicked, type QuickCounts, type QuickField, type QuickFilters as Picks } from '@/data/quickFilters'
import { plain } from '@/lib/plain'
import { cn } from '@/lib/utils'
import type { FilterValue } from '@/model/schema'
import { PRIORITY_ORDER } from '@/model/status'
import { Button } from '@/ui/button'
import { priorityItems, useLabelItems, usePeopleItems, useProjectItems } from './pickers'

const TAB_NAMES: Record<QuickField, string> = { assignees: 'Assignees', labels: 'Labels', priorities: 'Priority', projects: 'Projects' }
/** what the find box looks for, past this many rows */
const FIND: Record<QuickField, string> = { assignees: 'Find a person…', labels: 'Find a label…', priorities: 'Find a priority…', projects: 'Find a project…' }
const FIND_FROM = 10

interface Row {
  value: FilterValue
  label: string
  icon?: ReactNode
  count: number
  picked: boolean
}

interface Props {
  /** the tabs this page offers (a page leaves out what it already is) */
  fields: QuickField[]
  tab: QuickField
  onTab: (tab: QuickField) => void
  picks: Picks
  onToggle: (field: QuickField, value: FilterValue) => void
  counts: QuickCounts
  /** issues the list shows now */
  shown: number
  /** the list has issues to filter, quick filters aside */
  any: boolean
}

/** the rows of one tab: values some issue has, and picked ones (even at 0), most issues first */
function useRows(field: QuickField, picks: Picks, counts: QuickCounts): Row[] {
  const people = usePeopleItems()
  const labels = useLabelItems()
  const projects = useProjectItems()
  return useMemo(() => {
    const m = counts[field]
    const items: { value: FilterValue; label: string; icon?: ReactNode }[] =
      field === 'assignees'
        ? people.map((p) => (p.value === null ? { ...p, label: 'No assignee' } : p))
        : field === 'labels'
          ? labels
          : field === 'projects'
            ? projects
            : PRIORITY_ORDER.map((p) => priorityItems.find((i) => i.value === p)!)
    const rows: Row[] = items.map((i) => ({ ...i, count: m.get(valueKey(i.value)) ?? 0, picked: isPicked(picks, field, i.value) }))
    // someone assigned who isn't among the people (yet): their handle
    if (field === 'assignees') {
      const known = new Set(items.map((i) => valueKey(i.value)))
      const others = new Set([...m.keys(), ...(picks.assignees ?? []).map(valueKey)].filter((k) => !known.has(k)))
      for (const k of others) {
        const login = JSON.parse(k) as string
        rows.push({ value: login, label: login, icon: <PersonAvatar login={login} />, count: m.get(k) ?? 0, picked: isPicked(picks, field, login) })
      }
    }
    const shown = rows.filter((r) => r.count > 0 || r.picked)
    if (field === 'priorities') return shown
    return shown.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [field, picks, counts, people, labels, projects])
}

export function QuickFilters({ fields, tab, onTab, picks, onToggle, counts, shown, any }: Props) {
  const here = fields.includes(tab) ? tab : fields[0]
  return (
    <section aria-label="Quick filters" className="flex flex-col gap-3" data-quick-filters>
      <div className="flex flex-col gap-1">
        <h2 className="text-label font-medium text-muted-foreground">Quick filters</h2>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Just for you, until you leave this page. Shows {shown.toLocaleString('en')} {shown === 1 ? 'issue' : 'issues'}.
        </p>
      </div>
      {fields.length > 1 && <Segmented compact fill label="Quick filters by" value={here} onChange={onTab} options={fields.map((f) => ({ value: f, label: TAB_NAMES[f] }))} />}
      {any ? (
        // a new tab starts with its own find box and focus
        <Rows key={here} field={here} picks={picks} counts={counts} onToggle={onToggle} />
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">Nothing to filter yet.</p>
      )}
    </section>
  )
}

function Rows({ field, picks, counts, onToggle }: { field: QuickField; picks: Picks; counts: QuickCounts; onToggle: Props['onToggle'] }) {
  const rows = useRows(field, picks, counts)
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const q = plain(query.trim())
  const found = q ? rows.filter((r) => plain(r.label).includes(q)) : rows
  const focusAt = Math.min(at, Math.max(0, found.length - 1))

  if (!rows.length) {
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
    list.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.length > FIND_FROM && (
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
            type="button"
            aria-pressed={r.picked}
            aria-label={`${r.label}, ${r.count.toLocaleString('en')} ${r.count === 1 ? 'issue' : 'issues'}`}
            title={r.label}
            tabIndex={k === focusAt ? 0 : -1}
            onFocus={() => setAt(k)}
            onClick={() => onToggle(field, r.value)}
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
