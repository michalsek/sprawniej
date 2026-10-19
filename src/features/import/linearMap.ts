/**
 * Linear data → workspace rows. Pure (no store, no network), so every rule is unit-tested
 * (tests/linearImport.test.ts). docs/linear-import.md describes the same mapping in plain words.
 *
 * Every row keeps its Linear id in `linearId`, so running the import again updates what came over the first time
 * instead of making copies, and gives back only what is new or changed. Issues that go straight to the archive are
 * rows with `archivedAt`. People who have joined since an earlier import come back as `links` (guest → account).
 */
import { generateNKeysBetween } from 'fractional-indexing'
import { plainName as plain } from '@/data/relink'
import { dueForArchive } from '@/data/select'
import type { DataState } from '@/data/store'
import type { Priority } from '@/model/status'
import { AUTO_ARCHIVE_MONTHS, isGuest, linearIdsOf, type Comment, type Issue, type Known, type Label, type Person, type Project, type Team, type View } from '@/model/schema'
import { SUBSCRIBERS_READ, type LIssue, type LinearData, type LLabel, type LTeam, type LUser } from './linearApi'
import { mapViewFilter, type FilterContext } from './linearFilters'
import { mapStatus } from './linearStatus'

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

export { mapStatus }

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

/**
 * Links to Linear issues that came over become plain references, which open here. `refs` maps the Linear reference
 * (ENG-12) to the one here, which differs when the issue got another number or its team another key (DES-1 → DSN-4).
 */
export function rewriteLinks(md: string, refs: ReadonlyMap<string, string>): string {
  const ref = (r: string, whole: string) => refs.get(r) ?? whole
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
  /** by issue id, the comments of issues that aren't archived */
  comments: Record<string, Comment[]>
  views?: Record<string, View>
  /** archived issues that came from Linear, by Linear id: they stay archived */
  archivedByLinear: Record<string, { id: string; team: string; number: number }>
  /** comments with a Linear id on archived issues, by Linear id: they stay as they are */
  archivedComments: Record<string, { id: string; issue: string }>
  /** the emails kept for people who haven't joined, by login */
  guestEmails?: Record<string, string>
  /**
   * every number each team (by key) has used: its issues', its archived issues' and deleted ones'. The only place the
   * import looks for numbers that are taken, so none is given out twice (`existingFrom` fills it)
   */
  usedNumbers: Record<string, number[]>
}

/** what the import reads on top of what the app holds (src/backend/importRows.ts, readExisting) */
export interface ImportExtras {
  /** archived issues that came from Linear */
  archived: { id: string; linearId: string; team: string; number: number }[]
  /** comments with a Linear id on archived issues */
  archivedComments: { id: string; issue: string; linearId: string }[]
  /** every number each team (by key) ever used */
  usedNumbers: Record<string, number[]>
  /** this workspace's people from Linear who haven't joined, as they are now, with their Linear ids */
  guests: Person[]
  /** the emails kept for them, by login */
  guestEmails: Record<string, string>
}

/** the workspace as the import needs it: what the app holds, and what was read for the import */
export function existingFrom(
  ws: Pick<DataState, 'people' | 'teams' | 'issues' | 'labels' | 'projects' | 'views' | 'comments'>,
  more: ImportExtras,
  me: string,
): Existing {
  const used = new Map<string, Set<number>>()
  const mark = (team: string, n: number) => used.set(team, (used.get(team) ?? new Set()).add(n))
  for (const [team, ns] of Object.entries(more.usedNumbers)) for (const n of ns) mark(team, n)
  for (const i of Object.values(ws.issues)) mark(i.team, i.number)
  // restored since it was read: it's an issue again, not an archived one
  const archived = more.archived.filter((a) => !ws.issues[a.id])
  return {
    me,
    people: { ...ws.people, ...Object.fromEntries(more.guests.map((g) => [g.login, g])) },
    teams: ws.teams,
    issues: ws.issues,
    labels: ws.labels,
    projects: ws.projects,
    views: ws.views,
    comments: ws.comments,
    archivedByLinear: Object.fromEntries(archived.map((a) => [a.linearId, { id: a.id, team: a.team, number: a.number }])),
    archivedComments: Object.fromEntries(more.archivedComments.filter((c) => !ws.issues[c.issue]).map((c) => [c.linearId, { id: c.id, issue: c.issue }])),
    guestEmails: more.guestEmails,
    usedNumbers: Object.fromEntries([...used].map(([team, ns]) => [team, [...ns]])),
  }
}

