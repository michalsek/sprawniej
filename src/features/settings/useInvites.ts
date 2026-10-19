/**
 * The open workspace's invite links that aren't used yet, for admins. They aren't live: they're read when Settings
 * opens, when someone joins (a link was just used), when the window gets focus, and after making or deleting one.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { registry } from '@/backend/registry'
import { listInvites, type Invite } from '@/backend/workspaces'
import { useData, type DataState } from '@/data/store'
import type { Person } from '@/model/schema'

export interface Invites {
  invites: Invite[]
  state: 'loading' | 'ready' | 'failed'
  reload: () => void
}

export function useInvites(ws: string | null, admin: boolean): Invites {
  const members = useData((s) => Object.values(s.members).filter((m) => !m.removedAt).length)
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
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [reload])

  return { invites: admin ? invites : [], state, reload }
}

/** the person a profile id stands for here, if we know them */
export function personById(s: Pick<DataState, 'people'>, id: string | null): Person | undefined {
  const login = id ? registry.login(id) : undefined
  return login ? s.people[login] : undefined
}

/** copies to the clipboard and says so */
export function copy(text: string, what: 'Link' | 'Message') {
  navigator.clipboard.writeText(text).then(
    () => toast(`${what} copied`),
    () => toast("Couldn't copy. Select the text and copy it yourself."),
  )
}
