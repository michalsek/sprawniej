/** A project's status, lead, target date and teams as chips. The same chips work in "New project" and on its page. */
import { CalendarDays, UserRound, Users, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { PersonAvatar } from '@/components/Avatar'
import { Picker } from '@/components/Picker'
import type { ProjectPatch } from '@/data/actions'
import { useData } from '@/data/store'
import { shortDate } from '@/features/issues/format'
import { usePeopleItems } from '@/features/issues/pickers'
import { PROJECT_STATUSES, type Project } from '@/model/schema'
import { PROJECT_STATUS_COLORS, PROJECT_STATUS_NAMES } from './status'

export const chip =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm text-foreground/90 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent/60 [&_svg]:size-3.5'

export function StatusDot({ status }: { status: Project['status'] }) {
  return <span className="size-2.5 shrink-0 rounded-full" style={{ background: PROJECT_STATUS_COLORS[status] }} />
}

const statusItems = PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_NAMES[s], icon: <StatusDot status={s} /> }))

type Value = Pick<Project, 'status' | 'lead' | 'targetDate' | 'teams'>

export function ProjectProperties({ value, onChange }: { value: Value; onChange: (patch: ProjectPatch) => void }) {
  const people = useData((s) => s.people)
  const teams = useData(useShallow((s) => Object.values(s.teams)))
  const peopleItems = usePeopleItems()
  const lead = value.lead ? people[value.lead] : undefined
  const chosenTeams = teams.filter((t) => value.teams.includes(t.key))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Picker placeholder="Project status…" items={statusItems} value={value.status} onSelect={(status) => onChange({ status })}>
        <button type="button" className={chip}>
          <StatusDot status={value.status} /> {PROJECT_STATUS_NAMES[value.status]}
        </button>
      </Picker>
      <Picker placeholder="Who leads it…" items={peopleItems} value={value.lead} onSelect={(lead) => onChange({ lead })}>
        <button type="button" className={chip}>
          {lead || value.lead ? <PersonAvatar person={lead} login={value.lead} className="size-4 text-[7px]" /> : <UserRound />}
          {lead?.name ?? value.lead ?? 'Lead'}
        </button>
      </Picker>
      <span className={`${chip} relative gap-0 p-0`}>
        <label className="flex h-full cursor-pointer items-center gap-1.5 px-2.5">
          <CalendarDays className="text-muted-foreground" />
          {value.targetDate ? shortDate(value.targetDate) : 'Target date'}
          <input
            type="date"
            aria-label="Target date"
            value={value.targetDate ?? ''}
            onChange={(e) => onChange({ targetDate: e.target.value || null })}
            onClick={(e) => e.currentTarget.showPicker?.()}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        {value.targetDate && (
          <button type="button" onClick={() => onChange({ targetDate: null })} className="relative flex h-full items-center border-l px-1.5 text-muted-foreground hover:text-foreground" aria-label="Remove the target date">
            <X />
          </button>
        )}
      </span>
      {teams.length > 1 && (
        <Picker
          multiple
          placeholder="Teams…"
          items={teams.map((t) => ({ value: t.key, label: t.name, icon: <span className="w-4 text-center leading-none">{t.emoji}</span> }))}
          value={value.teams}
          onSelect={(keys) => onChange({ teams: keys })}
        >
          <button type="button" className={chip}>
            {chosenTeams.length ? chosenTeams.map((t) => <span key={t.key}>{t.emoji}</span>) : <Users />}
            {chosenTeams.length === 1 ? chosenTeams[0].name : chosenTeams.length ? `${chosenTeams.length} teams` : 'Teams'}
          </button>
        </Picker>
      )}
    </div>
  )
}
