/**
 * Settings: the workspace (its name, leaving it), its members and invite links, people from Linear, labels, the
 * archive, GitHub, the import, and your account.
 */
import { useState } from 'react'
import { Loader2, LogOut, Repeat } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'wouter'
import { useShallow } from 'zustand/react/shallow'
import { useCrumbs } from '@/app/chrome'
import { useSignOut, useSwitchWorkspace } from '@/components/SignOut'
import { PersonAvatar } from '@/components/Avatar'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { leaveWorkspace, renameMe, renameWorkspace, setAutoArchive } from '@/data/actions'
import { canLeave, myWho } from '@/data/roles'
import { isAdmin, ownerCount } from '@/data/select'
import { AUTO_ARCHIVE_MONTHS, type Person } from '@/model/schema'
import { useData } from '@/data/store'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { GitHubSettings } from './GitHubSettings'
import { Guests } from './Guests'
import { InviteDialog } from './InviteDialog'
import { InviteLinks } from './InviteLinks'
import { LabelsSettings } from './LabelsSettings'
import { Members } from './Members'
import { Section } from './Section'
import { SignInWays } from './SignInWays'
import { useInvites } from './useInvites'

function WorkspaceName({ admin }: { admin: boolean }) {
  const name = useData((s) => s.workspace?.name ?? '')
  if (!admin) {
    return (
      <>
        <Input aria-label="Workspace name" className="h-10 max-w-sm" readOnly value={name} />
        <p className="mt-1.5 text-sm text-muted-foreground">Only admins and owners can rename the workspace.</p>
      </>
    )
  }
  // remount when a teammate renames it, so the field shows the new name
  return <NameField key={name} name={name} />
}

function NameField({ name }: { name: string }) {
  const [draft, setDraft] = useState(name)
  const commit = () => {
    if (draft.trim() && draft.trim() !== name) renameWorkspace(draft)
    else setDraft(name)
  }
  return (
    <Input
      aria-label="Workspace name"
      className="h-10 max-w-sm"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function Leave() {
  const name = useData((s) => s.workspace?.name ?? '')
  const me = useData(useShallow(myWho))
  const owners = useData(ownerCount)
  const can = canLeave(me, owners)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  async function leave() {
    setBusy(true)
    try {
      await leaveWorkspace()
      toast(`You left ${name}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : "We couldn't take you out of the workspace. Try again in a moment.")
      setBusy(false)
    }
  }

  return (
    <div className="mt-5">
      <Button variant="outline" disabled={!can.ok || busy} onClick={() => setAsking(true)}>
        {busy ? <Loader2 className="animate-spin" /> : <LogOut />} Leave workspace
      </Button>
      {can.why && <p className="mt-1.5 text-sm text-muted-foreground">{can.why}</p>}
      <ConfirmDialog open={asking} onOpenChange={setAsking} title={`Leave ${name}?`} confirm="Leave workspace" keep="Stay" onConfirm={() => void leave()}>
        <span>
          You won't see its issues any more, and teammates can't assign you new work. Your issues and comments stay, with your name. To come back, ask
          for a new invite.
        </span>
      </ConfirmDialog>
    </div>
  )
}

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
      <p className="mt-1.5 text-sm text-muted-foreground">@{me.login} · How teammates see you here.</p>
    </div>
  )
}

function Account() {
  const user = useSession((s) => s.user)
  const mine = useData((s) => (user ? s.people[user.login] : undefined))
  const { signOut, busy, dialog } = useSignOut()
  const switching = useSwitchWorkspace()
  const me = mine ?? user

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <PersonAvatar person={me ?? undefined} className="size-12 text-base" />
        {/* remount when the name changes elsewhere (another tab) */}
        {me && <MyName key={me.name} me={me} />}
      </div>
      <SignInWays />
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

const ARCHIVE_CHOICES = [1, 3, 6, 12, 0]

/** per team: how long finished issues stay in the lists before they're archived */
function ArchiveSettings() {
  const teams = useData(useShallow((s) => Object.values(s.teams).sort((a, b) => a.name.localeCompare(b.name))))
  return (
    <ul className="flex flex-col gap-2">
      {teams.map((t) => (
        <li key={t.key} className="flex items-center gap-3">
          <span className="w-5 text-center">{t.emoji}</span>
          <span className="min-w-0 flex-1 truncate text-[15px]">{t.name}</span>
          <Select value={String(t.autoArchive ?? AUTO_ARCHIVE_MONTHS)} onValueChange={(v) => setAutoArchive(t.key, Number(v))}>
            <SelectTrigger className="w-44" aria-label={`When ${t.name} archives finished issues`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARCHIVE_CHOICES.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m === 0 ? 'Never' : `After ${m} ${m === 1 ? 'month' : 'months'}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </li>
      ))}
    </ul>
  )
}

export function SettingsPage() {
  useCrumbs([{ label: 'Settings' }])
  const admin = useData(isAdmin)
  const ws = useSession((s) => s.workspaceId)
  const invites = useInvites(ws, admin)
  /** the invite dialog: for someone from Linear, or for anyone */
  const [inviting, setInviting] = useState<{ guest?: Person; email?: string }>()

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8">
      <div className="mx-auto max-w-3xl py-4">
        <Section title="Workspace">
          <WorkspaceName admin={admin} />
          <Leave />
        </Section>
        <Section
          title="Members"
          description="Everyone here can see and change every issue in the workspace. Owners and admins invite people, change roles, rename the workspace and delete teams. Only owners can make or change owners."
        >
          <Members />
          {admin && (
            <div className="mt-8">
              <InviteLinks invites={invites} onCreate={() => setInviting({})} />
            </div>
          )}
        </Section>
        <Guests ws={ws} admin={admin} invites={invites} onInvite={(guest, email) => setInviting({ guest, email })} />
        <Section title="Labels" description="Labels sort issues across teams. Renaming or recolouring one changes it on every issue.">
          <LabelsSettings />
        </Section>
        <Section
          title="Archive"
          description="Finished issues leave the lists some time after they're done, so the lists stay short and the app stays quick. Archived issues can still be opened, found and brought back."
        >
          <ArchiveSettings />
        </Section>
        <Section
          title="GitHub"
          description="Pull requests that mention an issue, like ENG-12 in the branch name, the title or the description, move it: to In Review when the pull request opens or is ready for review, and to Done when it's merged."
        >
          <GitHubSettings admin={admin} />
        </Section>
        <Section title="Import" description="Bring teams, issues, comments, projects and labels over from Linear. You can run it again later to bring in new changes.">
          {admin ? (
            <Button asChild variant="outline">
              <Link href="/settings/import">Import from Linear</Link>
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled>
                Import from Linear
              </Button>
              <p className="mt-1.5 text-sm text-muted-foreground">Only admins and owners can import.</p>
            </>
          )}
        </Section>
        <Section title="Your account">
          <Account />
        </Section>
      </div>
      {inviting && (
        <InviteDialog
          guest={inviting.guest}
          email={inviting.email}
          onDone={(made) => {
            setInviting(undefined)
            if (made) invites.reload()
          }}
        />
      )}
    </div>
  )
}
