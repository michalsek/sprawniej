/** What the save chip in the top bar says (src/app/SaveStatus.tsx), and the facts it comes from. */
import { create } from 'zustand'

export type SaveState = 'loading' | 'saved' | 'saving' | 'offline' | 'reconnecting' | 'error' | 'signed-out' | 'closed'

export interface SaveStatus {
  state: SaveState
  detail?: string
  /** your changes still on their way */
  pending: number
  /** some of them failed to go and are being tried again */
  waiting?: boolean
  /** while opening: how far it got */
  progress?: string
  /** the first load is in (JoinTeams waits for it, so the teams it offers are current) */
  synced?: boolean
  /** Date.now() of the last finished catch-up (scripted checks read it) */
  caughtUpAt?: number
}

const START: SaveStatus = { state: 'loading', pending: 0, waiting: false }

export const useSaveStatus = create<SaveStatus>()(() => ({ ...START }))

export const resetStatus = () => useSaveStatus.setState({ ...START, detail: undefined, progress: undefined, synced: undefined, caughtUpAt: undefined })

/**
 * What the chip says once a workspace is open. `channelsUp`: both live channels are joined; `failing`: catching up
 * with teammates' changes keeps failing; `pending`: your changes still on their way. Not reaching
 * Sprawniej is only worth a warning when something of yours is waiting; otherwise it's a calm "Reconnecting…".
 */
export function connectionState(online: boolean, channelsUp: boolean, signedIn: boolean, failing: boolean, pending = 0): SaveState {
  if (!signedIn) return 'signed-out'
  if (!online) return 'offline'
  if (failing || !channelsUp) return pending > 0 ? 'error' : 'reconnecting'
  return pending > 0 ? 'saving' : 'saved'
}

/**
 * What the chip says, your changes first: something that failed to go and waits for another try is "Not saved yet"
 * (or "Offline"), something on its way is "Saving…". With nothing of yours waiting it is about the connection.
 */
export function chipState(
  c: { online: boolean; channelsUp: boolean; signedIn: boolean; failing: boolean },
  w: { pending: number; waiting: boolean },
): SaveState {
  if (!c.signedIn) return 'signed-out'
  if (w.pending && w.waiting) return c.online ? 'error' : 'offline'
  if (w.pending) return c.online ? 'saving' : 'offline'
  return connectionState(c.online, c.channelsUp, c.signedIn, c.failing)
}
