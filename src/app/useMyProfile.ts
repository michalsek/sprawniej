/** Who you are here: your profile, found again on every start (and for each person who signs in). */
import { useEffect, useState } from 'react'
import { friendlyDbError, isUnreachable } from '@/backend/problem'
import { ensureProfile, type MyProfile } from '@/backend/profiles'
import { useSession } from '@/session'

/** `unreachable`: it failed because Sprawniej can't be reached */
export type ProfileLoad = { uid: string; state: 'ready' | 'none' } | { uid: string; state: 'failed'; problem: string; unreachable: boolean }

/** where finding your profile is ('loading' also while signed out) */
export type ProfileStage = { state: 'loading' } | { state: 'failed'; problem: string } | { state: 'none' } | { state: 'ready'; mine: MyProfile }

export type MyProfileState = ProfileStage & {
  /** your profile as last known (it stays while a sign-in that ran out is renewed) */
  known: MyProfile | null
  /** a name was just picked (PickLogin) */
  picked: (p: MyProfile) => void
  retry: () => void
}

function stage(uid: string | undefined, load: ProfileLoad | undefined, mine: MyProfile | null): ProfileStage {
  const now = uid && load?.uid === uid ? load : undefined
  if (!now) return { state: 'loading' }
  if (now.state === 'failed') return { state: 'failed', problem: now.problem }
  if (now.state === 'none' || !mine) return { state: 'none' }
  return { state: 'ready', mine }
}

/**
 * You as known now: as found this time, or, when Sprawniej couldn't be reached as it started, as you were the last
 * time in this browser (so the copy of your workspace it kept opens)
 */
export function knownProfile(
  uid: string | undefined,
  load: ProfileLoad | undefined,
  s: { profileId: string | null; user: MyProfile['person'] | null; owner: string | null; lastProfile: MyProfile | null },
): MyProfile | null {
  if (s.user && s.profileId) return { id: s.profileId, person: s.user }
  const unreachable = !!uid && load?.uid === uid && load.state === 'failed' && load.unreachable
  return unreachable && s.owner === uid ? s.lastProfile : null
}

export function useMyProfile(uid: string | undefined): MyProfileState {
  const profileId = useSession((s) => s.profileId)
  const user = useSession((s) => s.user)
  const owner = useSession((s) => s.owner)
  const lastProfile = useSession((s) => s.lastProfile)
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
        if (!stop) setLoad({ uid, state: 'failed', problem: friendlyDbError(e, 'Something went wrong while signing you in. Try again in a moment.'), unreachable: isUnreachable(e) })
      },
    )
    return () => {
      stop = true
    }
  }, [uid, attempt])

  const known = knownProfile(uid, load, { profileId, user, owner, lastProfile })
  return {
    ...stage(uid, load, known),
    known,
    picked: (p) => {
      useSession.getState().setProfile(p.id, p.person)
      if (uid) setLoad({ uid, state: 'ready' })
    },
    retry: () => setAttempt((n) => n + 1),
  }
}
