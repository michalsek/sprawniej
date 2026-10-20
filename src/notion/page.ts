/**
 * What a page sent from Notion ("Send webhook") means as an issue (docs/notion.md). Notion sends the page's
 * properties, never its text. Property names and their values are matched without case, accents, spaces or
 * punctuation, so "Due date", "due-date" and "DUE DATE" are the same. Pure, so it's unit-tested (tests/notion.test.ts);
 * the Edge Function (handler.ts) runs it. Nothing here runs in the browser.
 */
import { plainName } from '@/lib/plain'
import { PAGE_ID, pageUrl } from '@/model/notion'
import type { Priority, StatusId } from '@/model/status'
import { cut, descriptionFor, type RichText } from './markdown'

// ---------- the payload ----------

interface NotionUser {
  object?: string
  id?: string
  name?: string
  /** "person" or "bot" */
  type?: string
  /** only people have one, and only inside person properties (people, created_by) */
  person?: { email?: string }
}

/** a property as Notion sends it; the readers below check every part, so another shape reads as nothing */
export interface Property {
  id?: string
  type?: string
  title?: RichText[]
  rich_text?: RichText[]
  status?: { name?: string } | null
  select?: { name?: string } | null
  multi_select?: { name?: string }[]
  people?: NotionUser[]
  created_by?: NotionUser
  date?: { start?: string | null; end?: string | null } | null
}

/** the page as the webhook reads it */
export interface Page {
  /** Notion's page id: 32 hex digits, lower case, no dashes */
  id: string
  /** its address on notion.so (or a notion.site page), or one made from its id */
  url: string
  /** in the trash, or archived: nothing is made */
  trashed: boolean
  /** as Notion sent them: each is read as a Property, and anything of another shape as nothing */
  properties: Record<string, unknown>
}

type Data = Record<string, unknown>

const isRecord = (x: unknown): x is Data => !!x && typeof x === 'object' && !Array.isArray(x)

/** the page in a delivery (`{"source": …, "data": {"object": "page", …}}`); null when it isn't one */
export function readPage(json: unknown): Page | null {
  if (!isRecord(json) || !isRecord(json.data)) return null
  const d = json.data
  if (d.object !== 'page' || typeof d.id !== 'string') return null
  const id = d.id.replace(/-/g, '').toLowerCase()
  if (!PAGE_ID.test(id)) return null
  return {
    id,
    url: pageUrl(d.url, id),
    trashed: d.in_trash === true || d.archived === true,
    properties: isRecord(d.properties) ? d.properties : {},
  }
}

// ---------- which property is which ----------

/** the names each field is found under (as plainName gives them) */
const NAMES = {
  status: ['status'],
  priority: ['priority'],
  assignee: ['assignee', 'assignees', 'assignedto', 'owner'],
  due: ['due', 'duedate', 'deadline', 'dueon'],
  labels: ['labels', 'label', 'tags'],
  team: ['team'],
  description: ['description', 'details', 'notes'],
}

/** the first property called one of `names` that has one of `types` */
function named(props: Data, names: string[], types: string[]): Data | undefined {
  for (const [name, p] of Object.entries(props)) {
    if (isRecord(p) && typeof p.type === 'string' && types.includes(p.type) && names.includes(plainName(name))) return p
  }
  return undefined
}

/** the first property of a type, whatever it's called */
function ofType(props: Data, type: string): Data | undefined {
  return Object.values(props).find((p): p is Data => isRecord(p) && p.type === type)
}

const text = (x: unknown): string => (typeof x === 'string' ? x : '')

const plainText = (parts: unknown) => (Array.isArray(parts) ? parts.map((p) => (isRecord(p) ? text(p.plain_text) : '')).join('') : '')

/** an option's name (a select's, a status's, one of a multi-select's) */
const nameOf = (o: unknown): string => (isRecord(o) ? text(o.name) : '')

/** a select's or a status's value */
const choice = (p: Data | undefined): string => nameOf(p?.type === 'status' ? p.status : p?.select)

function emailOf(u: unknown): string | null {
  const e = isRecord(u) && isRecord(u.person) ? u.person.email : undefined
  return typeof e === 'string' && e.includes('@') ? e.trim().toLowerCase() : null
}

// ---------- the values ----------

