/** Settings › People from Linear: the list (Guests.tsx) and the invite dialog its Invite buttons open. */
import { useState } from 'react'
import type { Person } from '@/model/schema'
import { useSession } from '@/session'
import { Guests } from '../Guests'
import { InviteDialog } from '../InviteDialog'
import { useInvites } from '../useInvites'

export function LinearPeoplePage({ admin }: { admin: boolean }) {
  const ws = useSession((s) => s.workspaceId)
  const invites = useInvites(ws, admin)
  const [inviting, setInviting] = useState<{ guest: Person; email?: string }>()
  return (
    <>
      <Guests ws={ws} admin={admin} invites={invites} onInvite={(guest, email) => setInviting({ guest, email })} />
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
    </>
  )
}
