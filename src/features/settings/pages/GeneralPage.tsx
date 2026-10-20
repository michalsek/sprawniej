/** Settings › General: the workspace's name (admins and owners rename it) and leaving the workspace. */
import { useState } from 'react'
import { Loader2, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { leaveWorkspace, renameWorkspace } from '@/data/actions'
import { canLeave, myWho } from '@/data/roles'
import { ownerCount } from '@/data/select'
import { useData } from '@/data/store'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Section } from '../Section'

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
    <div>
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

export function GeneralPage({ admin }: { admin: boolean }) {
  return (
    <>
      <Section title="Name">
        <WorkspaceName admin={admin} />
      </Section>
      <Section title="Leave the workspace">
        <Leave />
      </Section>
    </>
  )
}
