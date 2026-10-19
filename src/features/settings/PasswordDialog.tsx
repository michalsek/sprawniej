/** Setting or changing your password (its own small form, sent with its button). */
import { useState, type SubmitEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyAuthError, setPassword } from '@/backend/auth'
import { Problem } from '@/features/onboarding/Step'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { passwordProblem } from './password'

export function PasswordDialog({ change, email, onDone }: { change: boolean; email: string; onDone: (saved: boolean) => void }) {
  const [password, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const wrong = passwordProblem(password, again)
    if (wrong) return setProblem(wrong)
    setBusy(true)
    setProblem(undefined)
    try {
      await setPassword(password)
      toast(change ? 'Password changed.' : 'Password set. You can sign in with it from now on.')
      onDone(true)
    } catch (err) {
      setProblem(friendlyAuthError(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onDone(false)}>
      <DialogContent className="[overflow-wrap:anywhere] sm:max-w-md">
        <DialogTitle>{change ? 'Change your password' : 'Set a password'}</DialogTitle>
        <DialogDescription>{change ? `For signing in with ${email}.` : `Then you can also sign in with ${email} and this password.`}</DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium">
              New password
            </label>
            <Input id="new-password" type="password" autoComplete="new-password" autoFocus className="h-10" value={password} onChange={(e) => setPw(e.target.value)} />
            <p className="mt-1.5 text-sm text-muted-foreground">At least 8 characters.</p>
          </div>
          <div>
            <label htmlFor="new-password-again" className="mb-1.5 block text-sm font-medium">
              Type it again
            </label>
            <Input id="new-password-again" type="password" autoComplete="new-password" className="h-10" value={again} onChange={(e) => setAgain(e.target.value)} />
          </div>
          <Problem>{problem}</Problem>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onDone(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !password}>
              {busy && <Loader2 className="animate-spin" />} {change ? 'Change password' : 'Set password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
