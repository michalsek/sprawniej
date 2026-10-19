/**
 * Signing out or switching workspace, the safe way: changes still waiting are sent first, and if some can't be (offline,
 * or Sprawniej can't be reached), we say so before they're lost.
 */
import { useState } from 'react'
import { signOutOfThisBrowser, switchWorkspace } from '@/app/signOut'
import { backend } from '@/backend'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'

/** `leave` signs out or switches; it asks first when something still isn't saved after trying to send it */
function useLeaving(leave: () => Promise<void>, words: { doing: string; stay: string; anyway: string }) {
  const [unsaved, setUnsaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function go(force = false) {
    setBusy(true)
    if (!force) {
      // what couldn't be sent shows in pending() below
      await backend.flush().catch(() => {})
      if (backend.pending() > 0) {
        setBusy(false)
        setUnsaved(true)
        return
      }
    }
    setUnsaved(false)
    await leave()
    setBusy(false)
  }

  const dialog = (
    <Dialog open={unsaved} onOpenChange={(open) => !open && setUnsaved(false)}>
      <DialogContent>
        <DialogTitle>Some changes haven't been saved yet</DialogTitle>
        <DialogDescription>
          {navigator.onLine ? "We can't reach Sprawniej right now." : 'You seem to be offline.'} If you {words.doing} now, those changes are lost. Wait
          for "Saved" first.
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => setUnsaved(false)}>
            {words.stay}
          </Button>
          <Button variant="destructive" onClick={() => void go(true)}>
            {words.anyway}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { go: () => void go(), busy, dialog }
}

/** `then` = where to land after signing out (default: the sign-in screen) */
export function useSignOut(then?: string) {
  const { go, busy, dialog } = useLeaving(() => signOutOfThisBrowser(then), { doing: 'sign out', stay: 'Stay signed in', anyway: 'Sign out anyway' })
  return { signOut: go, busy, dialog }
}

/** back to the workspace list (E118: it asks too when something isn't saved) */
export function useSwitchWorkspace() {
  const { go, busy, dialog } = useLeaving(switchWorkspace, { doing: 'switch workspace', stay: 'Stay here', anyway: 'Switch anyway' })
  return { switchWorkspace: go, busy, dialog }
}
