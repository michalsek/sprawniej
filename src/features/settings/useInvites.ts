/**
 * The open workspace's invite links that aren't used yet, for admins. They aren't live: they're read when Settings
 * opens, when anyone joins, leaves or changes role (a link may have just been used), when the window gets focus, and
 * after making or deleting one.
 */
import { useCallback, useEffect, useState } from 'react'
import { listInvites, type Invite } from '@/backend/workspaces'
import { useData } from '@/data/store'

export interface Invites {
  invites: Invite[]
  state: 'loading' | 'ready' | 'failed'
  reload: () => void
}

export function useInvites(ws: string | null, admin: boolean): Invites {
  // who is in, as one string: any change to it reads the links again
  const members = useData((s) =>
    Object.entries(s.members)
      .map(([login, m]) => `${login}:${m.role}:${m.removedAt ?? ''}`)
      .sort()
      .join(','),
  )
  const [invites, setInvites] = useState<Invite[]>([])
  const [state, setState] = useState<Invites['state']>('loading')
  const [asked, setAsked] = useState(0)
  const reload = useCallback(() => setAsked((n) => n + 1), [])

  useEffect(() => {
    if (!ws || !admin) return
    let stop = false
    listInvites(ws).then(
      (list) => {
        if (stop) return
        setInvites(list)
        setState('ready')
      },
      (e: unknown) => {
        console.warn('Sprawniej couldn’t read the invite links', e)
        if (!stop) setState((s) => (s === 'ready' ? s : 'failed'))
      },
    )
    return () => {
      stop = true
    }
  }, [ws, admin, members, asked])

  useEffect(() => {
    if (!admin) return
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [admin, reload])

  return { invites: admin ? invites : [], state, reload }
}
