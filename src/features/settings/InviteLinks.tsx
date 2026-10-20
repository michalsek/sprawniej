/**
 * Settings › Invite links (admins and owners): the links not used up yet, who joined with each, copying them again,
 * ending them early and deleting them. Ended, expired and full links stay, greyed out, until they are deleted.
 */
import { Ban, Copy, Link2, MoreHorizontal, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { expiresText, inviteState, type Invite } from '@/backend/workspaces'
import { EmptyState } from '@/components/EmptyState'
import { deleteInvite, endInvite } from '@/data/actions'
import { useData } from '@/data/store'
import { inviteMessage, inviteUrl, untilText } from '@/features/onboarding/invite'
import { Problem } from '@/features/onboarding/Step'
import { cn } from '@/lib/utils'
import { ROLE_NAMES } from '@/data/roles'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { personById } from '@/data/people'
import { useNow } from '@/lib/useNow'
import { copy } from './copy'
import { linkTitle } from './inviteText'
import type { Invites } from './useInvites'

/** what a link that no longer works says instead of when it ends */
const STOPPED = { used: 'used', ended: 'ended early', full: 'full', expired: 'expired' } as const

/** "3 joined", and who, on which day */
function Joined({ uses }: { uses: Invite['uses'] }) {
  const people = useData((s) => s.people)
  if (!uses.length) return null
  return (
    <Popover>
      <PopoverTrigger className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        {uses.length} joined
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <ul className="flex flex-col gap-1.5 text-sm">
          {[...uses]
            .sort((a, b) => a.at.localeCompare(b.at))
            .map((u) => (
              <li key={u.profileId} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">{personById({ people }, u.profileId)?.name ?? 'Someone who has left'}</span>
                <span className="text-muted-foreground">{new Date(u.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </li>
            ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export function InviteLinks({ invites: { invites, state, reload }, onCreate }: { invites: Invites; onCreate: () => void }) {
  const ws = useData((s) => s.workspace?.name ?? '')
  const people = useData((s) => s.people)
  const now = useNow()

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

  const end = async (i: Invite) => {
    try {
      await endInvite(i.id)
      toast('Link ended. Nobody new can join with it.')
    } catch (e) {
      toast(e instanceof Error ? e.message : "We couldn't end the link. Try again in a moment.")
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
      {state === 'ready' && invites.length > 0 && <div className="mb-3">{create}</div>}
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
          Make a link for one person, or one the whole team can use for a week.
        </EmptyState>
      )}
      {state === 'ready' && invites.length > 0 && (
        <ul className="flex flex-col gap-1">
          {invites.map((i) => {
            const guest = personById({ people }, i.forProfile)
            const by = personById({ people }, i.invitedBy)
            const st = inviteState(i, now)
            const working = st === 'open'
            const { url } = inviteUrl(i.token)
            const title = linkTitle(i, guest?.name)
            return (
              <li key={i.id} className="flex items-center gap-3 py-1.5">
                <span className={cn('min-w-0 flex-1', !working && 'opacity-60')}>
                  <span className="block truncate font-medium">{title}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {ROLE_NAMES[i.role]}
                    {by && ` · made by ${by.name}`} ·{' '}
                    {working ? <span title={`Works until ${untilText(i.expiresAt)}`}>{expiresText(i.expiresAt, now)}</span> : STOPPED[st]}
                    {i.uses.length > 0 && ' · '}
                    <Joined uses={i.uses} />
                  </span>
                </span>
                {!working ? (
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
                        <Button variant="ghost" size="icon-sm" aria-label={`More for the link: ${title}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => copy(inviteMessage(url, ws, { forName: guest?.name, expiresAt: i.expiresAt, shared: i.maxUses !== 1 }), 'Message')}>
                          <Copy /> Copy message
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void end(i)}>
                          <Ban /> End link now
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
