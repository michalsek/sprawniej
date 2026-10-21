/**
 * Making an invite link, then handing it over: copy the link, a ready-to-send message, or start an email in your own
 * mail app. A link is for one person, for up to a number of people, or for anyone who has it, and works for a week,
 * two weeks or as many days as you pick. For someone from Linear it is for that one person, who becomes them when
 * they join.
 */
import { useState, type SubmitEvent } from 'react'
import { Copy, Loader2, Mail, MessageSquareText } from 'lucide-react'
import { createInvite } from '@/data/actions'
import { useData } from '@/data/store'
import { expiresAtFor, MAX_INVITE_DAYS, MAX_INVITE_PEOPLE, type Invite, type InviteRole } from '@/backend/workspaces'
import { Segmented } from '@/components/Segmented'
import { inviteMessage, inviteUrl, untilText } from '@/features/onboarding/invite'
import { Problem } from '@/features/onboarding/Step'
import { useNow } from '@/lib/useNow'
import type { Person } from '@/model/schema'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { copy } from './copy'
import { wholeIn } from './inviteText'

type Who = 'one' | 'several' | 'anyone'
type Length = '7' | '14' | 'custom'

const label = 'mb-1.5 block text-sm font-medium'
const hint = 'mt-1.5 text-sm text-muted-foreground'

export function InviteDialog({ guest, email: knownEmail, onDone }: { guest?: Person; email?: string; onDone: (made: boolean) => void }) {
  const ws = useData((s) => s.workspace?.name ?? '')
  const now = useNow()
  const [email, setEmail] = useState(knownEmail ?? '')
  const [role, setRole] = useState<InviteRole>('member')
  const [who, setWho] = useState<Who>('one')
  const [count, setCount] = useState('5')
  const [length, setLength] = useState<Length>('14')
  const [customDays, setCustomDays] = useState('21')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [made, setMade] = useState<Invite>()

  // a link for someone from Linear is always for that one person
  const forWhom: Who = guest ? 'one' : who
  const people = wholeIn(count, 1, MAX_INVITE_PEOPLE)
  const days = length === 'custom' ? wholeIn(customDays, 1, MAX_INVITE_DAYS) : Number(length)
  const ready = days !== null && (forWhom !== 'several' || people !== null)
  const until = days !== null ? untilText(expiresAtFor(days, now)) : null

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || !ready) return
    setBusy(true)
    setProblem(undefined)
    try {
      const maxUses = forWhom === 'one' ? 1 : forWhom === 'several' ? people : null
      setMade(await createInvite({ role, forGuest: guest?.login, forEmail: forWhom === 'one' ? email : undefined, days, maxUses }))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "We couldn't make the link. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  const close = () => !busy && onDone(!!made)

  if (made) {
    const { url, local } = inviteUrl(made.token)
    const shared = made.maxUses !== 1
    const message = inviteMessage(url, ws, { forName: guest?.name, expiresAt: made.expiresAt, shared })
    const to = made.forEmail ?? ''
    const mail = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`Join ${ws} in Sprawniej`)}&body=${encodeURIComponent(message)}`
    return (
      <Dialog open onOpenChange={(o) => !o && close()}>
        <DialogContent className="[overflow-wrap:anywhere] sm:max-w-lg">
          <DialogTitle>{shared ? 'Share this link' : `Send this link to ${guest?.name ?? (to || 'them')}`}</DialogTitle>
          <DialogDescription>
            It works until {untilText(made.expiresAt)}.{' '}
            {shared ? "You'll find it under Invite links, where you can end it sooner." : "You'll find it under Invite links until it's used."}
          </DialogDescription>
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
        <DialogTitle>{guest ? `Invite ${guest.name}` : 'Invite people'}</DialogTitle>
        <DialogDescription>
          {guest
            ? `When they join with this link, they become ${guest.name}: their issues, comments and views from Linear are theirs.`
            : 'Make a link and send it yourself. Choose who can use it and for how long.'}
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          {!guest && (
            <div>
              <span className={label}>Who can use it</span>
              <Segmented<Who>
                label="Who can use it"
                fill
                value={who}
                onChange={setWho}
                options={[
                  { value: 'one', label: 'One person' },
                  { value: 'several', label: 'Several', name: 'Several people' },
                  { value: 'anyone', label: 'Anyone', name: 'Anyone with the link' },
                ]}
              />
              {who === 'several' && (
                <div className="mt-3 flex items-center gap-2 text-ui">
                  <label htmlFor="invite-count">Up to</label>
                  <Input
                    id="invite-count"
                    inputMode="numeric"
                    className="h-10 w-20"
                    value={count}
                    aria-invalid={people === null}
                    onChange={(e) => setCount(e.target.value)}
                  />
                  <span>people</span>
                </div>
              )}
              {who === 'several' && people === null && <p className={hint}>Pick a number from 1 to {MAX_INVITE_PEOPLE}.</p>}
            </div>
          )}
          <div>
            <span className={label}>How long</span>
            <Segmented<Length>
              label="How long"
              fill
              value={length}
              onChange={setLength}
              options={[
                { value: '7', label: '1 week' },
                { value: '14', label: '2 weeks' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {length === 'custom' && (
              <div className="mt-3 flex items-center gap-2 text-ui">
                <Input
                  id="invite-days"
                  inputMode="numeric"
                  className="h-10 w-20"
                  value={customDays}
                  aria-invalid={days === null}
                  aria-label="Days"
                  onChange={(e) => setCustomDays(e.target.value)}
                />
                <label htmlFor="invite-days">days</label>
              </div>
            )}
            <p className={hint}>{until ? `It works until ${until}.` : `Pick a number of days from 1 to ${MAX_INVITE_DAYS}.`}</p>
          </div>
          {forWhom === 'anyone' && until && (
            <p className="rounded-lg border px-3 py-2 text-sm">
              Anyone who has this link can create an account and join {ws} until {until}, unless you end it sooner. Share it only where the right people
              will see it.
            </p>
          )}
          {forWhom === 'several' && people !== null && until && (
            <p className="rounded-lg border px-3 py-2 text-sm">
              Up to {people === 1 ? 'one person' : `${people} people`} can create an account and join {ws} with it until {until}.
            </p>
          )}
          {forWhom === 'one' && (
            <div>
              <label htmlFor="invite-email" className={label}>
                Their email (optional)
              </label>
              <Input id="invite-email" type="email" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className={hint}>{guest && knownEmail ? 'Their email in Linear.' : 'So you remember where to send it.'}</p>
            </div>
          )}
          <div>
            <label htmlFor="invite-role" className={label}>
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
            <p className={hint}>Admins can invite people, change roles and delete teams.</p>
          </div>
          <Problem>{problem}</Problem>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              {busy && <Loader2 className="animate-spin" />} Create link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
