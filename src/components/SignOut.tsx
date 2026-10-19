/**
 * Signing out, the safe way: changes still waiting are sent first, and if some can't be (offline), we say so before
 * they're lost.
 */
import { useState } from 'react'
import { signOutEverywhere } from '@/app/signOut'
import { backend } from '@/backend'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'

/** `then` = where to land after signing out (default: the sign-in screen) */
export function useSignOut(then?: string) {
  const [unsaved, setUnsaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function signOut(force = false) {
    setBusy(true)
    if (!force) {
      await backend.flush().catch(() => {})
      if (backend.pending() > 0 && !navigator.onLine) {
        setBusy(false)
        setUnsaved(true)
        return
      }
    }
    await signOutEverywhere(then)
  }

  const dialog = (
    <Dialog open={unsaved} onOpenChange={(open) => !open && setUnsaved(false)}>
      <DialogContent>
        <DialogTitle>Some changes haven't been saved yet</DialogTitle>
        <DialogDescription>
          You seem to be offline. If you sign out now, those changes are lost. Connect to the internet and wait for "Saved" first.
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => setUnsaved(false)}>
            Stay signed in
          </Button>
          <Button variant="destructive" onClick={() => void signOut(true)}>
            Sign out anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { signOut: () => void signOut(), busy, dialog }
}
