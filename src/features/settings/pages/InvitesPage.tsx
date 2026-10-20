/** Settings › Invite links (admins and owners): the links not used yet, and making a new one. */
import { useState } from 'react'
import { useSession } from '@/session'
import { InviteDialog } from '../InviteDialog'
import { InviteLinks } from '../InviteLinks'
import { useInvites } from '../useInvites'

export function InvitesPage({ admin }: { admin: boolean }) {
  const ws = useSession((s) => s.workspaceId)
  const invites = useInvites(ws, admin)
  const [inviting, setInviting] = useState(false)
  return (
    <>
      <InviteLinks invites={invites} onCreate={() => setInviting(true)} />
      {inviting && (
        <InviteDialog
          onDone={(made) => {
            setInviting(false)
            if (made) invites.reload()
          }}
        />
      )}
    </>
  )
}
