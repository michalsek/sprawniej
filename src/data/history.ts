/**
 * An issue's history: who changed what, and when. The database writes one event for each saved change of an issue
 * (its fields, its labels, archiving and restoring it, moving it to another team), and this turns those events into
 * the lines the issue page shows. Pure, so it's unit-tested (tests/history.test.ts).
 */
import type { ArchivedIssue, Issue } from '@/model/schema'
import { PRIORITY_IDS, STATUS_IDS, type Priority, type StatusId } from '@/model/status'

export type Change =
  | { kind: 'status'; from: StatusId; to: StatusId }
  | { kind: 'priority'; from: Priority; to: Priority }
  /** logins (an id nobody knows stays as it is) */
  | { kind: 'assignee'; from: string | null; to: string | null }
  /** label ids */
  | { kind: 'labels'; added: string[]; removed: string[] }
  | { kind: 'project'; from: string | null; to: string | null }
  | { kind: 'parent'; from: string | null; to: string | null }
  | { kind: 'title'; from: string; to: string }
  | { kind: 'description' }
  | { kind: 'dueDate'; from: string | null; to: string | null }
  | { kind: 'estimate'; from: number | null; to: number | null }
  /** another team: "ENG-3" to "DES-7" (`from` is null when the old number isn't known) */
  | { kind: 'team'; from: string | null; to: string }
  | { kind: 'archived' }
  | { kind: 'restored' }

/** the pull request a change came through (GitHub, docs/github-app.md) */
export interface PullRequestVia {
  /** owner/name */
  repo: string
  number: number
  url: string
}

export interface HistoryEvent {
  /** the event the line started from: it stays the same while later ones fold into it */
  id: number
  at: string
  /** a login; null when nobody was signed in (the nightly tidy-up, or a change made by hand) */
  by: string | null
  change: Change
  /** it came through a pull request */
  via?: PullRequestVia
}

/** one event as src/backend/history.ts reads it (times already in the app's form) */
export interface EventRow {
  id: number
  actorId: string | null
  at: string
  changes: unknown
}

export interface HistoryContext {
  /** profile id to login */
  login(profileId: string): string | undefined
  /** who created the issue, and when: labels they put on while creating it aren't a change */
  createdBy?: string
  createdAt?: string
}

/** labels added by whoever created the issue this soon after creating it were part of creating it */
export const AT_CREATION_MS = 30_000

// ---------- reading one event ----------

type Guard<T> = (x: unknown) => x is T

const isText = (x: unknown): x is string => typeof x === 'string'
const textOrNull = (x: unknown): x is string | null => x === null || typeof x === 'string'
const isStatus = (x: unknown): x is StatusId => STATUS_IDS.some((s) => s === x)
const isPriority = (x: unknown): x is Priority => PRIORITY_IDS.some((p) => p === x)
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const dayOrNull = (x: unknown): x is string | null => x === null || (typeof x === 'string' && DATE_ONLY.test(x))
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** `[from, to]`, each of its kind */
function pair<A, B>(x: unknown, from: Guard<A>, to: Guard<B>): [A, B] | undefined {
  return Array.isArray(x) && x.length === 2 && from(x[0]) && to(x[1]) ? [x[0], x[1]] : undefined
}

/** label ids (missing: none); undefined when it's something else */
const ids = (x: unknown): string[] | undefined => (x === undefined ? [] : Array.isArray(x) && x.every(isText) ? x : undefined)

/** a number, a number written as text (how the database sends numeric), or null; undefined when it's neither */
function estimate(x: unknown): number | null | undefined {
  if (x === null) return null
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN
  return Number.isFinite(n) ? n : undefined
}
const isEstimate = (x: unknown): x is number | string | null => estimate(x) !== undefined

/**
 * What one event says changed, in the order the issue page lists properties (the database keeps no order of its
 * own). Anything it can't read is left out, and so are kinds of change this app doesn't know yet.
 */
export function changesOf(changes: unknown, login: (id: string) => string | undefined): Change[] {
  if (!isRecord(changes)) return []
  const c = changes
  const out: Change[] = []
  const person = (id: string | null) => (id === null ? null : (login(id) ?? id))

  const team = pair(c.team, textOrNull, isText)
  if (team) out.push({ kind: 'team', from: team[0], to: team[1] })
  const title = pair(c.title, textOrNull, textOrNull)
  if (title) out.push({ kind: 'title', from: title[0] ?? '', to: title[1] ?? '' })
  const status = pair(c.status, isStatus, isStatus)
  if (status) out.push({ kind: 'status', from: status[0], to: status[1] })
  const priority = pair(c.priority, isPriority, isPriority)
  if (priority) out.push({ kind: 'priority', from: priority[0], to: priority[1] })
  const assignee = pair(c.assignee, textOrNull, textOrNull)
  if (assignee) out.push({ kind: 'assignee', from: person(assignee[0]), to: person(assignee[1]) })
  if (isRecord(c.labels)) {
    const added = ids(c.labels.added)
    const removed = ids(c.labels.removed)
    if (added && removed && (added.length || removed.length)) out.push({ kind: 'labels', added, removed })
  }
  const project = pair(c.project, textOrNull, textOrNull)
  if (project) out.push({ kind: 'project', from: project[0], to: project[1] })
  const parent = pair(c.parent, textOrNull, textOrNull)
  if (parent) out.push({ kind: 'parent', from: parent[0], to: parent[1] })
  const due = pair(c.dueDate, dayOrNull, dayOrNull)
  if (due) out.push({ kind: 'dueDate', from: due[0], to: due[1] })
  const points = pair(c.estimate, isEstimate, isEstimate)
  if (points) out.push({ kind: 'estimate', from: estimate(points[0]) ?? null, to: estimate(points[1]) ?? null })
  if (c.description === true) out.push({ kind: 'description' })
  if (c.archived === true) out.push({ kind: 'archived' })
  if (c.restored === true) out.push({ kind: 'restored' })
  return out
}

