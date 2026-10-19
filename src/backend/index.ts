/**
 * The backend as the app uses it: open one workspace and keep it up to date (workspace.ts), with the real database,
 * channels, browser and stores.
 *
 * Saving comes in phase 5: until then actions still change the store the old way, and nothing they do is saved.
 */
import { create } from 'zustand'
import { useData } from '@/data/store'
import { useAuth } from './auth'
import { getClient } from './client'
import { watchConnection } from './connection'
import { Channels, type ChannelStatus, type Topic } from './live'
import { Loader } from './load'
import type { MyProfile } from './profiles'
import { registry } from './registry'
import { useSaveStatus } from './status'
import { DELAYS, Lifecycle, LiveWorkspace, type BackendState } from './workspace'

export type { BackendState, Phase } from './workspace'

export const useBackend = create<BackendState>()(() => ({ phase: 'closed' }))

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
      },
      workspaceId,
      me,
    )
    return ws
  },
  useBackend,
  registry,
)

const CLOSED_CHANNELS: Record<Topic, ChannelStatus> = { ws: 'CLOSED', me: 'CLOSED' }

export const backend = {
  open: (workspaceId: string, me: MyProfile): Promise<void> => life.open(workspaceId, me),
  close: (): Promise<void> => life.close(),
  /** read what changed since the last change we know of (scripted checks call it too) */
  catchUp: (): Promise<void> => life.current?.catchUp() ?? Promise.resolve(),
  /** archived issues into the store, once per opening */
  loadArchive: (): void => life.current?.loadArchive(),
  /** sends what's still waiting (phase 5) */
  flush: (): Promise<void> => Promise.resolve(),
  /** changes still waiting (phase 5) */
  pending: (): number => 0,
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
    }
  },
}

export const loadArchive = backend.loadArchive
