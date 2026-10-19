import { backend } from '@/backend'
import { signOutHere, tellOtherTabs } from '@/backend/auth'
import { resetProjection } from '@/data/project'
import { useData, EMPTY } from '@/data/store'
import { useSession } from '@/session'
import { wipeAllCopies } from '@/sync/local'

/** Sign out in this browser (every tab), forget what was on screen, and start over at the sign-in screen (or `then`). */
export async function signOutEverywhere(then = '#/') {
  await backend.flush().catch(() => {})
  await backend.close()
  resetProjection()
  useData.setState({ ...EMPTY })
  tellOtherTabs({ t: 'signed-out' })
  await signOutHere()
  useSession.getState().signOut()
  localStorage.removeItem('sprawniej-displays')
  // the GitHub version's session (it held a GitHub key) and its copies of workspaces
  localStorage.removeItem('sprawniej-session')
  await wipeAllCopies().catch(() => {})
  location.hash = then
  location.reload()
}

/** Back to the workspace list. Changes still waiting are sent first (they'd otherwise wait until you open it again). */
export async function switchWorkspace() {
  await backend.flush().catch(() => {})
  await backend.close()
  useSession.getState().close()
  location.hash = '#/'
}
