/** Settings › Invite links (admins and owners): the links not used yet, copying them again, deleting them. */
import { useState } from 'react'
import { Copy, Link2, MoreHorizontal, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { expiresText, isExpired, type Invite } from '@/backend/workspaces'
import { EmptyState } from '@/components/EmptyState'
import { deleteInvite } from '@/data/actions'
import { useData } from '@/data/store'
import { inviteMessage, inviteUrl } from '@/features/onboarding/invite'
import { Problem } from '@/features/onboarding/Step'
import { cn } from '@/lib/utils'
import { ROLE_NAMES } from '@/data/roles'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { copy, personById, type Invites } from './useInvites'

export function InviteLinks({ invites: { invites, state, reload }, onCreate }: { invites: Invites; onCreate: () => void }) {
  const ws = useData((s) => s.workspace?.name ?? '')
  const people = useData((s) => s.people)
  const [now] = useState(() => Date.now())

  const remove = async (i: Invite) => {
    try {
      await deleteInvite(i.id)
      toast("Link deleted. It doesn't work any more.")
    } catch (e) {
      toast(e instanceof Error ? e.message : "We couldn't delete the link. Try again in a moment.")
    } finally {
      reload()
    }
  }

  const create = (
    <Button variant="outline" onClick={onCreate}>
      <UserPlus /> Create an invite link
    </Button>
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">Invite links</h3>
          <p className="text-sm text-muted-foreground">Each link works once, for 14 days. Whoever opens it can create an account and join.</p>
        </div>
        {state === 'ready' && invites.length > 0 && create}
      </div>
      {state === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
      {state === 'failed' && (
        <>
          <Problem>We couldn't load the invite links. Try again.</Problem>
          <Button variant="outline" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </>
      )}
      {state === 'ready' && !invites.length && (
        <EmptyState icon={<Link2 />} title="No invite links yet" action={create}>
          Make a link for each person you invite and send it to them yourself.
        </EmptyState>
      )}
      {state === 'ready' && invites.length > 0 && (
        <ul className="flex flex-col gap-1">
          {invites.map((i) => {
            const guest = personById({ people }, i.forProfile)
            const by = personById({ people }, i.invitedBy)
            const expired = isExpired(i, now)
            const { url } = inviteUrl(i.token)
            const title = guest ? `For ${guest.name}, from Linear` : i.forEmail ? `For ${i.forEmail}` : 'For anyone with the link'
            return (
              <li key={i.id} className={cn('flex items-center gap-3 py-1.5', expired && 'opacity-60')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{title}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {ROLE_NAMES[i.role]}
                    {by && ` · made by ${by.name}`} · {expiresText(i.expiresAt, now)}
                  </span>
                </span>
                {expired ? (
                  <Button variant="ghost" size="sm" onClick={() => void remove(i)}>
                    <Trash2 /> Delete link
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => copy(url, 'Link')}>
                      <Copy /> Copy link
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`More for the link ${title.toLowerCase()}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => copy(inviteMessage(url, ws, guest?.name), 'Message')}>
                          <Copy /> Copy message
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => void remove(i)}>
                          <Trash2 /> Delete link
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