/** someone who hasn't joined: made once, so their name and picture show */
export type GuestRow = Person & { id: string; linearId: string }
/** with an id: someone new; without: someone an earlier import made whose name or picture changed in Linear */
export type GuestUpdate = Person & { id?: string; linearId: string }
export type TeamRow = Team & { linearId: string }
export type LabelRow = Label & { linearId: string }
export type ProjectRow = Project & { linearId: string }
/** with `archivedAt`: finished long ago, so it goes straight to the archive */
export type IssueRow = Issue & { linearId: string; archivedAt?: string; archivedBy?: string }
export type CommentRow = Comment & { linearId: string }
export type ViewRow = View & { linearId: string }


/** what to write: only rows that are new or changed since an earlier import */
export interface ImportResult {
  guests: GuestUpdate[]
  /** a guest's e-mail address, when Linear knows it and it isn't kept already */
  guestEmails: { login: string; email: string }[]
  /** new teams */
  teams: TeamRow[]
  /** teams here this import brings things into that have nobody in them (an import stopped right after making them, say) */
  teamMembers: { key: string; members: string[] }[]
  /**
   * teams here that now stand for another Linear team, or (null) for none, because another team took theirs. Those
   * come first, as a Linear team stands for one team here
   */
  teamLinks: { key: string; linearId: string | null }[]
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
  /** labels taken off an issue in Linear since an earlier import */
  removedLabels: { issue: string; label: string }[]
  /** teams taken off a project in Linear since an earlier import (team by key) */
  removedProjectTeams: { project: string; team: string }[]
  /** follower rows not needed any more: these people follow the issue anyway now */
  removedFollowers: { issue: string; login: string }[]
  /**
   * what the import covers, changed or not. `archived`: of the issues, how many are in the archive (finished long ago,
   * or archived here since)
   */
  counts: { teams: number; labels: number; projects: number; issues: number; comments: number; archived: number; views: number }
  /** imported issues that couldn't keep their number, because the team here already used it ("DES-1" became "ENG-10") */
  renumbered: { from: string; to: string }[]
  /** views whose Linear filters couldn't all come over, by name */
  inexactViews: string[]
  /** views none of whose filters could come over, so they're left out, by name */
  skippedViews: string[]
}

