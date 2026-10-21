/** One line of an issue's history ("Ana moved it from Todo to In Progress · 2 h ago"), shown between comments. */
import type { ReactNode } from 'react'
import { Archive, User } from 'lucide-react'
import { PersonAvatar } from '@/components/Avatar'
import { NotionMark } from '@/components/NotionMark'
import { isNotionVia, type Change, type HistoryEvent, type StatusRef, type Via } from '@/data/history'
import { issueRef, useData } from '@/data/store'
import type { Person, Status } from '@/model/schema'
import { PRIORITY_NAMES, categoryOf } from '@/model/status'
import { estimateName, shortDate, timeAgo } from './format'
import { PriorityIcon, StatusIcon } from './icons'

const B = ({ children }: { children: ReactNode }) => <span className="text-foreground/90">{children}</span>

function list(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * A status in a history line: the workspace's status as it is called now (hidden or renamed, it's the same one); for
 * a line from before statuses (only a category), the category's own name, as it was then.
 */
function StatusRefName({ of, statuses }: { of: StatusRef; statuses: Record<string, Status> }) {
  const own = of.id ? statuses[of.id] : undefined
  const look = own ?? (of.category ? { ...categoryOf(of.category), category: of.category } : undefined)
  if (!look) return <>another status</>
  return (
    <>
      <StatusIcon status={look} className="inline align-[-2px]" /> <B>{look.name}</B>
    </>
  )
}

function useText(change: Change, by: string | null): ReactNode {
  const people = useData((s) => s.people)
  const projects = useData((s) => s.projects)
  const labels = useData((s) => s.labels)
  const issues = useData((s) => s.issues)
  const statuses = useData((s) => s.statuses)
  // someone this workspace doesn't know (any more) never shows as a code
  const person = (l: string | null) => (l ? (people[l]?.name ?? 'someone') : '')
  const project = (id: string | null) => (id && projects[id] ? `${projects[id].emoji} ${projects[id].name}` : 'a project')
  const issue = (id: string | null) => (id && issues[id] ? issueRef(issues[id]) : 'another issue')
  switch (change.kind) {
    case 'status':
      return (
        <>
          moved it from <StatusRefName of={change.from} statuses={statuses} /> to <StatusRefName of={change.to} statuses={statuses} />
        </>
      )
    case 'priority':
      return change.to ? (
        <>
          set the priority to <PriorityIcon priority={change.to} className="inline align-[-2px]" /> <B>{PRIORITY_NAMES[change.to]}</B>
        </>
      ) : (
        'removed the priority'
      )
    case 'assignee':
      if (!change.to) return <>unassigned <B>{person(change.from)}</B></>
      return change.to === by ? 'assigned it to themselves' : <>assigned it to <B>{person(change.to)}</B></>
    case 'labels': {
      const word = (n: number) => (n === 1 ? 'label' : 'labels')
      // "the Bug and Design labels", and labels deleted since then said as such
      const these = (ids: string[]) => {
        const named = ids.flatMap((id) => (labels[id] ? [labels[id].name] : []))
        const gone = ids.length - named.length
        const goneText = gone === 1 ? 'a label deleted since' : `${gone} labels deleted since`
        if (!named.length) return goneText
        return (
          <>
            the <B>{list(named)}</B> {word(named.length)}
            {gone > 0 && <> and {goneText}</>}
          </>
        )
      }
      if (change.added.length && change.removed.length) return <>added {these(change.added)} and removed {these(change.removed)}</>
      if (change.added.length) return <>added {these(change.added)}</>
      return <>removed {these(change.removed)}</>
    }
    case 'project':
      return change.to ? <>moved it to <B>{project(change.to)}</B></> : <>took it out of <B>{project(change.from)}</B></>
    case 'parent':
      return change.to ? <>made it a sub-issue of <B>{issue(change.to)}</B></> : <>made it a standalone issue</>
    case 'title':
      return <>renamed it to <B>“{change.to}”</B></>
    case 'description':
      return 'edited the description'
    case 'dueDate':
      return change.to ? <>set the due date to <B>{shortDate(change.to)}</B></> : 'removed the due date'
    case 'estimate':
      return change.to !== null ? <>set the estimate to <B>{estimateName(change.to)}</B></> : 'removed the estimate'
    case 'team':
      return change.from ? (
        <>
          moved it from <B>{change.from}</B> to <B>{change.to}</B>
        </>
      ) : (
        <>
          moved it to <B>{change.to}</B>
        </>
      )
    case 'archived':
      return 'archived it'
    case 'restored':
      return 'brought it back'
  }
}

