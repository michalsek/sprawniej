/**
 * The backend as the app uses it: open one workspace and keep it up to date (workspace.ts) and save your changes
 * (writes.ts), with the real database, channels, browser and stores.
 */
import { toast } from 'sonner'
import { create } from 'zustand'
import { useData } from '@/data/store'
import { handOver } from '@/lib/beforeHide'
import { useAuth } from './auth'
import type { Existing, ImportExtras, ImportResult } from '@/features/import/linearMap'
import { cacheState } from './cacheStore'
import { getClient, type Db } from './client'
import { friendlyDbError } from './problem'
import { ImportProblem, planImport, readExisting, runImport, type ImportPlan } from './importRows'
import { watchConnection } from './connection'
import type { EventRow } from '@/data/history'
import { fetchIssueEvents } from './history'
import { browserCopy, lastCopyMiss } from './keep'
import { pictures, usePictures } from './pictures'
import { Channels, type ChannelStatus, type Topic } from './live'
import { Loader } from './load'
import { setHandle, type MyProfile } from './profiles'
import { registry } from './registry'
import { rowToPerson } from './rows'
import { useSaveStatus } from './status'
import { DELAYS, Lifecycle, LiveWorkspace, type BackendState, type WritesHooks } from './workspace'
import { leaveWorkspace } from './workspaces'
import { attach, debugWrites, detach, flush, pending, startWrites, started, stopWrites, writesStatus } from './writes'
import { postgrest } from './writes/send'

export type { BackendState, Phase } from './workspace'

export const useBackend = create<BackendState>()(() => ({ phase: 'closed' }))

const writes: WritesHooks = {
  attach(target) {
    const db = getClient()
    if (!db) return
    // one writer per open session; a workspace read again from the start keeps the one it has
    if (!started()) startWrites({ transport: postgrest(db), tell: (m) => toast(m), onStatus: () => life.current?.refresh() })
    attach(target)
  },
  // the screen is about to go: fields hand over what you typed first, so it's saved too
  detach() {
    handOver()
    detach()
  },
  finish: async (ms) => {
    handOver()
    await flush(ms)
    stopWrites()
  },
  stop: stopWrites,
  status: writesStatus,
}

const life: Lifecycle = new Lifecycle(
  (workspaceId: string, me: MyProfile) => {
    const db = getClient()
    if (!db) return null
    const ws: LiveWorkspace = new LiveWorkspace(
      {
        reader: new Loader(db, workspaceId, me.id),
        channels: (on) => new Channels(db, workspaceId, me.id, on),
        data: useData,
        status: useSaveStatus,
        backend: useBackend,
        registry,
        online: () => navigator.onLine,
        signedIn: () => !!useAuth.getState().user,
        watch: watchConnection,
        reopen: () => life.reopen(ws),
        delays: DELAYS,
        writes,
        now: () => Date.now(),
        copy: browserCopy(workspaceId, me.id, () => !!useAuth.getState().user),
      },
      workspaceId,
      me,
    )
    return ws
  },
  useBackend,
  registry,
  { writes, closed: () => forget() },
)

/** whether the open workspace's copy is kept, and if not why (the browser, or this workspace: too big, gone) */
function copyState(ws: LiveWorkspace | null): { off: boolean; reason?: string } {
  const all = cacheState()
  const mine = ws?.keeper.reason
  return all.off || !mine ? all : { off: true, reason: mine }
}

/**
 * What belongs to one open workspace and is kept in memory beside the store (pictures' signed addresses, which
 * work for whoever holds them; read history): forgotten when it closes for good (switching workspace, signing out)
 * or goes away (deleted, or you were removed).
 */
const forgetting: (() => void)[] = [() => pictures.clear()]
export function onForget(fn: () => void): void {
  forgetting.push(fn)
}
function forget() {
  for (const fn of forgetting) fn()
}
useBackend.subscribe((s, was) => {
  if (s.phase === 'gone' && was.phase !== 'gone') forget()
})

const CLOSED_CHANNELS: Record<Topic, ChannelStatus> = { ws: 'CLOSED', me: 'CLOSED' }

const NOT_OPEN = 'Open the workspace to import into first.'
let importing = false

/** the open workspace and the connection, for the import */
function openForImport(): { ws: LiveWorkspace; db: Db } {
  const ws = life.current
  const db = getClient()
  if (!ws || ws.closed || !db || useBackend.getState().phase !== 'open') throw new ImportProblem(NOT_OPEN)
  return { ws, db }
}

