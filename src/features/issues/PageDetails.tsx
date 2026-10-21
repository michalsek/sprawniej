/**
 * The top of the side panel: what the page is (a view, a project, a team), read only, with links. Changing these
 * stays in the page's own header.
 */
import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { useShallow } from 'zustand/react/shallow'
import { PersonAvatar } from '@/components/Avatar'
import { statusOfProject } from '@/data/statuses'
import { useData } from '@/data/store'
import type { Project, Team, View } from '@/model/schema'
import { StatusDot } from '@/features/projects/StatusDot'
import { shortDate } from './format'

/** how many members' pictures a team shows before "+3" */
const FACES = 8

function Details({ title, emoji, children }: { title: string; emoji?: string; children: ReactNode }) {
  return (
    <section aria-label="Details" className="flex flex-col gap-3">
      <h2 className="flex min-w-0 items-center gap-2 text-ui font-semibold" title={title}>
        {emoji && <span className="text-emoji-sm leading-none">{emoji}</span>}
        <span className="truncate">{title}</span>
      </h2>
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">{children}</dl>
    </section>
  )
}

function Line({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{children}</dd>
    </>
  )
}

const link = 'truncate rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function TeamLink({ team }: { team: Team }) {
  return (
    <Link href={`/team/${team.key}/issues`} className={link} title={team.name}>
      {team.emoji} {team.name}
    </Link>
  )
}

function Person({ login }: { login: string | null }) {
  const person = useData((s) => (login ? s.people[login] : undefined))
  if (!login) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={person?.name ?? login}>
      <PersonAvatar person={person} login={login} className="size-4 text-initials-sm" />
      <span className="truncate">{person?.name ?? login}</span>
    </span>
  )
}

export function ViewDetails({ view }: { view: View }) {
  const team = useData((s) => (view.team ? s.teams[view.team] : undefined))
  return (
    <Details title={view.name} emoji={view.emoji}>
      <Line name="Team">{team ? <TeamLink team={team} /> : 'Whole workspace'}</Line>
      <Line name="Made by">
        <Person login={view.owner} />
      </Line>
      <Line name="Made on">{shortDate(view.createdAt)}</Line>
      <Line name="Who sees it">Everyone in the workspace can see and change it</Line>
    </Details>
  )
}

export function ProjectDetails({ project, done, total }: { project: Project; done: number; total: number }) {
  const statuses = useData((s) => s.statuses)
  const status = statusOfProject(project, statuses)
  const teams = useData(useShallow((s) => project.teams.map((k) => s.teams[k]).filter((t) => !!t)))
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <Details title={project.name} emoji={project.emoji}>
      <Line name="Status">
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot status={status} />
          <span className="truncate">{status.name}</span>
        </span>
      </Line>
      <Line name="Lead">{project.lead ? <Person login={project.lead} /> : <span className="text-muted-foreground">No lead</span>}</Line>
      <Line name="Target date">{project.targetDate ? shortDate(project.targetDate) : <span className="text-muted-foreground">No target date</span>}</Line>
      <Line name="Teams">
        {teams.length ? teams.map((t) => <TeamLink key={t.key} team={t} />) : <span className="text-muted-foreground">Every team</span>}
      </Line>
      <Line name="Progress">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-status-done" style={{ width: `${pct}%` }} />
          </span>
          <span className="text-muted-foreground">
            {done} of {total} done
          </span>
        </span>
      </Line>
      <Line name="Made on">{shortDate(project.createdAt)}</Line>
    </Details>
  )
}

export function TeamDetails({ team }: { team: Team }) {
  const people = useData((s) => s.people)
  const faces = team.members.slice(0, FACES)
  const more = team.members.length - faces.length
  const n = team.members.length
  return (
    <Details title={team.name} emoji={team.emoji}>
      <Line name="Key">
        <span>
          {team.key} <span className="text-muted-foreground">(issues are {team.key}-1, {team.key}-2…)</span>
        </span>
      </Line>
      <Line name="Members">
        {n > 0 && (
          <span className="flex items-center -space-x-1" aria-hidden>
            {faces.map((l) => (
              <PersonAvatar key={l} person={people[l]} login={l} className="size-5 ring-2 ring-background" />
            ))}
            {more > 0 && <span className="pl-2 text-muted-foreground">+{more}</span>}
          </span>
        )}
        <span className="text-muted-foreground">{n === 1 ? '1 member' : `${n} members`}</span>
      </Line>
    </Details>
  )
}
