/**
 * Making an invite link for one person, then handing it over: copy the link, a ready-to-send message, or start an
 * email in your own mail app. For someone from Linear the link makes them that person when they join.
 */
import { useState, type SubmitEvent } from 'react'
import { Copy, Loader2, Mail, MessageSquareText } from 'lucide-react'
import { createInvite } from '@/data/actions'
import { useData } from '@/data/store'
import { INVITE_DAYS, type Invite, type InviteRole } from '@/backend/workspaces'
import { inviteMessage, inviteUrl } from '@/features/onboarding/invite'
import { Problem } from '@/features/onboarding/Step'
import type { Person } from '@/model/schema'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { copy } from './copy'

export function InviteDialog({ guest, email: knownEmail, onDone }: { guest?: Person; email?: string; onDone: (made: boolean) => void }) {
  const ws = useData((s) => s.workspace?.name ?? '')
  const [email, setEmail] = useState(knownEmail ?? '')
  const [role, setRole] = useState<InviteRole>('member')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [made, setMade] = useState<Invite>()

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setProblem(undefined)
    try {
      setMade(await createInvite({ role, forGuest: guest?.login, forEmail: email }))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "We couldn't make the link. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  const close = () => !busy && onDone(!!made)

  if (made) {
    const { url, local } = inviteUrl(made.token)
    const message = inviteMessage(url, ws, guest?.name)
    const to = made.forEmail ?? ''
    const mail = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`Join ${ws} in Sprawniej`)}&body=${encodeURIComponent(message)}`
    return (
      <Dialog open onOpenChange={(o) => !o && close()}>
        <DialogContent className="[overflow-wrap:anywhere] sm:max-w-lg">
          <DialogTitle>Send this link to {guest?.name ?? (to || 'them')}</DialogTitle>
          <DialogDescription>You'll find it under Invite links until it's used.</DialogDescription>
          <Input readOnly value={url} className="h-10 font-mono text-sm" onFocus={(e) => e.target.select()} aria-label="Invite link" />
          {local && (
            <p className="text-sm text-muted-foreground">
              Sprawniej is running on this computer, so this link only works here, for example in another browser on this computer. Links made in the
              published app work for everyone.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => copy(message, 'Message')}>
              <MessageSquareText /> Copy message
            </Button>
            <Button variant="outline" onClick={() => copy(url, 'Link')}>
              <Copy /> Copy link
            </Button>
            {to && (
              <Button variant="outline" asChild>
                <a href={mail}>
                  <Mail /> Write an email
                </a>
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="[overflow-wrap:anywhere] sm:max-w-lg">
        <DialogTitle>{guest ? `Invite ${guest.name}` : 'Invite someone'}</DialogTitle>
        <DialogDescription>
          {guest
            ? `When they join with this link, they become ${guest.name}: their issues, comments and views from Linear are theirs.`
            : `Make a link and send it to them. It works once, for ${INVITE_DAYS} days.`}
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div>
            <label htmlFor="invite-email" className="mb-1.5 block text-sm font-medium">
              Their email (optional)
            </label>
            <Input id="invite-email" type="email" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="mt-1.5 text-sm text-muted-foreground">{guest && knownEmail ? 'Their email in Linear.' : 'So you remember where to send it.'}</p>
          </div>
          <div>
            <label htmlFor="invite-role" className="mb-1.5 block text-sm font-medium">
              Role
            </label>
            <Select value={role} onValueChange={(v) => setRole(v === 'admin' ? 'admin' : 'member')}>
              <SelectTrigger id="invite-role" className="h-10 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-sm text-muted-foreground">Admins can invite people, change roles and delete teams.</p>
          </div>
          <Problem>{problem}</Problem>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Create link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
