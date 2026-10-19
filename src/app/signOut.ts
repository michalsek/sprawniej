import { backend } from '@/backend'
import { ADDING_KEY, signOutLocally } from '@/backend/auth'
import { JOINING_KEY } from '@/features/onboarding/invite'
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
  // the sign-out dialog already asked about anything that couldn't be sent
  await backend.flush(3_000).catch(() => {})
  await signOutLocally()
  useSession.getState().signOut()
  resetProjection()
  useData.setState({ ...EMPTY })
  forgetMine()
  // a Join pressed or a way to sign in being added belong to whoever was signed in
  for (const k of [ADDING_KEY, JOINING_KEY]) sessionStorage.removeItem(k)
  location.hash = then
  location.reload()
}

/** Back to the workspace list. Changes still waiting get a moment to be sent first (useSwitchWorkspace asks before). */
export async function switchWorkspace() {
  await backend.close()
  useSession.getState().close()
  location.hash = '#/'
}
