/**
 * Settings › People from Linear: whom the Linear import brought who hasn't joined yet. Admins invite them (they become
 * that person when they join) or link them to someone already here.
 */
import { useEffect, useState } from 'react'
import { Copy, Link2, Search, UserPlus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { expiresText, guestEmails, isExpired } from '@/backend/workspaces'
import { PersonAvatar } from '@/components/Avatar'
import { PagedList } from '@/components/PagedList'
import { profileIdOf } from '@/data/people'
import { useData } from '@/data/store'
import { inviteUrl } from '@/features/onboarding/invite'
import { fuzzy } from '@/lib/fuzzy'
import { useNow } from '@/lib/useNow'
import type { Person } from '@/model/schema'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { LinkPersonDialog } from './LinkPersonDialog'
import { useUnlinked, workOf } from './unlinked'
import { copy } from './copy'
import { Section } from './Section'
import type { Invites } from './useInvites'

export function Guests({ ws, admin, invites, onInvite }: { ws: string | null; admin: boolean; invites: Invites; onInvite: (guest: Person, email?: string) => void }) {
  const unlinked = useUnlinked()
  const work = useData(useShallow((s) => Object.fromEntries(unlinked.map((g) => [g.login, workOf(s, g.login)]))))
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [linking, setLinking] = useState<Person>()
  const now = useNow()
  // read again when someone from Linear comes or goes (an import, a link)
  const who = unlinked.map((g) => g.login).join(',')

  useEffect(() => {
    if (!ws || !admin) return
    let stop = false
    guestEmails(ws).then(
      (e) => !stop && setEmails(e),
      (e: unknown) => console.warn('Sprawniej couldn’t read the emails of people from Linear', e),
    )
    return () => {
      stop = true
    }
  }, [ws, admin, who])

  if (!unlinked.length) return null
  const shown = fuzzy(unlinked, query, (g) => [g.name])
  const emailOf = (g: Person) => {
    const id = profileIdOf(g.login)
    return id ? emails[id] : undefined
  }
  const openInviteFor = (g: Person) => {
    const id = profileIdOf(g.login)
    return id ? invites.invites.find((i) => i.forProfile === id && !isExpired(i, now)) : undefined
  }

  return (
    <Section
      title="People from Linear"
      description={
        admin
          ? "They came with the Linear import and haven't joined yet. Invite them: when they join, their issues, comments and views become theirs. Already here under another name? Link them instead."
          : "They came with the Linear import and haven't joined yet. An admin can invite them."
      }
    >
      <div className="flex flex-col gap-4">
        {unlinked.length > 10 && (
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 pl-9"
              placeholder="Search people from Linear…"
              aria-label="Search people from Linear"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
          </div>
        )}
        {query.trim() && !shown.length && <p className="text-muted-foreground">Nobody here matches “{query.trim()}”.</p>}
        <PagedList
          key={query.trim()}
          items={shown}
          noun="people from Linear"
          className="flex flex-col gap-1"
          row={(g) => {
            const email = emailOf(g)
            const open = admin ? openInviteFor(g) : undefined
            return (
              <li key={g.login} className="flex flex-wrap items-center gap-3 py-1.5">
                <PersonAvatar person={g} className="size-8 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {[work[g.login] || 'Nothing of theirs yet', email, open && `Invited, ${expiresText(open.expiresAt, now)}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {admin && (
                  <>
                    {open ? (
                      <Button variant="ghost" size="sm" onClick={() => copy(inviteUrl(open.token).url, 'Link')}>
                        <Copy /> Copy invite link
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => onInvite(g, email)}>
                        <UserPlus /> Invite
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setLinking(g)}>
                      <Link2 /> Link
                    </Button>
                  </>
                )}
              </li>
            )
          }}
        />
      </div>
      {linking && <LinkPersonDialog guest={linking} onClose={() => setLinking(undefined)} />}
    </Section>
  )
}
