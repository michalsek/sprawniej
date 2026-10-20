/**
 * What to show before the app itself: signing in, picking your @handle, choosing a workspace, opening it. Once a
 * workspace is open, the app (children) takes over. A sign-in that runs out while you work keeps everything on
 * screen and asks you to sign in again on top of it.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'wouter'
import { backend, useBackend } from '@/backend'
import { useAuth } from '@/backend/auth'
import type { MyProfile } from '@/backend/profiles'
import { useSaveStatus } from '@/backend/status'
import { useData } from '@/data/store'
import { ProfileFailed, Waiting } from '@/features/onboarding/Gatekeeping'
import { readInvitePath } from '@/features/onboarding/invite'
import { JoinFlow } from '@/features/onboarding/JoinFlow'
import { PickLogin } from '@/features/onboarding/PickLogin'
import { PickWorkspace } from '@/features/onboarding/PickWorkspace'
import { Problem, Step } from '@/features/onboarding/Step'
import { SignIn, SignInForm } from '@/features/onboarding/Welcome'
import { handleOf } from '@/model/schema'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { useMyProfile } from './useMyProfile'

/** a dialog that stays until its own button is used (nothing else may close it) */
function Blocking({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{text}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}

const GONE = {
  deleted: { title: 'This workspace was deleted', text: "Its owner deleted it, so there's nothing left to show here." },
  removed: { title: "You're no longer in this workspace", text: "If that's a mistake, ask a teammate to invite you again." },
  missing: { title: "This workspace isn't here any more", text: "It may have been deleted, or you're no longer one of its members." },
}

function OpenWorkspace({ workspaceId, me, children }: { workspaceId: string; me: MyProfile; children: ReactNode }) {
  const [, navigate] = useLocation()
  const signedIn = useAuth((s) => !!s.user)
  // before this workspace's opening starts, what the backend says is about the last one
  const ours = useBackend((s) => s.workspaceId === workspaceId)
  const phase = useBackend((s) => (ours ? s.phase : 'closed'))
  const failure = useBackend((s) => s.failure)
  const gone = useBackend((s) => s.gone)
  const progress = useSaveStatus((s) => s.progress)
  const name = useData((s) => s.workspace?.name)
  const [attempt, setAttempt] = useState(0)
  // the person as they were when it opened: a new name from the database shows through the store, not by reopening
  const [person] = useState(me.person)
  // signed out (it ran out) before it opened, say after an invite link: it opens once you're signed in again; one
  // that is open stays open while you sign in
  const [start, setStart] = useState(signedIn)
  if (signedIn && !start) setStart(true)

  useEffect(() => {
    if (!start) return
    void backend.open(workspaceId, { id: me.id, person })
    return () => void backend.close()
  }, [workspaceId, me.id, person, attempt, start])

  // it failed while signed out: signing in again tries once more
  const [failedSignedOut, setFailedSignedOut] = useState(false)
  if (phase === 'failed' && !signedIn && !failedSignedOut) setFailedSignedOut(true)
  if (failedSignedOut && signedIn) {
    setFailedSignedOut(false)
    setAttempt((n) => n + 1)
  }

  // the list of workspaces says who you are as you are now (a new name or @handle, also from another tab)
  const mineNow = useData((s) => s.people[person.login])
  useEffect(() => {
    const was = useSession.getState().user
    if (mineNow && (!was || was.name !== mineNow.name || handleOf(was) !== handleOf(mineNow))) useSession.getState().setProfile(me.id, mineNow)
  }, [mineNow, me.id])

  // the list of workspaces shows each with its name as it is now
  useEffect(() => {
    if (phase === 'open' && name) useSession.getState().open({ id: workspaceId, name })
  }, [phase, name, workspaceId])

  /** back to the list, from the start (the route was this workspace's) */
  const chooseAnother = (forget: boolean) => {
    navigate('/', { replace: true })
    if (forget) useSession.getState().forget(workspaceId)
    else useSession.getState().close()
  }

  const signInAgain = (
    <Blocking title="Please sign in again" text="You were signed out, maybe because it's been a while. Sign in to carry on; everything here stays as it is.">
      <SignInForm />
    </Blocking>
  )
  // couldn't open because the sign-in ran out: sign in, and it tries again by itself
  if (phase === 'failed' && !signedIn) {
    return (
      <>
        <Waiting title="Opening your workspace…" />
        {signInAgain}
      </>
    )
  }
  if (phase === 'failed') {
    return (
      <Step
        title="We couldn't open this workspace"
        footer={
          failure === 'network' ? (
            <>
              <Button size="lg" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
              <Button variant="outline" size="lg" onClick={() => chooseAnother(false)}>
                Choose another workspace
              </Button>
            </>
          ) : (
            <Button size="lg" onClick={() => chooseAnother(true)}>
              Choose another workspace
            </Button>
          )
        }
      >
        {failure === 'network' ? (
          <Problem>Can't reach Sprawniej. Check your internet connection.</Problem>
        ) : (
          <p>It may have been deleted, or you're no longer one of its members.</p>
        )}
      </Step>
    )
  }
  if (phase !== 'open' && phase !== 'gone') {
    return (
      <>
        <Waiting title="Opening your workspace…" line={progress} />
        {!signedIn && signInAgain}
      </>
    )
  }
  const ended = phase === 'gone' && gone ? GONE[gone] : null
  return (
    <>
      {children}
      {ended && (
        <Blocking title={ended.title} text={ended.text}>
          <div className="flex justify-end">
            <Button onClick={() => chooseAnother(true)}>Choose another workspace</Button>
          </div>
        </Blocking>
      )}
      {!signedIn && !ended && signInAgain}
    </>
  )
}

export function Gate({ children }: { children: ReactNode }) {
  const [loc] = useLocation()
  const ready = useAuth((s) => s.ready)
  const authUser = useAuth((s) => s.user)
  const lost = useAuth((s) => s.lost)
  const workspaceId = useSession((s) => s.workspaceId)
  const profile = useMyProfile(authUser?.id)
  const mine = profile.known

  if (!ready) return <Waiting title="Just a moment…" />
  // an invite link comes before an open workspace (which closes meanwhile, and opens again back at the start)
  const invite = readInvitePath(loc)
  if (invite) return <JoinFlow link={invite} profile={profile} />
  // signed out while working (it ran out): everything stays on screen, with "Please sign in again" on top
  if (workspaceId && mine && (authUser || lost)) {
    return (
      <OpenWorkspace key={`${workspaceId}:${mine.id}`} workspaceId={workspaceId} me={mine}>
        {children}
      </OpenWorkspace>
    )
  }
  if (!authUser) return <SignIn />
  if (profile.state === 'loading') return <Waiting title="Signing you in…" />
  if (profile.state === 'failed') return <ProfileFailed problem={profile.problem} onRetry={profile.retry} />
  if (profile.state === 'none') return <PickLogin onDone={profile.picked} />
  return <PickWorkspace />
}