/** the pull request an event came through, when it says so and the link goes to GitHub */
export function viaOf(changes: unknown): PullRequestVia | undefined {
  if (!isRecord(changes) || !isRecord(changes.via) || !isRecord(changes.via.pullRequest)) return undefined
  const { repo, number, url } = changes.via.pullRequest
  if (!isText(repo) || typeof number !== 'number' || !isText(url) || !url.startsWith('https://github.com/')) return undefined
  return { repo, number, url }
}

// ---------- events to lines ----------

/** changes this close together, by the same person, read as one: typing saves a title several times, and a status
 * clicked twice in a row is one decision */
const together = (kind: Change['kind']) => (kind === 'title' || kind === 'description' ? 15 : 2) * 60_000

function combine(a: Change, b: Change): Change | null | undefined {
  if (a.kind !== b.kind) return undefined
  switch (a.kind) {
    case 'labels': {
      const bb = b as typeof a
      const added = [...new Set([...a.added.filter((l) => !bb.removed.includes(l)), ...bb.added.filter((l) => !a.removed.includes(l))])]
      const removed = [...new Set([...a.removed.filter((l) => !bb.added.includes(l)), ...bb.removed.filter((l) => !a.added.includes(l))])]
      return added.length || removed.length ? { kind: 'labels', added, removed } : null
    }
    case 'description':
      return a
    case 'archived':
    case 'restored':
      return undefined
    default: {
      const merged = { ...a, to: (b as typeof a).to } as Change
      // there and back again: nothing happened
      return 'from' in merged && merged.from === merged.to ? null : merged
    }
  }
}

/** labels the creator put on while creating the issue (they're saved a moment after it) */
function atCreation(by: string | null, at: string, ctx: HistoryContext): boolean {
  if (!ctx.createdBy || !ctx.createdAt || by !== ctx.createdBy) return false
  const after = Date.parse(at) - Date.parse(ctx.createdAt)
  return after >= 0 && after <= AT_CREATION_MS
}

/** an issue's events, in any order, to the lines its page shows, oldest first */
export function issueEvents(rows: readonly EventRow[], ctx: HistoryContext): HistoryEvent[] {
  const out: HistoryEvent[] = []
  // the order they were saved in decides, not their times
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const by = row.actorId === null ? null : (ctx.login(row.actorId) ?? row.actorId)
    const via = viaOf(row.changes)
    for (let change of changesOf(row.changes, ctx.login)) {
      if (change.kind === 'labels' && atCreation(by, row.at, ctx)) {
        if (!change.removed.length) continue
        change = { ...change, added: [] }
      }
      // fold into the same person's last change of this kind, if it was moments ago and nothing else came between
      const last = out.findLast((e) => e.change.kind === change.kind)
      const between = last ? out.slice(out.indexOf(last) + 1).some((e) => e.by !== by) : true
      const merged = last && !between && last.by === by && Math.abs(Date.parse(row.at) - Date.parse(last.at)) < together(change.kind) ? combine(last.change, change) : undefined
      if (merged === undefined) out.push({ id: row.id, at: row.at, by, change, ...(via && { via }) })
      else if (merged === null) out.splice(out.indexOf(last!), 1)
      else Object.assign(last!, { at: row.at, change: merged }, via && { via })
    }
  }
  return out
}

// ---------- knowing when to read again ----------

/**
 * When this changes, the issue's history may have something new. Every saved change of an issue's own fields moves
 * "last changed" (so does reordering it: then one quick read finds nothing new); labels are kept apart, so they
 * count separately, and so does archiving.
 */
export function historySignature(issue: Issue | ArchivedIssue): string {
  return JSON.stringify([issue.updatedAt, 'archivedAt' in issue ? issue.archivedAt : null, [...issue.labels].sort()])
}

/** an issue's events read so far, and the issue as it was when they were asked for */
export interface Fetched {
  rows: EventRow[]
  sig: string
  /** which ask it came from: asks are numbered in the order they were made */
  asked: number
}

/**
 * Events just read, added to those read before (`fresh`: read from the start, so they replace them). Each event
 * once, oldest first. Answers can arrive out of order: the later ask's signature stays.
 */
export function mergeFetched(known: Fetched | undefined, rows: readonly EventRow[], ask: { sig: string; asked: number }, fresh = false): Fetched {
  const seen = new Set<number>()
  const all = [...(fresh || !known ? [] : known.rows), ...rows].filter((r) => !seen.has(r.id) && !!seen.add(r.id)).sort((a, b) => a.id - b.id)
  const newer = known && known.asked > ask.asked
  return { rows: all, sig: newer ? known.sig : ask.sig, asked: newer ? known.asked : ask.asked }
}
