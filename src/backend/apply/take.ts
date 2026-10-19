/**
 * Taking in what arrives: rows go into the copy of the database (newer wins), your own changes into `local`, and
 * everything touched is written down as dirty, so derive.ts works out only those things again.
 */
import { keyOf, keyString, parseKey, type AnyChange } from '../changes'
import { compareMicros, compareStamp, micros } from '../rows'
import { isLiveTable, type DeletionRow, type LiveTable, type Message, type Row } from '../tables'
import { Copier, MirrorDraft, parentOf, type Grouped } from './mirror'
import type { ApplyContext, Incoming, Kind, LiveState, Pending, Ref } from './state'
import { equal } from '@/lib/equal'

type Loose = Readonly<Record<string, unknown>>

export const localKey = (table: LiveTable, key: Loose) => `${table}:${keyString(table, key)}`

/** a row's changed_at, when it has one */
export const stampOf = (row: Loose | undefined): string | undefined => {
  const at = row?.changed_at
  return typeof at === 'string' ? at : undefined
}

/** the later of two raw times */
const later = (a: string | undefined, b: string | undefined): string => (compareStamp(a, b) >= 0 ? (a ?? '') : (b ?? ''))

/** the things to work out again */
export class Dirty {
  readonly ids: Record<Kind, Set<string>> = {
    person: new Set(),
    member: new Set(),
    team: new Set(),
    label: new Set(),
    project: new Set(),
    issue: new Set(),
    view: new Set(),
    inbox: new Set(),
  }
  readState = false
  workspace = false

  add(kind: Kind, id: unknown) {
    if (typeof id === 'string' && id) this.ids[kind].add(id)
  }
}

export class Intake {
  readonly dirty = new Dirty()
  catchUp = false
  workspaceGone = false
  private live: LiveState
  private mirror: MirrorDraft
  private copier = new Copier()
  private ctx: ApplyContext
  private wanted = new Map<string, { table: LiveTable; key: Record<string, string> }>()
  private markAt: bigint | null
  /** `local` by table, made when first needed and again after `local` changes */
  private locals: Map<string, [string, Pending][]> | null = null

  constructor(state: LiveState, ctx: ApplyContext) {
    this.live = this.copier.copy(state)
    this.mirror = new MirrorDraft(state.server, this.copier)
    this.ctx = ctx
    this.markAt = state.mark ? micros(state.mark) : null
  }

  state(): LiveState {
    return { ...this.live, server: this.mirror.current }
  }

  fetch(): { table: LiveTable; key: Record<string, string> }[] {
    return [...this.wanted.values()]
  }

  take(input: Incoming) {
    switch (input.from) {
      case 'fetch':
        for (const row of input.rows) this.whole(input.table, row)
        if (input.keys) this.fetched(input.table, input.keys)
        break
      case 'message':
        this.message(input.message)
        break
      case 'deletions':
        for (const d of input.rows) this.deletion(d)
        break
      case 'local':
        this.applyLocal(input.change)
        break
      case 'settled':
        this.settled(input.change, input.ok, input.ok ? input.row : undefined)
        break
    }
  }

  // ---------- reading: the database's row with your changes on top ----------

  shown<N extends LiveTable>(t: N, key: Loose): Row<N> | undefined {
    const k = localKey(t, key)
    if (this.live.localGone[k]) return undefined
    const s = this.mirror.get(t, key)
    const p = this.live.local[k]
    if (!p) return s
    if (!s && !p.insert) return undefined
    return Object.assign({ ...key }, s, ...p.writes) as Row<N>
  }

  /** a parent's join rows (or comments), your own inserts included */
  fold<N extends Grouped>(t: N, parent: string): Row<N>[] {
    const found = new Map<string, Row<N>>()
    for (const row of this.mirror.group(t, parent)) {
      const v = this.shown(t, row)
      if (v) found.set(keyString(t, row), v)
    }
    for (const [ks, p] of this.localsOf(t)) {
      if (!p.insert || found.has(ks)) continue
      const v = this.shown(t, parseKey(t, ks))
      if (v && parentOf(t, v) === parent) found.set(ks, v)
    }
    return [...found.values()]
  }