const When = ({ at }: { at: string }) => <span title={new Date(at).toLocaleString()}> · {timeAgo(at)}</span>

/** archived by the nightly tidy-up: nobody did it */
function AutoLine({ event }: { event: HistoryEvent }) {
  return (
    <li className="flex items-start gap-2.5 px-1 text-sm text-muted-foreground" data-kind={event.change.kind}>
      <span className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
        <Archive className="size-3" />
      </span>
      <span className="min-w-0">
        Archived automatically, since it was finished and hadn’t changed for a while
        <When at={event.at} />
      </span>
    </li>
  )
}

/** whoever did it, or a grey circle when it isn't known who (nobody signed in, or someone no longer known) */
function Who({ person }: { person?: Person }) {
  if (person) return <PersonAvatar person={person} className="mt-px" />
  return (
    <span className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
      <User className="size-3" />
    </span>
  )
}

/** a link to the Notion page something came from */
const NotionLink = ({ url, children }: { url: string; children: ReactNode }) => (
  <a className="underline-offset-2 hover:underline" href={url} target="_blank" rel="noreferrer">
    {children}
  </a>
)

function PersonLine({ event }: { event: HistoryEvent }) {
  const person = useData((s) => (event.by === null ? undefined : s.people[event.by]))
  const text = useText(event.change, event.by)
  return (
    <li className="flex items-start gap-2.5 px-1 text-sm text-muted-foreground" data-kind={event.change.kind}>
      <Who person={person} />
      <span className="min-w-0">
        <B>{person?.name ?? 'Someone'}</B> {text}
        {event.via && (
          <>
            {' · '}
            <a className="underline-offset-2 hover:underline" href={event.via.url} target="_blank" rel="noreferrer" title={event.via.repo}>
              pull request #{event.via.number}
            </a>
          </>
        )}
        <When at={event.at} />
      </span>
    </li>
  )
}

export function HistoryLine({ event }: { event: HistoryEvent }) {
  // only archiving happens with nobody signed in on its own; anything else was changed by hand
  return event.by === null && event.change.kind === 'archived' ? <AutoLine event={event} /> : <PersonLine event={event} />
}

/**
 * The first line: who created the issue, from its own fields, and the Notion page it was made from. Made from a page
 * by nobody (its author isn't a member), it says only that.
 */
export function CreatedLine({ by, at, via }: { by: string; at: string; via?: Via }) {
  const person = useData((s) => (by ? s.people[by] : undefined))
  const notion = isNotionVia(via) ? via.notion.url : undefined
  if (!by && notion) {
    return (
      <li className="flex items-start gap-2.5 px-1 text-sm text-muted-foreground">
        <NotionMark className="mt-px" />
        <span>
          Created from <NotionLink url={notion}>Notion</NotionLink>
          <When at={at} />
        </span>
      </li>
    )
  }
  return (
    <li className="flex items-start gap-2.5 px-1 text-sm text-muted-foreground">
      <Who person={person} />
      <span>
        <B>{person?.name ?? 'Someone'}</B> created the issue
        {notion && (
          <>
            {' '}from <NotionLink url={notion}>Notion</NotionLink>
          </>
        )}
        <When at={at} />
      </span>
    </li>
  )
}