export interface ImportOptions {
  /** an id for a new team row's things: labels, projects, issues, comments, views */
  newId: () => string
  /** an id for someone who hasn't joined */
  newGuestId: () => string
  /** the moment of the import, as ISO */
  now: string
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

/**
 * A list that was saved before, changed to `wanted`: what is still wanted keeps its place, what's new follows in
 * `wanted`'s order. Join rows are read back in the order they were added, so nothing looks changed on every import.
 */
export function keptOrder<T>(old: readonly T[], wanted: readonly T[]): T[] {
  return [...new Set([...old.filter((x) => wanted.includes(x)), ...wanted])]
}

/** someone an earlier import brought: their name and picture follow Linear's; undefined when nothing changed */
export function refreshGuest(have: Person, u: LUser): GuestUpdate | undefined {
  const name = linearName(u)
  const avatarUrl = u.avatarUrl ?? ''
  if (!linearIdsOf(have).includes(u.id) || (have.name === name && have.avatarUrl === avatarUrl)) return undefined
  return { ...have, name, avatarUrl, linearId: u.id }
}

/** follower rows of an issue that aren't needed any more (people the links move are left to them) */
function droppedFollowers(old: Issue, keep: readonly string[], relinked: ReadonlyMap<string, string>): string[] {
  const still = new Set(keep)
  return [...new Set([...(old.subscribers ?? []), ...(old.unsubscribed ?? [])])].filter((l) => !relinked.has(l) && !still.has(l))
}

/** how a comment written here for someone else starts: "*From Linear: Bob Stone*" */
const FROM_LINEAR = '*From Linear: '

/** Linear can send the same thing twice (pages that shift while we read): one of each */
function dedupe(data: LinearData): LinearData {
  const once = <T extends { id: string }>(xs: T[]) => [...new Map(xs.map((x) => [x.id, x])).values()]
  return { ...data, issues: once(data.issues), comments: once(data.comments), labels: once(data.labels), projects: once(data.projects), views: data.views && once(data.views) }
}

export function buildImport(data: LinearData, choices: ImportChoices, ws: Existing, { newId, newGuestId, now }: ImportOptions): ImportResult {
  const linear = dedupe(data)
  const counts = { teams: 0, labels: 0, projects: 0, issues: 0, comments: 0, archived: 0, views: 0 }
  const renumbered: ImportResult['renumbered'] = []
  const out: ImportResult = {
    guests: [],
    guestEmails: [],
    teams: [],
    teamMembers: [],
    teamLinks: [],
    labels: [],
    projects: [],
    issues: [],
    comments: [],
    views: [],
    links: [],
    removedViews: [],
    removedLabels: [],
    removedProjectTeams: [],
    removedFollowers: [],
    counts,
    renumbered,
    inexactViews: [],
    skippedViews: [],
  }
  const login = (u: { id: string } | null | undefined) => (u ? (choices.people[u.id] ?? null) : null)
  const teams = linear.teams.filter((t) => choices.teamKeys[t.id])
  const teamIds = new Set(teams.map((t) => t.id))
  const issues = linear.issues.filter((i) => teamIds.has(i.team.id))
  const keyOf = (t: { id: string }) => choices.teamKeys[t.id]
  const linearKey = new Map(linear.teams.map((t) => [t.id, t.key]))
  /** the teams here this import brings things into */
  const covered = new Set(teams.map(keyOf))

  // people who haven't joined: a row each, so their name and picture show (made once; later imports leave it)
  const people = ws.people ?? {}
  for (const u of linear.users) {
    const l = choices.people[u.id]
    if (!l || !isGuest(l) || out.guests.some((g) => g.login === l)) continue
    const have = people[l]
    if (!have) out.guests.push({ id: newGuestId(), login: l, githubId: 0, name: linearName(u), avatarUrl: u.avatarUrl ?? '', linearId: u.id } satisfies Known<GuestRow>)
    else {
      const refreshed = refreshGuest(have, u)
      if (refreshed) out.guests.push(refreshed)
    }
    // their email, when Linear knows it and it isn't kept yet (also when an import stopped before it got that far)
    if (u.email && ws.guestEmails?.[l] !== u.email) out.guestEmails.push({ login: l, email: u.email })
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
  /** key here → the Linear team it stands for now; two Linear teams can join the same team here, the first one decides */
  const standsFor = new Map<string, string>()
  const relinkedTeams: ImportResult['teamLinks'] = []
  teams.forEach((t: LTeam, n) => {
    const key = keyOf(t)
    if (standsFor.has(key)) return
    standsFor.set(key, t.id)
    const here = ws.teams[key]
    const theirMembers = [...new Set([ws.me, ...(members.get(key) ?? [])])]
    if (here) {
      // remember which Linear team it is, so the next import picks it again
      if (linearIdOf(here) !== t.id) relinkedTeams.push({ key, linearId: t.id })
      // nobody in it (made by an import that stopped before its members were saved, say): it gets the members a new
      // team would, so its issues show for someone
      if (!here.members.length) out.teamMembers.push({ key, members: theirMembers })
      return
    }
    out.teams.push({
      key,
      name: t.name,
      emoji: emojiFor(t.icon, TEAM_EMOJI[n % TEAM_EMOJI.length]),
      members: theirMembers,
      createdAt: now,
      linearId: t.id,
    } satisfies Known<TeamRow>)
    counts.teams++
  })
  // a team here that stood for one of these Linear teams before, and doesn't now, lets go of it first (also when two
  // teams swap, so no Linear team is ever held twice)
  const linearTeams = new Set(standsFor.values())
  for (const t of Object.values(ws.teams)) {
    const id = linearIdOf(t)
    if (id && linearTeams.has(id) && standsFor.get(t.key) !== id) out.teamLinks.push({ key: t.key, linearId: null })
  }
  out.teamLinks.push(...relinkedTeams)

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
        const linked = { ...found, linearId: l.id } satisfies Known<LabelRow>
        out.labels.push(linked)
        labelsByName.set(name.toLowerCase(), linked)
      }
      labelId.set(l.id, found.id)
      return found.id
    }
    const label = { id: newId(), name, color: l.color, linearId: l.id } satisfies Known<LabelRow>
    out.labels.push(label)
    labelsByName.set(name.toLowerCase(), label)
    labelId.set(l.id, label.id)
    counts.labels++
    return label.id
  }
  for (const l of linear.labels) if (!l.isGroup && usedLabels.has(l.id)) bringLabel(l)

  // projects: the ones these teams' issues belong to, or that belong to these teams
  const usedProjects = new Set(issues.flatMap((i) => (i.project ? [i.project.id] : [])))
  const projectsByLinear = byLinearId(Object.values(ws.projects))
  const projectId = new Map<string, string>()
  for (const p of linear.projects) {
    if (!usedProjects.has(p.id) && !p.teams.nodes.some((t) => teamIds.has(t.id))) continue
    const old = projectsByLinear.get(p.id)
    const state = p.status?.type ?? p.state ?? 'planned'
    // teams not picked this time stay on it; picked ones follow Linear (taken off there, taken off here)
    const theirs = [...new Set(p.teams.nodes.filter((t) => teamIds.has(t.id)).map(keyOf))]
    const projectTeams = keptOrder(old?.teams ?? [], [...(old?.teams ?? []).filter((k) => !covered.has(k)), ...theirs])
    if (old) for (const k of old.teams) if (!projectTeams.includes(k)) out.removedProjectTeams.push({ project: old.id, team: k })
    const project = {
      ...old,
      id: old?.id ?? newId(),
      name: p.name,
      emoji: emojiFor(p.icon, old?.emoji ?? '📦'),
      description: p.description ?? '',
      status: PROJECT_STATES[state] ?? 'planned',
      lead: login(p.lead),
      teams: projectTeams,
      targetDate: p.targetDate,
      createdAt: old?.createdAt ?? p.createdAt,
      linearId: p.id,
    } satisfies Known<ProjectRow>
    projectId.set(p.id, project.id)
    counts.projects++
    if (!old || !same(old, project)) out.projects.push(project)
  }

  // issues: keep numbers unless the team here already used one for something else
  const issuesByLinear = byLinearId(Object.values(ws.issues))
  /** an issue archived here since an earlier import: it stays as it is */
  const archivedHere = (linearId: string) => (issuesByLinear.has(linearId) ? undefined : ws.archivedByLinear[linearId])
  const idOf = new Map(issues.map((i) => [i.id, issuesByLinear.get(i.id)?.id ?? archivedHere(i.id)?.id ?? newId()]))
  const taken = new Map(Object.entries(ws.usedNumbers).map(([team, ns]) => [team, new Set(ns)]))
  const highest = new Map<string, number>()
  const raise = (team: string, n: number) => highest.set(team, Math.max(highest.get(team) ?? 0, n))
  for (const [team, used] of taken) for (const n of used) raise(team, n)
  // a moved number also goes past the ones new issues bring, so it never lands on a later one
  for (const li of issues) if (!issuesByLinear.has(li.id) && !archivedHere(li.id)) raise(keyOf(li.team), li.number)
  const plan: { li: LIssue; team: string; number: number }[] = []
  /** Linear's reference (ENG-12) → the one here, for links in descriptions and comments */
  const refs = new Map<string, string>()
  const linearRef = (li: LIssue) => `${linearKey.get(li.team.id)}-${li.number}`
  for (const li of [...issues].sort((a, b) => a.number - b.number)) {
    const kept = archivedHere(li.id)
    if (kept) {
      // archived here since: it stays as it is, and counts as in the archive
      refs.set(linearRef(li), `${kept.team}-${kept.number}`)
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
      renumbered.push({ from: `${linearKey.get(li.team.id)}-${number}`, to: `${team}-${n}` })
      number = n
    }
    used.add(number)
    refs.set(linearRef(li), `${team}-${number}`)
    plan.push({ li, team, number })
  }
  // order: issues here keep their place; new ones go on top of their team here, in Linear's order, like a new issue
  const top = new Map<string, string>()
  for (const i of Object.values(ws.issues)) if (!top.has(i.team) || i.sortOrder < top.get(i.team)!) top.set(i.team, i.sortOrder)
  const fresh = new Map<string, LIssue[]>()
  for (const { li, team } of plan) {
    if (issuesByLinear.has(li.id)) continue
    const list = fresh.get(team)
    if (list) list.push(li)
    else fresh.set(team, [li])
  }
  const order = new Map<string, string>()
  for (const [team, list] of fresh) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number)
    generateNKeysBetween(null, top.get(team) ?? null, list.length).forEach((key, n) => order.set(list[n].id, key))
  }
  /** the issue rows by Linear id, so comments find theirs */
  const imported = new Map<string, IssueRow>()
  // who commented on what, so subscribers who follow an issue anyway (by commenting) aren't listed twice
  const commenters = new Map<string, Set<string>>()
  for (const c of linear.comments) {
    const who = login(c.user)
    if (c.issue && who) commenters.set(c.issue.id, (commenters.get(c.issue.id) ?? new Set()).add(who))
  }
  for (const { li, team, number } of plan) {
    const old = issuesByLinear.get(li.id)
    const assignee = login(li.assignee)
    // who made it is kept from the first import (the links move it to someone's account): it's never changed after
    const createdBy = old ? relink(old.createdBy) : (login(li.creator) ?? ws.me)
    const implicit = new Set([assignee, createdBy, ...(commenters.get(li.id) ?? [])])
    // Linear's subscribers, plus anyone who subscribed here since an earlier import
    const theirs = new Set((li.subscribers?.nodes ?? []).map((u) => login(u)).filter((l): l is string => !!l))
    const subscribers = [...new Set([...(old?.subscribers ?? []).map(relink), ...theirs])].filter((l) => !implicit.has(l)).sort()
    // Linear subscribes creators, assignees and commenters by itself: one missing from its list unsubscribed there
    // (only when the list came in whole)
    const whole = !!li.subscribers && li.subscribers.nodes.length < SUBSCRIBERS_READ
    const left = whole ? [...implicit].filter((l): l is string => !!l && !theirs.has(l)) : []
    const unsubscribed = [...new Set([...(old?.unsubscribed ?? []).map(relink), ...left])].filter((l) => !theirs.has(l)).sort()
    // labels still wanted keep their order here, new ones follow in Linear's order (the order they are added in)
    const wanted = [...new Set(li.labels.nodes.map((l) => labelId.get(l.id)).filter((x): x is string => !!x))]
    const labels = keptOrder(old?.labels ?? [], wanted)
    if (old) {
      for (const l of old.labels) if (!labels.includes(l)) out.removedLabels.push({ issue: old.id, label: l })
      for (const l of droppedFollowers(old, [...subscribers, ...unsubscribed], relinked)) out.removedFollowers.push({ issue: old.id, login: l })
    }
    const fields = {
      ...old,
      id: idOf.get(li.id)!,
      team,
      number,
      title: li.title,
      description: rewriteLinks(li.description ?? '', refs).replace(/\s+$/, ''),
      status: mapStatus(li.state),
      priority: (li.priority >= 0 && li.priority <= 4 ? li.priority : 0) as Priority,
      assignee,
      labels,
      project: li.project ? (projectId.get(li.project.id) ?? null) : null,
      // a parent in a team not picked this time may have come over before
      parent: li.parent ? (idOf.get(li.parent.id) ?? issuesByLinear.get(li.parent.id)?.id ?? ws.archivedByLinear[li.parent.id]?.id ?? null) : null,
      ...(li.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(li.dueDate) ? { dueDate: li.dueDate } : old?.dueDate && { dueDate: null }),
      ...(typeof li.estimate === 'number' && li.estimate >= 0 ? { estimate: li.estimate } : old?.estimate != null && { estimate: null }),
      sortOrder: old?.sortOrder ?? order.get(li.id)!,
      createdBy,
      ...(subscribers.length ? { subscribers } : old?.subscribers && { subscribers: [] }),
      ...(unsubscribed.length ? { unsubscribed } : old?.unsubscribed && { unsubscribed: [] }),
      createdAt: li.createdAt,
      updatedAt: li.updatedAt,
      completedAt: li.completedAt ?? li.canceledAt ?? null,
      linearId: li.id,
    } satisfies Known<IssueRow>
    // a new issue finished longer ago than its team keeps finished issues goes straight into the archive
    const archive = !old && dueForArchive(fields, ws.teams[team]?.autoArchive ?? AUTO_ARCHIVE_MONTHS, now)
    const issue: IssueRow = archive ? { ...fields, archivedAt: now, archivedBy: ws.me } : fields
    if (archive) counts.archived++
    imported.set(li.id, issue)
    counts.issues++
    if (!old || !same(old, issue)) out.issues.push(issue)
  }

  // comments: matched authors keep their name; others are written by you, saying who wrote them
  const commentsByLinear = byLinearId(Object.values(ws.comments).flat())
  for (const c of [...linear.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!c.body.trim() || !c.issue) continue
    const issue = imported.get(c.issue.id)
    // an issue archived here: a comment written in Linear since joins it, once (ones it has stay as they are)
    const kept = issue ? undefined : archivedHere(c.issue.id)
    const target = issue ?? kept
    if (!target) continue
    const old = commentsByLinear.get(c.id)
    // counted as covered, also when it's already here and stays as it is
    counts.comments++
    if (kept && (old || ws.archivedComments[c.id])) continue
    const theirs = login(c.user)
    // who wrote it is kept from the first import (the links move it to someone's account): it's never changed after
    const author = old ? relink(old.author) : (theirs ?? ws.me)
    const body = rewriteLinks(c.body, refs).replace(/\s+$/, '')
    // the line saying who wrote it follows the author here: there when someone else stands in for the writer (a
    // comment that came in as "No one" keeps it until it's matched to its author), never on the writer's own comment
    const said = old ? old.body.startsWith(FROM_LINEAR) && author !== theirs : !theirs
    const comment = {
      ...old,
      id: old?.id ?? newId(),
      issue: target.id,
      author,
      createdAt: c.createdAt,
      body: said ? `${FROM_LINEAR}${c.user?.name ?? 'someone'}*\n\n${body}` : body,
      linearId: c.id,
    } satisfies Known<CommentRow>
    if (!old || !same(old, comment)) out.comments.push(comment)
  }

  // views: the chosen teams' and the whole workspace's, with the filters that can come over
  const viewsByLinear = byLinearId(Object.values(ws.views ?? {}))
  const ctx: FilterContext = {
    states: new Map((linear.states ?? []).map((st) => [st.id, st])),
    // someone matched to "no one" can't stand in a filter: "assigned to Bob" mustn't become "assigned to no one"
    person: (id) => choices.people[id] ?? undefined,
    labels: linear.labels,
    label: bringLabel,
    labelHere: (name) => labelsByName.get(name.toLowerCase())?.id,
    project: (id) => projectId.get(id),
    team: (idOrKey) => {
      const t = teams.find((x) => x.id === idOrKey || x.key === idOrKey)
      return t ? keyOf(t) : undefined
    },
  }
  for (const v of linear.views ?? []) {
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
    const view = {
      ...old,
      id: old?.id ?? newId(),
      name: v.name,
      emoji: emojiFor(v.icon, old?.emoji ?? '🔎'),
      description: v.description ?? '',
      // kept from the first import (the links move it to someone's account): it's never changed after
      owner: old ? relink(old.owner) : ((v.owner && choices.people[v.owner.id]) || ws.me),
      // kept too, like an issue's team: an import can't move a view to another team
      team: old ? old.team : v.team ? keyOf(v.team) : null,
      filters,
      // how it looks is chosen here (a later import keeps it)
      display: old?.display ?? { layout: 'list', grouping: 'status', ordering: 'manual', showCompleted: true, showSubIssues: true },
      createdAt: old?.createdAt ?? v.createdAt,
      linearId: v.id,
    } satisfies Known<ViewRow>
    counts.views++
    if (!exact) out.inexactViews.push(v.name)
    if (!old || !same(old, view)) out.views.push(view)
  }

  return out
}
