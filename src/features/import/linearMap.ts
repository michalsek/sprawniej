/**
 * Linear data → workspace rows. Pure (no store, no network), so every rule is unit-tested
 * (tests/linearImport.test.ts). docs/linear-import.md describes the same mapping in plain words.
 *
 * Every row keeps its Linear id in `linearId`, so running the import again updates what came over the first time
 * instead of making copies, and gives back only what is new or changed. Issues that go straight to the archive are
 * rows with `archivedAt`. People who have joined since an earlier import come back as `links` (guest → account).
 */
import { generateNKeysBetween } from 'fractional-indexing'
import { linearIdsOf, plainName as plain } from '@/data/relink'
import { STATUSES, type Priority, type StatusId } from '@/model/status'
import { AUTO_ARCHIVE_MONTHS, isGuest, type Comment, type Issue, type Label, type Person, type Project, type Team, type View } from '@/model/schema'
import { SUBSCRIBERS_READ, type LIssue, type LinearData, type LLabel, type LTeam, type LUser } from './linearApi'
import { mapViewFilter, type FilterContext } from './linearFilters'

// ---------- people ----------

/** a Linear person's best guess among the workspace's people: linked to them before, same name, or a login like theirs */
export function guessPerson(u: LUser, people: Person[]): string | null {
  const linked = people.find((p) => linearIdsOf(p).includes(u.id))
  if (linked) return linked.login
  const names = [u.name, u.displayName].filter(Boolean).map(plain)
  const local = u.email ? plain(u.email.split('@')[0]) : ''
  const hit =
    people.find((p) => p.name && names.includes(plain(p.name))) ??
    people.find((p) => names.includes(plain(p.login)) || (local && plain(p.login) === local))
  return hit?.login ?? null
}

/** Linear user ids a view's filter names (assignee, subscribers, creator…) */
export function viewPeople(filterData: unknown): string[] {
  const out: string[] = []
  const walk = (x: unknown, inPerson: boolean) => {
    if (typeof x === 'string' && inPerson) out.push(x)
    else if (Array.isArray(x)) x.forEach((y) => walk(y, inPerson))
    else if (x && typeof x === 'object')
      for (const [k, v] of Object.entries(x)) walk(v, inPerson || k === 'assignee' || k === 'subscribers' || k === 'creator')
  }
  walk(filterData, false)
  return out
}

/** the Linear people who show up in these issues, comments and views (assignees, creators, commenters, subscribers) */
export function involvedUsers(data: Pick<LinearData, 'users' | 'issues' | 'comments'> & { views?: LinearData['views'] }): LUser[] {
  const ids = new Set<string>()
  for (const i of data.issues) {
    for (const u of [i.assignee, i.creator]) if (u) ids.add(u.id)
    for (const u of i.subscribers?.nodes ?? []) ids.add(u.id)
  }
  for (const c of data.comments) if (c.user) ids.add(c.user.id)
  for (const v of data.views ?? []) for (const id of viewPeople(v.filterData)) ids.add(id)
  return data.users.filter((u) => ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name))
}

/** how a Linear person is called: their name, unless Linear only knows their e-mail address */
export const linearName = (u: LUser): string => (u.name.includes('@') ? u.displayName || u.name.split('@')[0] : u.name || u.displayName)

/**
 * The login each Linear person gets if nobody here is them: `~jan-kowalski` (see `isGuest`). Someone an earlier
 * import already brought keeps theirs; two people with the same name get told apart.
 */
export function guestLogins(users: LUser[], people: Record<string, Person>): Map<string, string> {
  const out = new Map<string, string>()
  const taken = new Set(Object.keys(people))
  for (const p of Object.values(people)) if (isGuest(p.login)) for (const id of linearIdsOf(p)) out.set(id, p.login)
  for (const u of users) {
    if (out.has(u.id)) continue
    const slug =
      linearName(u)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/ł/g, 'l')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'someone'
    let login = `~${slug}`
    if (taken.has(login)) login = `~${slug}-${u.id.replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase()}`
    taken.add(login)
    out.set(u.id, login)
  }
  return out
}

// ---------- statuses, teams, emoji ----------

const STATE_TYPES: Record<string, StatusId> = {
  triage: 'backlog',
  backlog: 'backlog',
  unstarted: 'todo',
  started: 'in_progress',
  completed: 'done',
  canceled: 'canceled',
}

