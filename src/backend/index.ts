/**
 * The backend as the app uses it: open one workspace and keep it up to date (workspace.ts) and save your changes
 * (writes.ts), with the real database, channels, browser and stores.
 */
import { toast } from 'sonner'
import { create } from 'zustand'
import { useData } from '@/data/store'
import { handOver } from '@/lib/beforeHide'
import { useAuth } from './auth'
import { encode, inputsOf, type CacheId } from './cache'
import { cacheProject, cacheState, dropCache, readCache, writeCache } from './cacheStore'
import { getClient } from './client'
import { watchConnection } from './connection'
import { Channels, type ChannelStatus, type Topic } from './live'
import { Loader } from './load'
import type { MyProfile } from './profiles'
import { registry } from './registry'
import { useSaveStatus } from './status'
import { DELAYS, Lifecycle, LiveWorkspace, type BackendState, type CopyHooks, type WritesHooks } from './workspace'
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

/** why the last opening read everything (scripted checks read it) */
let lastMiss: string | null = null

/** the copy of one workspace kept in this browser, for one person */
function keptCopy(workspaceId: string, profileId: string): CopyHooks {
  const id: CacheId = { project: cacheProject(), profileId, workspaceId }
  return {
    quiet: 3_000,
    most: 30_000,
    async read() {
      const r = await readCache(id, Date.now())
      lastMiss = 'miss' in r ? r.miss : null
      if ('miss' in r) return null
      return { inputs: inputsOf(r.body), mark: r.meta.mark, caughtUpAt: r.meta.caughtUpAt, archive: r.meta.archive }
    },
    async write({ live, mark, caughtUpAt, archive }) {
      // signed out (or "Please sign in again"): nothing more is kept
      if (!useAuth.getState().user || cacheState().off) return false
      const o = { id, mark, caughtUpAt, archive, now: Date.now() }
      const entry = encode(live, o)
      if (!entry) {
        await dropCache(id)
        return false
      }
      return (await writeCache(entry, () => encode(live, { ...o, small: true }))) !== 'off'
    },
    drop: () => dropCache(id),
  }
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
        copy: keptCopy(workspaceId, me.id),
      },
      workspaceId,
      me,
    )
    return ws
  },
  useBackend,
  registry,
  writes,
)

const CLOSED_CHANNELS: Record<Topic, ChannelStatus> = { ws: 'CLOSED', me: 'CLOSED' }

export const backend = {
  open: (workspaceId: string, me: MyProfile): Promise<void> => life.open(workspaceId, me),
  /** closing: what's waiting gets a moment to be sent first */
  close: (): Promise<void> => life.close(),
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
      cache: { source: ws?.source ?? null, savedAt: ws?.keptAt ?? null, miss: lastMiss, ...cacheState() },
    }
  },
  /** keep the copy of the open workspace now (scripted checks) */
  saveCache: (): Promise<void> => life.current?.keepNow() ?? Promise.resolve(),
}

export const loadArchive = backend.loadArchive

// closing the tab: the copy is kept (hiding it already started that; this is for browsers that skip it)
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void life.current?.keepNow())
