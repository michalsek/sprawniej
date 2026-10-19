/** What the save chip in the top bar says (src/app/SaveStatus.tsx), and the facts it comes from. */
import { create } from 'zustand'

export type SaveState = 'loading' | 'saved' | 'saving' | 'offline' | 'error' | 'signed-out'

export interface SaveStatus {
  state: SaveState
  detail?: string
  /** changes still on their way (phase 5; always 0 until then) */
  pending: number
  /** while opening: how far it got */
  progress?: string
  /** the first load is in (JoinTeams waits for it, so the teams it offers are current) */
  synced?: boolean
  /** Date.now() of the last finished catch-up (scripted checks read it) */
  caughtUpAt?: number
}

const START: SaveStatus = { state: 'loading', pending: 0 }

export const useSaveStatus = create<SaveStatus>()(() => ({ ...START }))

export const resetStatus = () => useSaveStatus.setState({ ...START, detail: undefined, progress: undefined, synced: undefined, caughtUpAt: undefined })

/**
 * What the chip says once a workspace is open. `channelsUp`: both live channels are joined; `failing`: catching up
 * with teammates' changes keeps failing.
 */
export function connectionState(online: boolean, channelsUp: boolean, signedIn: boolean, failing: boolean): SaveState {
  if (!signedIn) return 'signed-out'
  if (!online) return 'offline'
  if (failing || !channelsUp) return 'error'
  return 'saved'
}