  /** `ref` uses an id we don't know: it waits for it, and the row is asked for (once until it's back) */
  miss(id: string, table: 'profiles' | 'teams', ref: Ref) {
    const k = localKey(table, { id })
    if (!this.live.asked[k]) {
      this.edit('asked')[k] = true
      this.want(table, { id })
    }
    const refs = this.live.waiting[id] ?? []
    if (!refs.some((r) => r.kind === ref.kind && r.id === ref.id)) this.edit('waiting')[id] = [...refs, ref]
  }

  private localsOf(t: LiveTable): [string, Pending][] {
    if (!this.locals) {
      this.locals = new Map()
      for (const [k, p] of Object.entries(this.live.local)) {
        const at = k.indexOf(':')
        const table = k.slice(0, at)
        const list = this.locals.get(table)
        if (list) list.push([k.slice(at + 1), p])
        else this.locals.set(table, [[k.slice(at + 1), p]])
      }
    }
    return this.locals.get(t) ?? []
  }

  // ---------- small helpers ----------

  private edit<K extends 'local' | 'localGone' | 'gone' | 'partial' | 'waiting' | 'asked'>(f: K): Record<string, LiveState[K][string]> {
    if (f === 'local') this.locals = null
    const copy = this.copier.copy(this.live[f])
    this.live[f] = copy
    return copy as Record<string, LiveState[K][string]>
  }

  /** a key with every key column, or nothing */
  private want(table: LiveTable, key: Loose) {
    const k = keyOf(table, key)
    if (k) this.wanted.set(localKey(table, k), { table, key: k })
  }

  private advance(at: string | undefined) {
    if (!at) return
    const m = micros(at)
    if (m === null || compareMicros(m, this.markAt) <= 0) return
    this.live.mark = at
    this.markAt = m
  }

  private setGone(k: string, at: string) {
    const was = this.live.gone[k]
    if (was === undefined || compareStamp(at, was) > 0) this.edit('gone')[k] = at
  }

  private setPartial(k: string, on: boolean) {
    if (on) {
      if (!this.live.partial[k]) this.edit('partial')[k] = true
    } else if (this.live.partial[k]) delete this.edit('partial')[k]
  }

  /** marks what this row is part of as dirty */
  private touch(t: LiveTable, row: Loose | undefined) {
    if (!row) return
    const d = this.dirty
    switch (t) {
      case 'workspaces':
        d.workspace = true
        break
      case 'profiles':
        d.add('person', row.id)
        break
      case 'workspace_members':
        d.add('member', row.profile_id)
        break
      case 'teams':
        d.add('team', row.id)
        break
      case 'team_members':
        d.add('team', row.team_id)
        break
      case 'labels':
        d.add('label', row.id)
        break
      case 'projects':
        d.add('project', row.id)
        break
      case 'project_teams':
        d.add('project', row.project_id)
        break
      case 'issues':
        d.add('issue', row.id)
        break
      case 'issue_labels':
      case 'issue_followers':
        d.add('issue', row.issue_id)
        break
      case 'comments':
        d.add('issue', row.issue_id ?? (typeof row.id === 'string' ? this.mirror.issueOf(row.id) : undefined))
        break
      case 'views':
        d.add('view', row.id)
        break
      case 'inbox':
        d.add('inbox', row.id)
        break
      case 'read_state':
        d.readState = true
        break
    }
  }

