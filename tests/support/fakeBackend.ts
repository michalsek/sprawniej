/**
 * An open workspace for the actions and the writer (bun test, no network): the store, a registry, a target that
 * applies rows like LiveWorkspace, and the writer attached to it, saving into the pretend database (fakeDb.ts).
 */
import { applyRows, emptyLive, type Incoming, type LiveState, type StoreSlice } from '@/backend/apply'
import { Registry } from '@/backend/registry'
import { personToProfile, teamToRows } from '@/backend/rows'
import { attach, startWrites, stopWrites, type Page, type WriteTarget } from '@/backend/writes'
import type { Request } from '@/backend/writes/send'
import { whatOf } from '@/backend/writes/send'
import { EMPTY, useData, type DataState } from '@/data/store'
import type { Person, Team } from '@/model/schema'
import { drain, FakeClock, FakeDb, profileIdOf, teamIdOf, WS } from './fakeDb'

export { drain, FakeClock, FakeDb, profileIdOf, teamIdOf, WS } from './fakeDb'

export const person = (login: string): Person => ({ login, githubId: login.length, name: login.toUpperCase(), avatarUrl: '' })

const slice = (s: DataState): StoreSlice => ({
  workspace: s.workspace,
  me: s.me,
  people: s.people,
  members: s.members,
  labels: s.labels,
  teams: s.teams,
  issues: s.issues,
  archive: s.archive,
  projects: s.projects,
  views: s.views,
  comments: s.comments,
  pullRequests: s.pullRequests,
  inbox: s.inbox,
  readState: s.readState,
})

/** like LiveWorkspace: applyRows into the store */
export class FakeTarget implements WriteTarget {
  readonly workspaceId = WS
  readonly registry: Registry
  live: LiveState = emptyLive()
  constructor(registry: Registry) {
    this.registry = registry
  }
  get meId(): string {
    return this.registry.profileId(useData.getState().me?.login ?? '') ?? ''
  }
  apply(inputs: Incoming[]) {
    if (!inputs.length) return
    const r = applyRows(this.live, slice(useData.getState()), inputs, { workspaceId: WS, meId: this.meId, registry: this.registry })
    this.live = r.state
    if (Object.keys(r.patch).length) useData.setState(r.patch)
  }
  server() {
    return this.live.server
  }
}

/** a page that only writes down how often closing the tab would ask */
export class FakePage implements Page {
  guards: boolean[] = []
  retry: (() => void) | undefined
  guard(on: boolean) {
    this.guards.push(on)
  }
  watch(retry: () => void) {
    this.retry = retry
    return () => (this.retry = undefined)
  }
}

export interface Seed {
  me: string
  people?: string[]
  teams?: (Pick<Team, 'key' | 'name'> & Partial<Team>)[]
}

export interface World {
  db: FakeDb
  target: FakeTarget
  clock: FakeClock
  page: FakePage
  told: string[]
  registry: Registry
  /** releases everything held and lets it all finish (until no more requests come) */
  settle(): Promise<void>
  /** delivers what teammates would hear (the echo of your own changes too) */
  echo(): void
  /** the requests sent from now on (of one table, notes counting as inbox) */
  since(): (table?: string) => Request[]
}

/** a workspace with these people (`me` its owner, the rest members) and teams, open, with the writer attached */
export function seed(o: Seed): World {
  stopWrites()
  const registry = new Registry()
  const logins = [...new Set([o.me, ...(o.people ?? [])])]
  const clock = new FakeClock()
  const db = new FakeDb(() => registry.profileId(useData.getState().me?.login ?? '') ?? '', clock)
  for (const l of logins) registry.learnProfile(profileIdOf(l), l)
  const teams = (o.teams ?? []).map((t): Team => ({ emoji: '', members: [], createdAt: '2026-01-01T00:00:00.000Z', lastNumber: 0, autoArchive: 6, ...t }))
  for (const t of teams) registry.learnTeam(teamIdOf(t.key), t.key)

  const at = '2026-01-01T00:00:00.000Z'
  db.put('workspaces', { id: WS, name: 'Acme', created_by: profileIdOf(o.me), created_at: at, extra: {} })
  for (const l of logins) {
    db.put('profiles', { ...personToProfile({ ...person(l), id: profileIdOf(l) } as Person, WS, registry), user_id: `u-${l}`, created_at: at })
    db.put('workspace_members', { workspace_id: WS, profile_id: profileIdOf(l), role: l === o.me ? 'owner' : 'member', joined_at: at, removed_at: null })
  }
  for (const t of teams) {
    const rows = teamToRows({ ...t, id: teamIdOf(t.key) } as Team, WS, registry)
    db.put('teams', { ...rows.teams, last_number: t.lastNumber ?? 0 })
    for (const m of rows.team_members) db.put('team_members', m)
  }

  useData.setState({ ...EMPTY, me: person(o.me) })
  const target = new FakeTarget(registry)
  target.apply([...db.tables.keys()].map((table): Incoming => ({ from: 'fetch', table, rows: db.rows(table) })))
  const page = new FakePage()
  const told: string[] = []
  startWrites({ transport: db.transport, tell: (m) => told.push(m), onStatus: () => {}, clock, page, random: () => 0.5 })
  attach(target)
  return {
    db,
    target,
    clock,
    page,
    told,
    registry,
    async settle() {
      for (let n = 0; n < 50; n++) {
        const before = db.log.length
        db.release()
        await drain()
        if (db.log.length === before && !db.busy()) return
      }
    },
    echo() {
      target.apply(db.messages().map((message): Incoming => ({ from: 'message', message })))
    },
    since() {
      const n = db.log.length
      return (table?: string) => db.log.slice(n).filter((r) => !table || whatOf(r).table === table)
    },
  }
}
