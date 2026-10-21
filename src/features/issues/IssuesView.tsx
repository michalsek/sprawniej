/**
 * A set of issues with a toolbar: optional tabs on the left; Filter, Display and List / Board on the right; the
 * active filters below; the side panel on the right (the page's details and quick filters). The page decides the
 * fixed part (`filters`, e.g. this team). What a person filters on top stays on this page until they leave, or, on a
 * saved view, is saved into the view. Quick filters are just for the person, even on a view, until they leave.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Columns3, Layers, List, ListPlus, Plus, SearchX, SquareStack } from 'lucide-react'
import { toast } from 'sonner'
import { openPanel, useChrome, usePanelBeside } from '@/app/chrome'
import { EmptyState } from '@/components/EmptyState'
import { Segmented } from '@/components/Segmented'
import { useDisplay } from '@/data/displays'
import { FLAT_FIELDS, countConditions, matcher, movesWithClock, presetFrom, treeOf, viewFilters } from '@/data/filterTree'
import { useNow } from '@/lib/useNow'
import { QUICK_FIELDS, hasQuick, quickTree, splitAndCount, toggleQuick, withQuick, withoutGone, type QuickFilters as Picks } from '@/data/quickFilters'
import { displayKeeps, groupIssues, inTab } from '@/data/select'
import { useData } from '@/data/store'
import type { Display, FilterField, FilterValue, Filters } from '@/model/schema'
import type { IssueTab } from '@/model/status'
import { Button } from '@/ui/button'
import { NewViewDialog } from '@/features/views/NewViewDialog'
import { DisplayOptions } from './DisplayOptions'
import { FilterButton, FilterSummary } from './FilterBar'
import { FilterBuilder } from './FilterBuilder'
import { IssueBoard } from './IssueBoard'
import { IssueList } from './IssueList'
import { QuickFilters } from './QuickFilters'
import { SidePanel } from './SidePanel'
import { openComposer } from './composer'
import type { Group } from '@/data/select'
import type { NewIssue } from '@/data/actions'

/** nothing picked (one object, so it doesn't count as a change) */
const NO_PICKS: Picks = {}

interface Props {
  /** key for remembering List/Board and other display choices */
  page: string
  /** what the page always shows (this team, this project) */
  filters: Filters
  tab?: IssueTab
  baseDisplay?: Partial<Display>
  left?: ReactNode
  /** above the toolbar (a view's or project's name and details) */
  header?: ReactNode
  empty?: ReactNode
  /** filter fields the page decides already */
  hideFilters?: FilterField[]
  /** a saved view: its filters and display live in the view, for everyone */
  saved?: { filters: Filters; display: Display; onFilters: (f: Filters) => void; onDisplay: (patch: Partial<Display>) => void }
  /** where "Save as view" puts a new view (null = the whole workspace); leave out to not offer it */
  viewScope?: string | null
  /** the top of the side panel: what this page is (PageDetails.tsx) */
  details?: ReactNode
}

