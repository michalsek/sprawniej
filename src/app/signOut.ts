import { backend } from '@/backend'
import { signOutLocally } from '@/backend/auth'
import { resetProjection } from '@/data/project'
import { useData, EMPTY } from '@/data/store'
import { useSession } from '@/session'
import { wipeAllCopies } from '@/sync/local'

/** what the GitHub version kept in this browser: its session (with a GitHub key) and its copies of workspaces */
const OLD_SESSION = 'sprawniej-session'
const OLD_GONE = 'sprawniej:old-copies-gone'

/** once per browser, at start: the GitHub version's key and copies go */
export function forgetOldVersion() {
  if (localStorage.getItem(OLD_GONE)) return
  localStorage.removeItem(OLD_SESSION)
  wipeAllCopies().then(
    () => localStorage.setItem(OLD_GONE, '1'),
    // tried again next start
    (e: unknown) => console.warn('Sprawniej couldn’t remove old copies of workspaces', e),
  )
}

/** what this browser remembers for you: the tour, skipped teams, comment drafts, display choices */
function forgetMine() {
  for (const k of Object.keys(localStorage)) {
    // the sign-out mark stays: other tabs read it to start over too
    if ((k.startsWith('sprawniej:') && k !== 'sprawniej:signing-out' && k !== OLD_GONE) || k === 'sprawniej-displays') localStorage.removeItem(k)
  }
}

/**
 * Sign out in this browser (every tab: the others hear it and start over too), forget what was on screen and what
 * the browser remembers for you, and start over at the sign-in screen (or at `then`). The open workspace closes as
 * its screen goes.
 */
export async function signOutOfThisBrowser(then = '#/') {
  // nothing that waits may be lost (phase 5); a failure here is told by the sign-out dialog, not now
  await backend.flush().catch(() => {})
  await signOutLocally()
  useSession.getState().signOut()
  resetProjection()
  useData.setState({ ...EMPTY })
  forgetMine()
  location.hash = then
  location.reload()
}

/** Back to the workspace list. Changes still waiting are sent first (they'd otherwise wait until you open it again). */
export async function switchWorkspace() {
  // as above: anything still waiting is told about, not lost silently (phase 5)
  await backend.flush().catch(() => {})
  await backend.close()
  useSession.getState().close()
  location.hash = '#/'
}