export const backend = {
  open: (workspaceId: string, me: MyProfile): Promise<void> => life.open(workspaceId, me),
  /** closing: what's waiting gets a moment to be sent first */
  close: (): Promise<void> => life.close(),
  /** you leave the open workspace, and it closes (no "You're no longer in this workspace" for your own leaving) */
  leave: (): Promise<void> => life.leave(leaveWorkspace),
  /** read what changed since the last change we know of (scripted checks call it too) */
  catchUp: (): Promise<void> => life.current?.catchUp() ?? Promise.resolve(),
  /** archived issues into the store, once per opening */
  loadArchive: (): void => life.current?.loadArchive(),
  /** sends what's still waiting now; done once it's saved, or can't be for now, or after `ms` */
  flush: (ms?: number): Promise<void> => flush(ms).then(() => {}),
  /** changes still waiting to be saved */
  pending,
  /** how many archived issues a team has */
  countArchived: (teamKey: string): Promise<number> => life.current?.countArchived(teamKey) ?? Promise.resolve(0),
  /** what the Linear import needs to know that the store doesn't hold (importRows.ts) */
  readExisting: async (): Promise<ImportExtras> => {
    const { ws, db } = openForImport()
    try {
      return await readExisting(db, ws.workspaceId, registry)
    } catch (e) {
      console.error('Sprawniej couldn’t read what the import needs', e)
      throw new ImportProblem(friendlyDbError(e, "We couldn't check what's here already. Try again in a moment."))
    }
  },
  /** the steps an import takes (pure, apart from the new teams' ids) */
  planImport: (r: ImportResult, existing: Existing): ImportPlan => {
    const { ws } = openForImport()
    return planImport(r, existing, { workspaceId: ws.workspaceId, registry, newTeamId: () => crypto.randomUUID() })
  },
  /**
   * Saves an import. Your own changes are sent first; catching up waits until the end and happens once then (an
   * import sends one "catch up" per batch), archived issues included. Returns how many rows changed.
   */
  importRows: async (plan: ImportPlan, progress: (saved: number, total: number) => void): Promise<number> => {
    if (importing) throw new ImportProblem('An import is already running.')
    const { ws, db } = openForImport()
    if (plan.workspaceId !== ws.workspaceId) throw new ImportProblem(NOT_OPEN)
    importing = true
    try {
      await flush()
      ws.holdCatchUp()
      try {
        return await runImport(db, ws.workspaceId, plan, progress)
      } finally {
        // catching up reads every changed row, archived ones too: an archive already read gets them as well
        await ws.releaseCatchUp()
      }
    } finally {
      importing = false
    }
  },
  /** an issue's history events after `afterId`, oldest first (src/data/history.ts reads them) */
  history: (issueId: string, afterId?: number): Promise<EventRow[]> => {
    const ws = life.current
    const db = getClient()
    if (!ws || ws.closed || !db) return Promise.reject(new Error('No workspace is open.'))
    return fetchIssueEvents(db, ws.workspaceId, issueId, afterId)
  },
  /** changes your @handle (profiles.ts); the open workspace shows it at once, before its live change comes back */
  setHandle: async (handle: string): Promise<MyProfile> => {
    const row = await setHandle(handle)
    life.current?.apply([{ from: 'fetch', table: 'profiles', rows: [row] }])
    return { id: row.id, person: rowToPerson(row) }
  },
  /** for scripted checks */
  debug: () => {
    const ws = life.current
    return {
      phase: useBackend.getState().phase,
      workspaceId: ws?.workspaceId ?? null,
      profileId: ws?.me.id ?? null,
      mark: ws?.live.mark ?? null,
      channels: ws?.channels && !ws.closed ? { ...ws.channels.status } : { ...CLOSED_CHANNELS },
      catchUps: ws?.catchUps ?? 0,
      writes: debugWrites(),
      pictures: Object.keys(usePictures.getState().entries).length,
      cache: { source: ws?.source ?? null, savedAt: ws?.keeper.keptAt ?? null, saving: ws?.keeper.saving ?? false, miss: lastCopyMiss(), ...copyState(ws) },
    }
  },
  /** keep the copy of the open workspace now (scripted checks) */
  saveCache: (): Promise<void> => life.current?.keepNow() ?? Promise.resolve(),
}

export const loadArchive = backend.loadArchive

// the page goes (closed, reloaded, or another page opened in it): the copy is kept at once
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void life.current?.keepAtOnce())
