/**
 * "Display": how a page groups and orders its issues, and what it leaves out. Choices are remembered per page in
 * this browser (src/data/displays.ts) and apply at once.
 */
import { useId, useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { propertiesOf, withProperty } from '@/data/displays'
import { DISPLAY_PROPERTIES, type Display, type DisplayProperty, type Grouping, type Ordering } from '@/model/schema'
import type { IssueTab } from '@/model/status'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Switch } from '@/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { useSelection } from './selection'

const GROUPING_NAMES: Record<Grouping, string> = { status: 'Status', assignee: 'Assignee', priority: 'Priority', project: 'Project', none: 'No grouping' }
const ORDERING_NAMES: Record<Ordering, string> = { manual: 'Manual', priority: 'Priority', due: 'Due date', updated: 'Last updated', created: 'Newest first' }
const PROPERTY_NAMES: Record<DisplayProperty, string> = {
  id: 'ID',
  priority: 'Priority',
  assignee: 'Assignee',
  labels: 'Labels',
  project: 'Project',
  dueDate: 'Due date',
  estimate: 'Estimate',
  created: 'Created',
  progress: 'Progress',
}
const PROPERTY_HINTS: Partial<Record<DisplayProperty, string>> = { progress: 'Sub-issues done and boxes ticked' }

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

interface Props {
  display: Display
  onChange: (patch: Partial<Display>) => void
  onReset?: () => void
  tab: IssueTab
  /** what the page always shows the same (a project's page: its project), so there's no switch for it */
  locked?: readonly DisplayProperty[]
}

export function DisplayOptions({ display, onChange, onReset, tab, locked = [] }: Props) {
  const shown = propertiesOf(display)
  const offered = DISPLAY_PROPERTIES.filter((k) => !locked.includes(k))
  const propertiesLabel = useId()
  // the Active and Backlog tabs never show finished issues, so the switch would do nothing there
  const canShowCompleted = tab === 'all'
  const [open, setOpen] = useState(false)
  // picking up an issue closes the menu, so it never covers where you're dropping
  const dragging = useSelection((s) => s.dragging)
  return (
    <Popover open={open && !dragging} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 gap-2 text-ui" aria-label="Display">
          <SlidersHorizontal /> <span className="hidden sm:inline">Display</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col gap-4 overflow-y-auto">
        <Row label="Grouping">
          <Select value={display.grouping} onValueChange={(v) => onChange({ grouping: v as Grouping })}>
            <SelectTrigger className="w-36" aria-label="Grouping">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(GROUPING_NAMES) as Grouping[]).map((g) => (
                <SelectItem key={g} value={g}>
                  {GROUPING_NAMES[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Ordering" hint={display.ordering === 'manual' ? 'Drag issues to arrange them' : undefined}>
          <Select value={display.ordering} onValueChange={(v) => onChange({ ordering: v as Ordering })}>
            <SelectTrigger className="w-36" aria-label="Ordering">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ORDERING_NAMES) as Ordering[]).map((o) => (
                <SelectItem key={o} value={o}>
                  {ORDERING_NAMES[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <div className="flex flex-col gap-2">
          <div className="text-label text-muted-foreground" id={propertiesLabel}>
            Show on issues
          </div>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            spacing={2}
            aria-labelledby={propertiesLabel}
            className="w-full flex-wrap"
            value={offered.filter((k) => shown[k])}
            onValueChange={(on) => {
              // one switch changes at a time; find which
              const key = offered.find((k) => on.includes(k) !== shown[k])
              if (key) onChange(withProperty(display, key, on.includes(key)))
            }}
          >
            {offered.map((k) => (
              <ToggleGroupItem key={k} value={k} title={PROPERTY_HINTS[k]} className="font-normal data-[state=off]:text-muted-foreground data-[state=on]:border-foreground/40 data-[state=on]:bg-foreground/10 data-[state=on]:text-foreground">
                {PROPERTY_NAMES[k]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="text-xs text-muted-foreground">On narrow lists some of these make room for the title; the board shows them all.</div>
        </div>
        <div className="border-t" />
        {canShowCompleted && (
          <Row label="Show finished issues" hint="Done, canceled and duplicate">
            <Switch checked={display.showCompleted} onCheckedChange={(v) => onChange({ showCompleted: v })} aria-label="Show finished issues" />
          </Row>
        )}
        <Row label="Show sub-issues">
          <Switch checked={display.showSubIssues} onCheckedChange={(v) => onChange({ showSubIssues: v })} aria-label="Show sub-issues" />
        </Row>
        {onReset && (
          <Button variant="ghost" size="sm" className="self-end text-muted-foreground" onClick={onReset}>
            Back to default
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