/** by name first ("In Review"), then by Linear's kind of state */
export function mapStatus(state: { name: string; type: string }): StatusId {
  const name = plain(state.name.replace(/cancelled/i, 'canceled'))
  return STATUSES.find((s) => plain(s.name) === name)?.id ?? STATE_TYPES[state.type] ?? 'backlog'
}

const PROJECT_STATES: Record<string, Project['status']> = {
  backlog: 'backlog',
  planned: 'planned',
  started: 'in_progress',
  paused: 'paused',
  completed: 'completed',
  canceled: 'canceled',
}

/** Linear icons are names ("Rocket") or emoji; names we know become their emoji */
const ICONS: Record<string, string> = {
  rocket: '🚀', bug: '🐞', code: '💻', terminal: '💻', design: '🎨', palette: '🎨', brush: '🎨', mobile: '📱', phone: '📱',
  chart: '📊', barchart: '📊', megaphone: '📣', book: '📚', cube: '📦', box: '📦', flag: '🚩', star: '⭐', heart: '❤️',
  lightning: '⚡', bolt: '⚡', globe: '🌍', world: '🌍', server: '🖥️', computer: '🖥️', gear: '⚙️', settings: '⚙️',
  people: '👥', users: '👥', team: '👥', target: '🎯', shield: '🛡️', lock: '🔒', money: '💰', dollar: '💰', briefcase: '💼',
  lab: '🧪', flask: '🧪', tools: '🛠️', wrench: '🛠️', calendar: '📅', mail: '✉️', chat: '💬', home: '🏠', music: '🎵', camera: '📷',
}

export function emojiFor(icon: string | null, fallback: string): string {
  if (!icon) return fallback
  if (/\p{Extended_Pictographic}/u.test(icon)) return icon
  return ICONS[plain(icon)] ?? fallback
}

const TEAM_EMOJI = ['🚀', '🛠️', '🎨', '📦', '🧪', '📣', '🌍', '⚡']