export function IssuesView({ page, filters, tab = 'all', baseDisplay, left, header, empty, hideFilters, saved, viewScope, details }: Props) {
  const mine = useDisplay(page, baseDisplay)
  const display = saved?.display ?? mine.display
  const setDisplay = saved?.onDisplay ?? mine.setDisplay
  const [ownFilters, setOwnFilters] = useState<Filters>({})
  const extra = saved?.filters ?? ownFilters
  const setExtra = saved?.onFilters ?? setOwnFilters
  const ownTree = useMemo(() => treeOf(extra), [extra])
  const count = countConditions(ownTree)
  const filtering = count > 0
  // quick filters stay while the page's filters do (Active and All of one team), and start again on another team
  const scope = JSON.stringify(filters)
  const [quick, setQuick] = useState<{ scope: string; picks: Picks }>({ scope, picks: {} })
  const labels = useData((s) => s.labels)
  const projectsById = useData((s) => s.projects)
  // another team: start again (and coming back doesn't bring the old picks back)
  if (quick.scope !== scope) setQuick({ scope, picks: NO_PICKS })
  const ownPicks = quick.scope === scope ? quick.picks : NO_PICKS
  // a label or project a teammate deleted comes out
  const picks = useMemo(
    () => withoutGone(ownPicks, (f, v) => (f === 'labels' ? !!labels[v as string] : f === 'projects' ? v === null || !!projectsById[v as string] : true)),
    [ownPicks, labels, projectsById],
  )
  const setPicks = (next: Picks) => setQuick({ scope, picks: next })
  const quickOn = hasQuick(picks)
  const quickFields = QUICK_FIELDS.filter((f) => !hideFilters?.includes(f))
  const panelTab = useChrome((s) => s.panelTab)
  const beside = usePanelBeside()
  // the top bar's toggle and `]` work on this page
  useEffect(() => {
    useChrome.setState({ panelHere: true })
    return () => {
      useChrome.setState({ panelHere: false })
    }
  }, [])
  // the builder hangs from what opened it: the summary chip, or the Filter button (then with its field menu open
  // when there's no filter yet)
  const [builder, setBuilder] = useState({ open: false, at: 'button' as 'chip' | 'button', menu: false })
  const chip = useRef<HTMLButtonElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const anchor = useMemo(
    () => ({
      get current(): HTMLElement {
        // before the button is there anything will do: the builder can't be open yet
        return (builder.at === 'chip' && chip.current) || button.current || document.body
      },
    }),
    [builder.at],
  )
  const openBuilder = (at: 'chip' | 'button') => setBuilder({ open: true, at, menu: at === 'button' && !filtering })
  const toggleBuilder = (at: 'chip' | 'button') => (builder.open ? setBuilder((b) => ({ ...b, open: false })) : openBuilder(at))
  const [saving, setSaving] = useState(false)

  const all = useData(useShallow((s) => Object.values(s.issues)))
  const people = useData((s) => s.people)
  const comments = useData((s) => s.comments)
  const projects = useData((s) => s.projects)
  const statuses = useData((s) => s.statuses)
  const me = useData((s) => s.me?.login)
  // issues dropped on the board into a hidden column (Done on Active, another project on a project page) stay in view
  // until you leave
  const [keptOn, setKept] = useState<{ page: string; tab: string; ids: ReadonlySet<string> }>({ page, tab, ids: new Set() })
  const kept = useMemo(() => (keptOn.page === page && keptOn.tab === tab ? keptOn.ids : new Set<string>()), [keptOn, page, tab])
  const keep = (ids: string[]) => setKept({ page, tab, ids: new Set([...kept, ...ids]) })
  // (whatever the page's filters say: a dropped card lands in its new column, never vanishes)
  const pageTree = useMemo(() => treeOf(filters), [filters])
  // "in the last hour" and "overdue" move with the clock: while a filter says such a thing, the list is worked out
  // again every minute
  const minute = useNow(60_000, movesWithClock(pageTree) || movesWithClock(ownTree))
  const base = useMemo(() => {
    // one moment for the whole list
    const ctx = { comments, people, projects, statuses, me, now: new Date(minute) }
    const fits = matcher(pageTree, ctx)
    const own = matcher(ownTree, ctx)
    return all.filter((i) => kept.has(i.id) || (fits(i) && own(i) && inTab(i, tab)))
  }, [all, pageTree, ownTree, tab, kept, comments, people, projects, statuses, me, minute])
  // then the quick filters, and how many issues each of their rows would show (counted as the display shows them)
  const { shown, counts } = useMemo(() => splitAndCount(base, picks, displayKeeps(display, kept), kept), [base, picks, display, kept])
  const board = display.layout === 'board'
  // on a team's page, a board offers only that team's projects as places to drop
  const team = filters.teams?.length === 1 ? filters.teams[0] : undefined
  const groups = useMemo(() => groupIssues(shown, display, { people, projects, statuses, team, keep: kept }, tab, board), [shown, display, people, projects, statuses, tab, board, team, kept])
  const visible = groups.reduce((n, g) => n + (g.outside ? 0 : g.issues.length), 0)

  /** every filter goes, except the ones the page decides; on a view (everyone's) there's a way back */
  const clear = () => {
    const before = extra
    setExtra(Object.fromEntries(FLAT_FIELDS.filter((k) => hideFilters?.includes(k) && extra[k]).map((k) => [k, extra[k]])))
    if (saved) toast('Filters cleared', { action: { label: 'Undo', onClick: () => saved.onFilters(before) } })
  }

  /** quick filters go, the rest stays */
  const clearQuick = () => setPicks({})

  /** on a view: the quick filters become part of it, for everyone (with a way back) */
  const addToView = () => {
    if (!saved) return
    const before = { filters: extra, picks }
    saved.onFilters(withQuick(extra, picks))
    clearQuick()
    toast('Added to the view', {
      action: {
        label: 'Undo',
        onClick: () => {
          saved.onFilters(before.filters)
          setPicks(before.picks)
        },
      },
    })
  }

  /** the quick filter chip: show the panel, on the tab of something picked */
  const showQuick = () => {
    const first = quickFields.find((f) => picks[f]?.length)
    openPanel(first && !picks[panelTab]?.length ? first : undefined)
    // beside the list, straight to the first picked row
    if (beside) setTimeout(() => document.querySelector<HTMLElement>('[data-quick-filters] [aria-pressed="true"]')?.focus())
  }

  /** "+" on a group: a new issue that already belongs in that group (and on this page) */
  const addTo = (g: Group) => {
    const preset: Partial<NewIssue> = {}
    const both = { ...presetFrom(ownTree, me), ...filters }
    // one picked quick value says what the new issue has; picked labels all go on it
    const one = (f: 'assignees' | 'projects' | 'priorities'): FilterValue | undefined => (picks[f]?.length === 1 ? picks[f][0] : undefined)
    const labelIds = [...new Set([...(both.labels ?? []), ...((picks.labels ?? []) as string[])])]
    if (both.teams?.length === 1) preset.team = both.teams[0]
    if (both.projects?.length === 1 && both.projects[0]) preset.project = both.projects[0]
    if (one('projects') !== undefined) preset.project = one('projects') as string | null
    if (labelIds.length) preset.labels = labelIds
    if (both.assignees?.length === 1) preset.assignee = both.assignees[0]
    if (one('assignees') !== undefined) preset.assignee = one('assignees') as string | null
    if (one('priorities') !== undefined) preset.priority = one('priorities') as NewIssue['priority']
    if (display.grouping === 'status' && typeof g.value === 'string') preset.statusId = g.value
    if (display.grouping === 'priority' && typeof g.value === 'number') preset.priority = g.value as NewIssue['priority']
    if (display.grouping === 'assignee') preset.assignee = g.value as string | null
    if (display.grouping === 'project') preset.project = g.value as string | null
    openComposer(preset)
  }

  const saveAsView =
    viewScope !== undefined && !saved && (filtering || quickOn) ? (
      <Button variant="outline" size="sm" onClick={() => setSaving(true)}>
        <Layers /> Save as view
      </Button>
    ) : undefined

  return (
    // a row: the list, and room beside it for a side panel
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-4 md:px-8 pt-6">
        {header}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          {left}
          <div className="ml-auto flex items-center gap-2">
            <FilterButton ref={button} count={count} open={builder.open && builder.at === 'button'} onClick={() => toggleBuilder('button')} />
            <DisplayOptions display={display} onChange={setDisplay} onReset={saved ? undefined : mine.resetDisplay} tab={tab} />
            <Segmented
              tour="layout"
              label="Layout"
              value={display.layout}
              onChange={(layout) => setDisplay({ layout })}
              options={[
                { value: 'list', name: 'List', label: <><List /> <span className="hidden sm:inline">List</span></> },
                { value: 'board', name: 'Board', label: <><Columns3 /> <span className="hidden sm:inline">Board</span></> },
              ]}
            />
          </div>
        </div>
        {filtering && (
          <FilterSummary
            ref={chip}
            tree={ownTree}
            open={builder.open && builder.at === 'chip'}
            onOpen={() => toggleBuilder('chip')}
            onClear={clear}
            extra={saveAsView}
          />
        )}
        {quickOn && (
          <FilterSummary
            tree={quickTree(picks)}
            kind={{ name: 'Quick filter', open: 'Show in the side panel', clear: 'Clear quick filters' }}
            popup={!beside}
            open={false}
            onOpen={showQuick}
            onClear={clearQuick}
            extra={
              saved ? (
                <Button variant="outline" size="sm" onClick={addToView}>
                  <ListPlus /> Add to view
                </Button>
              ) : filtering ? undefined : (
                saveAsView
              )
            }
          />
        )}
        <FilterBuilder
          filters={extra}
          onChange={setExtra}
          hide={hideFilters}
          open={builder.open}
          setOpen={(open) => setBuilder((b) => ({ ...b, open }))}
          anchor={anchor}
          align={builder.at === 'chip' && filtering ? 'start' : 'end'}
          triggers={builder.at === 'chip' ? [chip, button] : [button, chip]}
          shown={visible}
          startWithMenu={builder.menu}
        />
        {base.length === 0 || (quickOn && visible === 0) ? (
          base.length > 0 ? (
            <EmptyState
              icon={<SearchX />}
              title="No issues match these filters"
              action={
                <Button variant="outline" onClick={clearQuick}>
                  Clear quick filters
                </Button>
              }
            >
              Pick other rows in the side panel, or fewer of them.
            </EmptyState>
          ) : filtering ? (
            <EmptyState
              icon={<SearchX />}
              title="No issues match these filters"
              action={
                <Button variant="outline" onClick={clear}>
                  Clear filters
                </Button>
              }
            >
              Try fewer filters, or switch a group to “or”.
            </EmptyState>
          ) : (
            (empty ?? (
              <EmptyState
                icon={<SquareStack />}
                title="No issues here yet"
                action={
                  <Button variant="outline" onClick={() => openComposer()}>
                    <Plus /> New issue
                  </Button>
                }
              >
                Issues that fit this page show up here by themselves.
              </EmptyState>
            ))
          )
        ) : display.layout === 'list' ? (
          <div className="min-h-0 flex-1 overflow-y-auto pb-8" data-tour="issues">
            <IssueList groups={groups} display={display} onAdd={addTo} />
          </div>
        ) : (
          <div className="min-h-0 flex-1" data-tour="issues">
            <IssueBoard groups={groups} display={display} onAdd={addTo} onDrop={keep} />
          </div>
        )}
        {saving && (
          <NewViewDialog
            open
            onOpenChange={(o) => !o && setSaving(false)}
            preset={{ team: viewScope ?? null, filters: viewFilters(filters, withQuick(extra, picks), tab), display }}
            onCreated={() => {
              setOwnFilters({})
              clearQuick()
            }}
          />
        )}
      </div>
      <SidePanel shown={visible}>
        {details}
        <QuickFilters
          fields={quickFields}
          tab={panelTab}
          onTab={(panelTab) => useChrome.setState({ panelTab })}
          picks={picks}
          onToggle={(f, v) => setPicks(toggleQuick(picks, f, v))}
          counts={counts}
          shown={visible}
          any={base.some(displayKeeps(display, kept))}
        />
      </SidePanel>
    </div>
  )
}