  /** a profile or team row: the registry learns its login or key, and what waited for it is worked out again */
  private learn(t: LiveTable, row: Loose) {
    const id = row.id
    if (typeof id !== 'string') return
    if (t === 'profiles' && typeof row.login === 'string') this.ctx.registry.learnProfile(id, row.login)
    else if (t === 'teams' && typeof row.key === 'string') this.ctx.registry.learnTeam(id, row.key)
    else return
    if (this.live.asked[localKey(t, { id })]) delete this.edit('asked')[localKey(t, { id })]
    const refs = this.live.waiting[id]
    if (!refs) return
    for (const ref of refs) this.dirty.add(ref.kind, ref.id)
    delete this.edit('waiting')[id]
  }

  /** is this message about the open workspace (and, for read marks, about you)? */
  private ours(t: LiveTable, row: Loose): boolean {
    if (t === 'workspaces') return row.id === this.ctx.workspaceId
    if ('workspace_id' in row && row.workspace_id !== this.ctx.workspaceId) return false
    if (t === 'read_state' && row.profile_id !== this.ctx.meId) return false
    return true
  }

  // ---------- rows from the database ----------

  /** a whole row (fetched, inserted, or returned by a write): kept if newer */
  private whole(t: LiveTable, row: Loose) {
    const key = keyOf(t, row)
    if (!key) return
    this.learn(t, row)
    const at = stampOf(row)
    this.advance(at)
    const k = localKey(t, key)
    const gone = this.live.gone[k]
    if (gone !== undefined && compareStamp(at, gone) <= 0) return
    const old = this.mirror.get(t, key)
    const partial = row.partial === true
    if (old) {
      const c = compareStamp(at, stampOf(old))
      // the same time again is nothing new, unless it brings the text a partial row left out
      if (c < 0 || (c === 0 && (partial || !this.live.partial[k]))) return
    }
    const { partial: _partial, ...clean } = row
    // a row too big to send keeps the text we have (if any) until the whole row comes
    const next = partial && old ? { ...pick(old, 'description', 'body'), ...clean } : clean
    this.mirror.put(t, next as Row<typeof t>)
    this.setPartial(k, partial)
    if (partial) this.want(t, key)
    this.touch(t, old)
    this.touch(t, next)
  }

  /** an UPDATE message: only the changed columns */
  private update(t: LiveTable, row: Loose) {
    const key = keyOf(t, row)
    if (!key) return
    const k = localKey(t, key)
    const old = this.mirror.get(t, key)
    const at = stampOf(row)
    if (!old) {
      // the whole inbox is loaded, and notes from your other workspaces come on the same channel
      if (t === 'inbox') return
      this.advance(at)
      const gone = this.live.gone[k]
      if (gone !== undefined && compareStamp(at, gone) <= 0) return
      // fetched whole: it will be at least as new as this
      this.want(t, key)
      return
    }
    this.advance(at)
    if (compareStamp(at, stampOf(old)) <= 0) return
    const { partial, ...clean } = row
    const next = { ...old, ...clean }
    this.mirror.put(t, next as Row<typeof t>)
    if (partial === true) {
      this.setPartial(k, true)
      this.want(t, key)
    } else if ('description' in clean || 'body' in clean) this.setPartial(k, false)
    this.touch(t, old)
    this.touch(t, next)
  }

  /** a row went; so do its join rows and comments, each remembered as gone so an older copy can't come back */
  private forget(t: LiveTable, key: Loose, old: Loose, at: string) {
    const k = localKey(t, key)
    this.touch(t, old)
    this.mirror.remove(t, key)
    this.setPartial(k, false)
    this.setGone(k, later(at, stampOf(old)))
    const id = key.id
    if (typeof id !== 'string') return
    const children: Grouped[] = t === 'issues' ? ['issue_labels', 'issue_followers', 'comments'] : t === 'teams' ? ['team_members'] : t === 'projects' ? ['project_teams'] : []
    for (const ct of children) {
      for (const child of this.mirror.dropGroup(ct, id)) {
        const ck = localKey(ct, child)
        this.setPartial(ck, false)
        this.setGone(ck, later(at, stampOf(child)))
      }
    }
  }

