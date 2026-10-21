/**
 * Settings › Profile: your picture, name, @handle and contact email as teammates see them, light or dark, switching
 * workspace and signing out.
 */
import { useState } from 'react'
import { Loader2, LogOut, Repeat } from 'lucide-react'
import { PersonAvatar } from '@/components/Avatar'
import { useSignOut, useSwitchWorkspace } from '@/components/SignOut'
import { renameMe } from '@/data/actions'
import { useData } from '@/data/store'
import type { Person } from '@/model/schema'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { ContactEmails } from '../ContactEmails'
import { MyHandle } from '../MyHandle'
import { Appearance } from '../Appearance'

/** your name as teammates see it */
function MyName({ me }: { me: Person }) {
  const [draft, setDraft] = useState(me.name)
  const commit = () => {
    renameMe(draft)
    if (!draft.trim()) setDraft(me.name)
  }
  return (
    <div className="min-w-0 flex-1">
      <Input
        aria-label="Your name"
        className="h-10 max-w-sm font-semibold"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <p className="mt-1.5 text-sm text-muted-foreground">How teammates see you here.</p>
    </div>
  )
}

export function ProfilePage() {
  const user = useSession((s) => s.user)
  const mine = useData((s) => (user ? s.people[user.login] : undefined))
  const { signOut, busy, dialog } = useSignOut()
  const switching = useSwitchWorkspace()
  const me = mine ?? user

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-4">
        <PersonAvatar person={me ?? undefined} className="size-12 text-initials-lg" />
        {/* remount when the name changes elsewhere (another tab) */}
        {me && <MyName key={me.name} me={me} />}
      </div>
      <MyHandle />
      <ContactEmails />
      <Appearance />
      <div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" disabled={switching.busy} onClick={switching.switchWorkspace}>
            <Repeat /> Switch workspace
          </Button>
          <Button variant="outline" size="lg" disabled={busy} onClick={signOut}>
            {busy ? <Loader2 className="animate-spin" /> : <LogOut />} Sign out
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Signing out forgets you in this browser, in every tab, and removes the copy of your workspaces kept here. Do it on shared computers.
        </p>
      </div>
      {dialog}
      {switching.dialog}
    </div>
  )
}
