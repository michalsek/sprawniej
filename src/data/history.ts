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

export interface HistoryEvent {
  /** the event the line started from: it stays the same while later ones fold into it */
  id: number
  at: string
  /** a login; null when nobody was signed in (the nightly tidy-up) */
  by: string | null
  change: Change
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

const STATUSES = new Set<unknown>(STATUS_IDS)
const PRIORITIES = new Set<unknown>(PRIORITY_IDS)

const isPair = (x: unknown): x is [unknown, unknown] => Array.isArray(x) && x.length === 2
const textOrNull = (x: unknown): x is string | null => x === null || typeof x === 'string'
const strings = (x: unknown): string[] | null => (x === undefined ? [] : Array.isArray(x) && x.every((s) => typeof s === 'string') ? x : null)
const DAY = /^\d{4}-\d{2}-\d{2}$/

function estimate(x: unknown): number | null | undefined {
  if (x === null) return null
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN
  return Number.isFinite(n) ? n : undefined
}

/**
 * What one event says changed, in the order the issue page lists properties (the database keeps no order of its
 * own). Anything it can't read is left out, and so are kinds of change this app doesn't know yet.
 */
export function changesOf(changes: unknown, login: (id: string) => string | undefined): Change[] {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return []
  const c = changes as Record<string, unknown>
  const out: Change[] = []
  const pair = (key: string, ok: (x: unknown) => boolean): [unknown, unknown] | undefined => {
    const v = c[key]
    return isPair(v) && ok(v[0]) && ok(v[1]) ? v : undefined
  }
  const person = (id: unknown) => (typeof id === 'string' ? (login(id) ?? id) : null)

  if (isPair(c.team) && textOrNull(c.team[0]) && typeof c.team[1] === 'string') out.push({ kind: 'team', from: c.team[0], to: c.team[1] })
  const title = pair('title', textOrNull)
  if (title) out.push({ kind: 'title', from: (title[0] as string | null) ?? '', to: (title[1] as string | null) ?? '' })
  const status = pair('status', (x) => STATUSES.has(x))
  if (status) out.push({ kind: 'status', from: status[0] as StatusId, to: status[1] as StatusId })
  const priority = pair('priority', (x) => PRIORITIES.has(x))
  if (priority) out.push({ kind: 'priority', from: priority[0] as Priority, to: priority[1] as Priority })
  const assignee = pair('assignee', textOrNull)
  if (assignee) out.push({ kind: 'assignee', from: person(assignee[0]), to: person(assignee[1]) })
  const labels = c.labels
  if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
    const l = labels as Record<string, unknown>
    const added = strings(l.added)
    const removed = strings(l.removed)
    if (added && removed && (added.length || removed.length)) out.push({ kind: 'labels', added, removed })
  }
  const project = pair('project', textOrNull)
  if (project) out.push({ kind: 'project', from: project[0] as string | null, to: project[1] as string | null })
  const parent = pair('parent', textOrNull)
  if (parent) out.push({ kind: 'parent', from: parent[0] as string | null, to: parent[1] as string | null })
  const due = pair('dueDate', (x) => x === null || (typeof x === 'string' && DAY.test(x)))
  if (due) out.push({ kind: 'dueDate', from: due[0] as string | null, to: due[1] as string | null })
  if (isPair(c.estimate)) {
    const [a, b] = [estimate(c.estimate[0]), estimate(c.estimate[1])]
    if (a !== undefined && b !== undefined) out.push({ kind: 'estimate', from: a, to: b })
  }
  if (c.description === true) out.push({ kind: 'description' })
  if (c.archived === true) out.push({ kind: 'archived' })
  if (c.restored === true) out.push({ kind: 'restored' })
  return out
}

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
    for (let change of changesOf(row.changes, ctx.login)) {
      if (change.kind === 'labels' && atCreation(by, row.at, ctx)) {
        if (!change.removed.length) continue
        change = { ...change, added: [] }
      }
      // fold into the same person's last change of this kind, if it was moments ago and nothing else came between
      const last = out.findLast((e) => e.change.kind === change.kind)
      const between = last ? out.slice(out.indexOf(last) + 1).some((e) => e.by !== by) : true
      const merged = last && !between && last.by === by && Math.abs(Date.parse(row.at) - Date.parse(last.at)) < together(change.kind) ? combine(last.change, change) : undefined
      if (merged === undefined) out.push({ id: row.id, at: row.at, by, change })
      else if (merged === null) out.splice(out.indexOf(last!), 1)
      else Object.assign(last!, { at: row.at, change: merged })
    }
  }
  return out
}

/**
 * The fields that write events, as one string: when it changes, there's something new in the history. Following an
 * issue changes nothing here. "Last changed" is in it too: archiving and restoring an issue at once leaves every
 * other field as it was.
 */
export function historySignature(issue: Issue | ArchivedIssue): string {
  return JSON.stringify([
    issue.updatedAt,
    issue.title,
    issue.description,
    issue.status,
    issue.priority,
    issue.assignee,
    [...issue.labels].sort(),
    issue.project,
    issue.parent,
    issue.dueDate ?? null,
    issue.estimate ?? null,
    issue.team,
    issue.number,
    'archivedAt' in issue ? issue.archivedAt : null,
  ])
}
