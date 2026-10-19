/** Who you are here: your profile, found again on every start (and for each person who signs in). */
import { useEffect, useState } from 'react'
import { friendlyDbError } from '@/backend/problem'
import { ensureProfile, type MyProfile } from '@/backend/profiles'
import { useSession } from '@/session'

type ProfileLoad = { uid: string; state: 'ready' | 'none' } | { uid: string; state: 'failed'; problem: string }

export interface MyProfileState {
  /** 'loading' also while signed out */
  state: 'loading' | 'failed' | 'none' | 'ready'
  problem?: string
  mine: MyProfile | null
  /** a name was just picked (PickLogin) */
  picked: (p: MyProfile) => void
  retry: () => void
}

export function useMyProfile(uid: string | undefined): MyProfileState {
  const profileId = useSession((s) => s.profileId)
  const user = useSession((s) => s.user)
  const [load, setLoad] = useState<ProfileLoad>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!uid) return
    let stop = false
    ensureProfile().then(
      (p) => {
        if (stop) return
        if (p) useSession.getState().setProfile(p.id, p.person)
        setLoad({ uid, state: p ? 'ready' : 'none' })
      },
      (e: unknown) => {
        console.warn('Sprawniej couldn’t find your profile', e)
        if (!stop) setLoad({ uid, state: 'failed', problem: friendlyDbError(e, 'Something went wrong while signing you in. Try again in a moment.') })
      },
    )
    return () => {
      stop = true
    }
  }, [uid, attempt])

  const mine = user && profileId ? { id: profileId, person: user } : null
  const now = uid && load?.uid === uid ? load : undefined
  return {
    state: !now ? 'loading' : now.state === 'ready' && !mine ? 'none' : now.state,
    problem: now?.state === 'failed' ? now.problem : undefined,
    mine,
    picked: (p) => {
      useSession.getState().setProfile(p.id, p.person)
      if (uid) setLoad({ uid, state: 'ready' })
    },
    retry: () => setAttempt((n) => n + 1),
  }
}