/** status names, as plainName gives them; anything else is Todo */
const STATUS_WORDS: Record<StatusId, string[]> = {
  backlog: ['backlog', 'icebox', 'later'],
  todo: ['todo', 'notstarted', 'new', 'open', 'ready', 'planned'],
  in_progress: ['inprogress', 'doing', 'started', 'wip', 'active'],
  in_review: ['inreview', 'review', 'reviewing', 'qa', 'testing'],
  done: ['done', 'complete', 'completed', 'finished', 'shipped', 'released'],
  canceled: ['canceled', 'cancelled', 'wontdo', 'dropped', 'rejected'],
  duplicate: ['duplicate'],
}

/** priority names; anything else is No priority */
const PRIORITY_WORDS: Record<Exclude<Priority, 0>, string[]> = {
  1: ['urgent', 'critical', 'highest', 'p0'],
  2: ['high', 'p1'],
  3: ['medium', 'normal', 'p2'],
  4: ['low', 'lowest', 'p3', 'p4'],
}

export function statusFrom(name: string): StatusId {
  const word = plainName(name)
  return (Object.keys(STATUS_WORDS) as StatusId[]).find((s) => STATUS_WORDS[s].includes(word)) ?? 'todo'
}

function priorityFrom(name: string): Priority {
  const word = plainName(name)
  return ([1, 2, 3, 4] as const).find((p) => PRIORITY_WORDS[p].includes(word)) ?? 0
}

/** "2026-10-20", also from "2026-10-20T10:00:00.000+02:00"; null when it isn't a real day */
function dayFrom(start: unknown): string | null {
  const day = typeof start === 'string' ? start.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const d = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day ? day : null
}

const MAX_TITLE = 500
const MAX_LABELS = 20
const MAX_EMAILS = 20

/** what the page says about the issue; people are emails here, the database knows who they are */
export interface PageIssue {
  title: string
  /** Markdown, ending with a link back to the page */
  description: string
  status: StatusId
  priority: Priority
  /** the assignee property's people with an email, in order: the first who is a member is assigned */
  assigneeEmails: string[]
  /** the Created by property's person: the issue is theirs when they are a member */
  authorEmail: string | null
  dueDate: string | null
  /** label names; only labels the workspace has count */
  labelNames: string[]
  /** a team's key or name (the Team property); otherwise the connection's team */
  teamHint: string | null
  /** every email above, for the database to match: at most 20 */
  emails: string[]
}

/** who and where: what the database needs to answer first (cheap: it reads no text but the Team property) */
export type PageHints = Pick<PageIssue, 'assigneeEmails' | 'authorEmail' | 'teamHint' | 'emails'>

export function hintsFrom(page: Page): PageHints {
  const props = page.properties
  const people = named(props, NAMES.assignee, ['people'])?.people
  const assigneeEmails = [...new Set((Array.isArray(people) ? people : []).map(emailOf).filter((e): e is string => !!e))]
  const authorEmail = emailOf(ofType(props, 'created_by')?.created_by)
  const teamProp = named(props, NAMES.team, ['select', 'status', 'rich_text'])
  const teamHint = (teamProp?.type === 'rich_text' ? plainText(teamProp.rich_text) : choice(teamProp)).trim() || null
  return {
    assigneeEmails,
    authorEmail,
    teamHint,
    emails: [...new Set([authorEmail, ...assigneeEmails].filter((e): e is string => !!e))].slice(0, MAX_EMAILS),
  }
}

/** the whole issue: the description is built here, so the webhook asks for it only once the key is right */
export function issueFromPage(page: Page): PageIssue {
  const props = page.properties
  const title = cut(plainText(ofType(props, 'title')?.title).replace(/\s+/g, ' ').trim(), MAX_TITLE) || 'Untitled'
  const statusProp = named(props, NAMES.status, ['status', 'select']) ?? ofType(props, 'status')
  const priorityProp = named(props, NAMES.priority, ['select', 'status'])
  const labelsProp = named(props, NAMES.labels, ['multi_select', 'select'])
  const options = labelsProp?.multi_select
  const labelNames = labelsProp?.type === 'multi_select' ? (Array.isArray(options) ? options : []).map(nameOf) : [choice(labelsProp)]
  const due = named(props, NAMES.due, ['date'])?.date
  return {
    ...hintsFrom(page),
    title,
    description: descriptionFor(named(props, NAMES.description, ['rich_text'])?.rich_text, page.url),
    status: statusFrom(choice(statusProp)),
    priority: priorityFrom(choice(priorityProp)),
    dueDate: dayFrom(isRecord(due) ? due.start : null),
    labelNames: [...new Set(labelNames.map((n) => n.trim()).filter(Boolean))].slice(0, MAX_LABELS),
  }
}