/** a key for a team that isn't taken (ENG, then ENG2, ENG3…) */
export function freeKey(key: string, taken: Set<string>): string {
  const base = key.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'T'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`.slice(0, 7))) return `${base}${n}`.slice(0, 7)
}

// ---------- descriptions ----------

/** links to Linear issues that came over become plain references (ENG-12), which open here */
export function rewriteLinks(md: string, imported: Set<string>): string {
  const ref = (r: string, whole: string) => (imported.has(r) ? r : whole)
  return md
    .replace(/\[([^\]\n]*)\]\(https:\/\/linear\.app\/[^/\s)]+\/issue\/([A-Z][A-Z0-9]*-\d+)[^)\s]*\)/g, (whole, _text: string, r: string) => ref(r, whole))
    .replace(/<?https:\/\/linear\.app\/[^/\s)]+\/issue\/([A-Z][A-Z0-9]*-\d+)[^\s)>]*>?/g, (whole, r: string) => ref(r, whole))
}

// ---------- the whole import ----------

/** what the person chose in the wizard */
export interface ImportChoices {
  /** Linear team id → the key it gets here (its own key, or another one when that is taken) */
  teamKeys: Record<string, string>
  /** Linear user id → GitHub login here, a `~name` (someone who hasn't joined, see `guestLogins`), or null for nobody */
  people: Record<string, string | null>
}


/** the workspace as it is now */
export interface Existing {
  me: string
  /** everyone here by login, including people an earlier import brought who haven't joined */
  people?: Record<string, Person>
  teams: Record<string, Team>
  /** issues that aren't archived */
  issues: Record<string, Issue>
  labels: Record<string, Label>
  projects: Record<string, Project>
  /** by issue id, including the comments of archived issues that came from Linear */
  comments: Record<string, Comment[]>
  views?: Record<string, View>
  /** archived issues that came from Linear, by Linear id: they stay archived */
  archivedByLinear: Record<string, { id: string; team: string; number: number }>
  /** every number each team (by key) has used, so none is given out twice (even one whose issue was deleted) */
  usedNumbers: Record<string, number[]>
}

/** someone who hasn't joined: made once, so their name and picture show */
export type GuestRow = Person & { id: string; linearId: string; email?: string }
/** `isNew` false: a team that is here already and only learns which Linear team it is */
export type TeamRow = Team & { linearId?: string; isNew: boolean }
export type LabelRow = Label & { linearId: string }
export type ProjectRow = Project & { linearId: string }
/** with `archivedAt`: finished long ago, so it goes straight to the archive */
export type IssueRow = Issue & { linearId: string; archivedAt?: string; archivedBy?: string }
export type CommentRow = Comment & { linearId: string }
export type ViewRow = View & { linearId: string }

/** what to write: only rows that are new or changed since an earlier import */
export interface ImportResult {
  guests: GuestRow[]
  teams: TeamRow[]
  labels: LabelRow[]
  projects: ProjectRow[]
  /** new or changed, not ordered by parent */
  issues: IssueRow[]
  comments: CommentRow[]
  views: ViewRow[]
  /** someone who has joined since an earlier import and is matched now: everything that points at the guest moves to them */
  links: { guest: string; to: string }[]
  /** views an earlier import made that can't come over any more */
  removedViews: string[]
  /**
   * what the import covers, changed or not. `archived`: of the issues, how many are in the archive (finished long ago,
   * or archived here since)
   */
  counts: { teams: number; labels: number; projects: number; issues: number; comments: number; archived: number; views: number }
  /** imported issues that couldn't keep their number, because the team here already used it */
  renumbered: { from: string; to: string }[]
  /** views whose Linear filters couldn't all come over, by name */
  inexactViews: string[]
  /** views none of whose filters could come over, so they're left out, by name */
  skippedViews: string[]
}

const linearIdOf = (x: object): string | undefined => {
  const v = (x as { linearId?: unknown }).linearId
  return typeof v === 'string' ? v : undefined
}

function byLinearId<T extends object>(things: Iterable<T>): Map<string, T> {
  const m = new Map<string, T>()
  for (const t of things) {
    const id = linearIdOf(t)
    if (id) m.set(id, t)
  }
  return m
}

/** keys in order, without empty values, so a row read back from storage compares equal to the one we'd write */
function canon(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canon)
  if (!x || typeof x !== 'object') return x
  return Object.fromEntries(
    Object.keys(x)
      .sort()
      .flatMap((k) => {
        const v = (x as Record<string, unknown>)[k]
        return v == null || (Array.isArray(v) && !v.length) ? [] : [[k, canon(v)]]
      }),
  )
}
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
/** Linear can send the same thing twice (pages that shift while we read): one of each */
const once = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map((x) => [x.id, x])).values()]

/** Linear sends higher numbers for later in a list; this turns their order into ours, team by team */
function orderKeys(issues: LIssue[]): Map<string, string> {
  const out = new Map<string, string>()
  const byTeam = new Map<string, LIssue[]>()
  for (const i of issues) byTeam.set(i.team.id, [...(byTeam.get(i.team.id) ?? []), i])
  for (const list of byTeam.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number)
    const keys = generateNKeysBetween(null, null, list.length)
    list.forEach((i, n) => out.set(i.id, keys[n]))
  }
  return out
}

export function buildImport(data: LinearData, choices: ImportChoices, ws: Existing, newId: () => string, now: string, newUuid: () => string): ImportResult {
  data = { ...data, issues: once(data.issues), comments: once(data.comments), labels: once(data.labels), projects: once(data.projects), views: data.views && once(data.views) }
  const counts = { teams: 0, labels: 0, projects: 0, issues: 0, comments: 0, archived: 0, views: 0 }
  const renumbered: ImportResult['renumbered'] = []
  const out: ImportResult = { guests: [], teams: [], labels: [], projects: [], issues: [], comments: [], views: [], links: [], removedViews: [], counts, renumbered, inexactViews: [], skippedViews: [] }
  const login = (u: { id: string } | null | undefined) => (u ? (choices.people[u.id] ?? null) : null)
  const teams = data.teams.filter((t) => choices.teamKeys[t.id])
  const teamIds = new Set(teams.map((t) => t.id))
  const issues = data.issues.filter((i) => teamIds.has(i.team.id))
  const keyOf = (t: { id: string }) => choices.teamKeys[t.id]

  // people who haven't joined: a row each, so their name and picture show (made once; later imports leave it)
  const people = ws.people ?? {}
  for (const u of data.users) {
    const l = choices.people[u.id]
    if (!l || !isGuest(l) || people[l] || out.guests.some((g) => g.login === l)) continue
    out.guests.push({ id: newUuid(), login: l, githubId: 0, name: linearName(u), avatarUrl: u.avatarUrl ?? '', linearId: u.id, ...(u.email ? { email: u.email } : {}) })
  }
  // someone who has joined since an earlier import and is matched now: what pointed at them moves to their account
  const relinked = new Map<string, string>()
  for (const p of Object.values(people)) {
    if (!isGuest(p.login)) continue
    const to = linearIdsOf(p)
      .map((id) => choices.people[id])
      .find((m): m is string => !!m && !isGuest(m))
    if (!to) continue
    relinked.set(p.login, to)
    out.links.push({ guest: p.login, to })
  }
  /** for what an earlier import wrote and this one keeps (the links move the rest) */
  const relink = (l: string) => relinked.get(l) ?? l

  // teams: new ones get a row; ones that are already here stay as they are
  const members = new Map<string, Set<string>>()
  for (const i of issues) for (const p of [login(i.assignee), login(i.creator)]) if (p && !isGuest(p)) members.set(keyOf(i.team), (members.get(keyOf(i.team)) ?? new Set()).add(p))
  // two Linear teams can join the same team here: the first one decides
  const seen = new Set<string>()
  teams.forEach((t: LTeam, n) => {
    const key = keyOf(t)
    if (seen.has(key)) return
    seen.add(key)
    const here = ws.teams[key]
    if (here) {
      // remember which Linear team it is, so the next import picks it again
      if (linearIdOf(here) !== t.id) out.teams.push({ ...here, linearId: t.id, isNew: false })
      return
    }
    out.teams.push({
      key,
      name: t.name,
      emoji: emojiFor(t.icon, TEAM_EMOJI[n % TEAM_EMOJI.length]),
      members: [...new Set([ws.me, ...(members.get(key) ?? [])])],
      createdAt: now,
      linearId: t.id,
      isNew: true,
    })
    counts.teams++
  })

  // labels: group labels are flattened ("Area: Charts"); the same name in several teams becomes one label
  const usedLabels = new Set(issues.flatMap((i) => i.labels.nodes.map((l) => l.id)))
  const labelsByLinear = byLinearId(Object.values(ws.labels))
  const labelsByName = new Map(Object.values(ws.labels).map((l) => [l.name.toLowerCase(), l]))
  const labelId = new Map<string, string>()
  /** a Linear label → its label here, made if it's new (views bring over labels no issue uses yet) */
  const bringLabel = (l: LLabel): string => {
    const known = labelId.get(l.id)
    if (known) return known
    const name = l.parent ? `${l.parent.name}: ${l.name}` : l.name
    const found = labelsByLinear.get(l.id) ?? labelsByName.get(name.toLowerCase())
    if (found) {
      // one made here with the same name: it remembers the Linear label, so the next import finds it by that
      if (!linearIdOf(found)) {
        const linked: LabelRow = { ...found, linearId: l.id }
        out.labels.push(linked)
        labelsByName.set(name.toLowerCase(), linked)
      }
      labelId.set(l.id, found.id)
      return found.id
    }
    const label: LabelRow = { id: newId(), name, color: l.color, linearId: l.id }
    out.labels.push(label)
    labelsByName.set(name.toLowerCase(), label)
    labelId.set(l.id, label.id)
    counts.labels++
    return label.id
  }
  for (const l of data.labels) if (!l.isGroup && usedLabels.has(l.id)) bringLabel(l)

  // projects: the ones these teams' issues belong to, or that belong to these teams
  const usedProjects = new Set(issues.flatMap((i) => (i.project ? [i.project.id] : [])))
  const projectsByLinear = byLinearId(Object.values(ws.projects))
  const projectId = new Map<string, string>()
  for (const p of data.projects) {
    if (!usedProjects.has(p.id) && !p.teams.nodes.some((t) => teamIds.has(t.id))) continue
    const old = projectsByLinear.get(p.id)
    const state = p.status?.type ?? p.state ?? 'planned'
    const project: ProjectRow = {
      ...old,
      id: old?.id ?? newId(),
      name: p.name,
      emoji: emojiFor(p.icon, old?.emoji ?? '📦'),
      description: p.description ?? '',
      status: PROJECT_STATES[state] ?? 'planned',
      lead: login(p.lead),
      teams: [...new Set(p.teams.nodes.filter((t) => teamIds.has(t.id)).map(keyOf))],
      targetDate: p.targetDate,
      createdAt: old?.createdAt ?? p.createdAt,
      linearId: p.id,
    }
    projectId.set(p.id, project.id)
    counts.projects++
    if (!old || !same(old, project)) out.projects.push(project)
  }

  // issues: keep numbers unless the team here already used one for something else
  const issuesByLinear = byLinearId(Object.values(ws.issues))
  /** an issue archived here since an earlier import: it stays as it is */
  const archivedHere = (linearId: string) => (issuesByLinear.has(linearId) ? undefined : ws.archivedByLinear[linearId])
  const order = orderKeys(issues)
  const idOf = new Map(issues.map((i) => [i.id, issuesByLinear.get(i.id)?.id ?? archivedHere(i.id)?.id ?? newId()]))
  const refs = new Set(issues.map((i) => `${keyOf(i.team)}-${i.number}`))
  // every number used here counts, including issues an earlier import brought in (they keep theirs) and deleted ones
  const taken = new Map<string, Set<number>>()
  const mark = (team: string, n: number) => taken.set(team, (taken.get(team) ?? new Set()).add(n))
  for (const [team, ns] of Object.entries(ws.usedNumbers)) for (const n of ns) mark(team, n)
  for (const i of Object.values(ws.issues)) mark(i.team, i.number)
  for (const a of Object.values(ws.archivedByLinear)) mark(a.team, a.number)
  const highest = new Map<string, number>()
  const raise = (team: string, n: number) => highest.set(team, Math.max(highest.get(team) ?? 0, n))
  for (const [team, used] of taken) for (const n of used) raise(team, n)
  for (const t of Object.values(ws.teams)) raise(t.key, t.lastNumber ?? 0)
  for (const li of issues) {
    const at = issuesByLinear.get(li.id) ?? archivedHere(li.id)
    raise(at?.team ?? keyOf(li.team), at?.number ?? li.number)
  }
  const plan: { li: LIssue; team: string; number: number }[] = []
  for (const li of [...issues].sort((a, b) => a.number - b.number)) {
    if (archivedHere(li.id)) {
      // archived here since: it stays as it is, and counts as in the archive
      counts.issues++
      counts.archived++
      continue
    }
    const old = issuesByLinear.get(li.id)
    const team = old?.team ?? keyOf(li.team)
    const used = taken.get(team) ?? new Set<number>()
    taken.set(team, used)
    let number = old?.number ?? li.number
    if (!old && used.has(number)) {
      const n = (highest.get(team) ?? 0) + 1
      raise(team, n)
      renumbered.push({ from: `${team}-${number}`, to: `${team}-${n}` })
      number = n
    }
    used.add(number)
    plan.push({ li, team, number })
  }
  // new issues finished longer ago than their team keeps finished issues go straight into the archive
  const archiveBefore = (team: string) => {
    const months = ws.teams[team]?.autoArchive ?? AUTO_ARCHIVE_MONTHS
    if (!months) return null
    const d = new Date(now)
    d.setMonth(d.getMonth() - months)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  /** the issue rows by Linear id, so comments find theirs */
  const imported = new Map<string, IssueRow>()
  // who commented on what, so subscribers who follow an issue anyway (by commenting) aren't listed twice
  const commenters = new Map<string, Set<string>>()
  for (const c of data.comments) {
    const who = login(c.user)
    if (c.issue && who) commenters.set(c.issue.id, (commenters.get(c.issue.id) ?? new Set()).add(who))
  }
  for (const { li, team, number } of plan) {
    const old = issuesByLinear.get(li.id)
    const assignee = login(li.assignee)
    const createdBy = login(li.creator) ?? (old?.createdBy && relink(old.createdBy)) ?? ws.me
    const implicit = new Set([assignee, createdBy, ...(commenters.get(li.id) ?? [])])
    // Linear's subscribers, plus anyone who subscribed here since an earlier import
    const theirs = new Set((li.subscribers?.nodes ?? []).map((u) => login(u)).filter((l): l is string => !!l))
    const subscribers = [...new Set([...(old?.subscribers ?? []).map(relink), ...theirs])].filter((l) => !implicit.has(l)).sort()
    // Linear subscribes creators, assignees and commenters by itself: one missing from its list unsubscribed there
    // (only when the list came in whole)
    const whole = !!li.subscribers && li.subscribers.nodes.length < SUBSCRIBERS_READ
    const left = whole ? [...implicit].filter((l): l is string => !!l && !theirs.has(l)) : []
    const unsubscribed = [...new Set([...(old?.unsubscribed ?? []).map(relink), ...left])].filter((l) => !theirs.has(l)).sort()
    const issue: IssueRow = {
      ...old,
      id: idOf.get(li.id)!,
      team,
      number,
      title: li.title,
      description: rewriteLinks(li.description ?? '', refs).replace(/\s+$/, ''),
      status: mapStatus(li.state),
      priority: (li.priority >= 0 && li.priority <= 4 ? li.priority : 0) as Priority,
      assignee,
      labels: [...new Set(li.labels.nodes.map((l) => labelId.get(l.id)).filter((x): x is string => !!x))],
      project: li.project ? (projectId.get(li.project.id) ?? null) : null,
      parent: li.parent ? (idOf.get(li.parent.id) ?? null) : null,
      ...(li.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(li.dueDate) ? { dueDate: li.dueDate } : old?.dueDate && { dueDate: null }),
      ...(typeof li.estimate === 'number' && li.estimate >= 0 ? { estimate: li.estimate } : old?.estimate != null && { estimate: null }),
      sortOrder: order.get(li.id)!,
      createdBy,
      ...(subscribers.length ? { subscribers } : old?.subscribers && { subscribers: [] }),
      ...(unsubscribed.length ? { unsubscribed } : old?.unsubscribed && { unsubscribed: [] }),
      createdAt: li.createdAt,
      updatedAt: li.updatedAt,
      completedAt: li.completedAt ?? li.canceledAt ?? null,
      linearId: li.id,
    }
    const before = archiveBefore(team)
    // the same rule as tidying the archive: finished that long ago and untouched since
    const last = issue.completedAt && issue.completedAt > issue.updatedAt ? issue.completedAt : issue.updatedAt
    if (!old && before && ['done', 'canceled', 'duplicate'].includes(issue.status) && last < before) {
      issue.archivedAt = now
      issue.archivedBy = ws.me
      counts.archived++
    }
    imported.set(li.id, issue)
    counts.issues++
    if (!old || !same(old, issue)) out.issues.push(issue)
  }

  // comments: matched authors keep their name; others are written by you, saying who wrote them
  const commentsByLinear = byLinearId(Object.values(ws.comments).flat())
  for (const c of [...data.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!c.body.trim() || !c.issue) continue
    const issue = imported.get(c.issue.id)
    // an issue archived here: a comment written in Linear since joins it, once (ones it has stay as they are)
    const kept = issue ? undefined : archivedHere(c.issue.id)
    const target = issue ?? kept
    if (!target) continue
    const old = commentsByLinear.get(c.id)
    if (kept && old) continue
    const author = login(c.user)
    const body = rewriteLinks(c.body, refs).replace(/\s+$/, '')
    const comment: CommentRow = {
      ...old,
      id: old?.id ?? newId(),
      issue: target.id,
      author: author ?? ws.me,
      createdAt: c.createdAt,
      body: author ? body : `*From Linear: ${c.user?.name ?? 'someone'}*\n\n${body}`,
      linearId: c.id,
    }
    counts.comments++
    if (!old || !same(old, comment)) out.comments.push(comment)
  }

  // views: the chosen teams' and the whole workspace's, with the filters that can come over
  const viewsByLinear = byLinearId(Object.values(ws.views ?? {}))
  const ctx: FilterContext = {
    states: new Map((data.states ?? []).map((st) => [st.id, st])),
    // someone matched to "no one" can't stand in a filter: "assigned to Bob" mustn't become "assigned to no one"
    person: (id) => choices.people[id] ?? undefined,
    labels: data.labels,
    label: bringLabel,
    labelHere: (name) => labelsByName.get(name.toLowerCase())?.id,
    project: (id) => projectId.get(id),
    team: (idOrKey) => {
      const t = teams.find((x) => x.id === idOrKey || x.key === idOrKey)
      return t ? keyOf(t) : undefined
    },
  }
  for (const v of data.views ?? []) {
    if (v.team && !teamIds.has(v.team.id)) continue
    const old = viewsByLinear.get(v.id)
    const { filters, exact, nothing } = mapViewFilter(v.filterData, ctx)
    if (nothing) {
      // it would show every issue, which is worse than no view: leave it out (and drop what an earlier import made)
      out.skippedViews.push(v.name)
      if (old) out.removedViews.push(old.id)
      continue
    }
    if (v.team) delete filters.teams // a team's view is about that team already
    const view: ViewRow = {
      ...old,
      id: old?.id ?? newId(),
      name: v.name,
      emoji: emojiFor(v.icon, old?.emoji ?? '🔎'),
      description: v.description ?? '',
      owner: (v.owner && choices.people[v.owner.id]) || (old && relink(old.owner)) || ws.me,
      team: v.team ? keyOf(v.team) : null,
      filters,
      // how it looks is chosen here (a later import keeps it)
      display: old?.display ?? { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true },
      createdAt: old?.createdAt ?? v.createdAt,
      linearId: v.id,
    }
    counts.views++
    if (!exact) out.inexactViews.push(v.name)
    if (!old || !same(old, view)) out.views.push(view)
  }

  return out
}