  private message(m: Message) {
    if (m.op === 'catch_up') {
      this.catchUp = true
      return
    }
    const t = m.table
    // a message from a newer database, or a broken one, is skipped
    if (!isLiveTable(t) || !m.row || typeof m.row !== 'object' || !this.ours(t, m.row)) return
    if (m.op === 'INSERT') this.whole(t, m.row)
    else if (m.op === 'UPDATE') this.update(t, m.row)
    else {
      const key = keyOf(t, m.row)
      if (!key) return
      if (t === 'workspaces') this.workspaceGone = true
      const old = this.mirror.get(t, key)
      // a DELETE carries no time: the row's last change stands in for it
      if (old) this.forget(t, key, old, stampOf(old) ?? '')
      else this.setGone(localKey(t, key), '')
    }
  }

  private deletion(d: DeletionRow) {
    if (d.workspace_id !== this.ctx.workspaceId || !isLiveTable(d.table_name)) return
    const t = d.table_name
    const key = keyOf(t, d.row_key && typeof d.row_key === 'object' && !Array.isArray(d.row_key) ? d.row_key : {})
    if (!key) return
    this.advance(d.deleted_at)
    const old = this.mirror.get(t, key)
    // a row made again after it was deleted (the same label put back on an issue) stays
    if (old && compareStamp(stampOf(old), d.deleted_at) <= 0) this.forget(t, key, old, d.deleted_at)
    else this.setGone(localKey(t, key), d.deleted_at)
  }

  /** these keys were asked for: the ones that didn't come back may be asked for again */
  private fetched(t: LiveTable, keys: readonly Record<string, string>[]) {
    for (const key of keys) {
      const k = localKey(t, key)
      if (this.live.asked[k] && !this.mirror.get(t, key)) delete this.edit('asked')[k]
    }
  }

  // ---------- your own changes ----------

  private applyLocal(c: AnyChange) {
    const k = localKey(c.table, c.key)
    const before = this.shown(c.table, c.key)
    if (c.op === 'delete') {
      if (this.live.local[k]) delete this.edit('local')[k]
      this.edit('localGone')[k] = true
    } else {
      if (this.live.localGone[k]) delete this.edit('localGone')[k]
      const p = this.live.local[k]
      const sent = { ...c.fields, ...c.guess }
      this.edit('local')[k] = { insert: !!p?.insert || c.op === 'insert', writes: [...(p?.writes ?? []), sent] }
      this.learn(c.table, { ...c.key, ...sent })
    }
    this.touch(c.table, { ...c.key, ...before })
    this.touch(c.table, { ...c.key, ...this.shown(c.table, c.key) })
  }

  private settled(c: AnyChange, ok: boolean, row: Loose | undefined) {
    const k = localKey(c.table, c.key)
    const before = this.shown(c.table, c.key)
    if (c.op === 'delete') {
      if (this.live.localGone[k]) delete this.edit('localGone')[k]
      const old = this.mirror.get(c.table, c.key)
      if (ok && old) this.forget(c.table, c.key, old, stampOf(row) ?? stampOf(old) ?? '')
    } else {
      if (ok && row) this.whole(c.table, row)
      const p = this.live.local[k]
      if (p && !ok && c.op === 'insert') delete this.edit('local')[k]
      else if (p) {
        const sent = { ...c.fields, ...c.guess }
        const at = p.writes.findIndex((w) => equal(w, sent))
        const writes = at < 0 ? p.writes : p.writes.filter((_, n) => n !== at)
        // once the database has the row, it no longer shows on its own
        const insert = p.insert && !(ok && c.op === 'insert' && this.mirror.get(c.table, c.key))
        if (writes.length) this.edit('local')[k] = { insert, writes }
        else delete this.edit('local')[k]
      }
    }
    this.touch(c.table, { ...c.key, ...before })
    this.touch(c.table, { ...c.key, ...this.shown(c.table, c.key) })
  }
}

const pick = (row: Loose, ...cols: string[]): Record<string, unknown> => Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]))
