/**
 * What to show before the app itself: signing in, picking your @handle, choosing a workspace, opening it. Once a
 * workspace is open, the app (children) takes over. A sign-in that runs out while you work keeps everything on
 * screen and asks you to sign in again on top of it.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'wouter'
import { Loader2 } from 'lucide-react'
import { backend, useBackend } from '@/backend'
import { useAuth } from '@/backend/auth'
import { ensureProfile, type MyProfile } from '@/backend/profiles'
import { useSaveStatus } from '@/backend/status'
import { useSignOut } from '@/components/SignOut'
import { useData } from '@/data/store'
import { PickLogin } from '@/features/onboarding/PickLogin'
import { PickWorkspace } from '@/features/onboarding/PickWorkspace'
import { Problem, Step } from '@/features/onboarding/Step'
import { SignIn, SignInForm } from '@/features/onboarding/Welcome'
import type { Person } from '@/model/schema'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'

function Waiting({ title }: { title: string }) {
  return (
    <Step title={title}>
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Just a moment.
      </p>
    </Step>
  )
}

/** invite links come with phase 8 */
function JoinLater() {
  const [, navigate] = useLocation()
  return (
    <Step title="Invite links don't work yet" footer={<Button onClick={() => navigate('/', { replace: true })}>Go to Sprawniej</Button>}>
      <p>Sprawniej can't open invite links yet. Ask your teammate again in a few days.</p>
    </Step>
  )
}

function ProfileFailed({ onRetry }: { onRetry: () => void }) {
  const { signOut, dialog } = useSignOut()
  return (
    <Step
      title="We couldn't sign you in"
      footer={
        <>
          <Button size="lg" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="outline" size="lg" onClick={signOut}>
            Sign out
          </Button>
        </>
      }
    >
      {dialog}
      <Problem>Can't reach Sprawniej. Check your internet connection and try again.</Problem>
    </Step>
  )
}

/** the sign-in ran out: sign in again without leaving the page */
function SignInAgain() {
  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogTitle>Please sign in again</DialogTitle>
        <DialogDescription>You were signed out, maybe because it's been a while. Sign in to carry on; everything here stays as it is.</DialogDescription>
        <SignInForm />
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
  const signedIn = useAuth((s) => !!s.user)
  // before this workspace's opening starts, what the backend says is about the last one
  const ours = useBackend((s) => s.workspaceId === workspaceId)
  const phase = useBackend((s) => (ours ? s.phase : 'closed'))
  const failure = useBackend((s) => s.failure)
  const gone = useBackend((s) => s.gone)
  const progress = useSaveStatus((s) => s.progress)
  const name = useData((s) => s.workspace?.name)
  const [attempt, setAttempt] = useState(0)
  const [person] = useState(me.person)

  useEffect(() => {
    void backend.open(workspaceId, { id: me.id, person })
    return () => void backend.close()
  }, [workspaceId, me.id, person, attempt])

  // the list of workspaces shows each with its name as it is now
  useEffect(() => {
    if (phase === 'open' && name) useSession.getState().open({ id: workspaceId, name })
  }, [phase, name, workspaceId])

  const another = () => {
    useSession.getState().forget(workspaceId)
    void backend.close()
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
              <Button variant="outline" size="lg" onClick={() => useSession.getState().close()}>
                Choose another workspace
              </Button>
            </>
          ) : (
            <Button size="lg" onClick={another}>
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
      <Step title="Opening your workspace…">
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {progress ?? 'Just a moment.'}
        </p>
      </Step>
    )
  }
  const ended = phase === 'gone' && gone ? GONE[gone] : null
  return (
    <>
      {children}
      {ended && (
        <Dialog open>
          <DialogContent className="sm:max-w-md" showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
            <DialogTitle>{ended.title}</DialogTitle>
            <DialogDescription>{ended.text}</DialogDescription>
            <div className="flex justify-end">
              <Button onClick={another}>Choose another workspace</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {!signedIn && !ended && <SignInAgain />}
    </>
  )
}

type ProfileLoad = { uid: string; state: 'ready' | 'none' | 'failed' }

export function Gate({ children }: { children: ReactNode }) {
  const [loc] = useLocation()
  const ready = useAuth((s) => s.ready)
  const authUser = useAuth((s) => s.user)
  const lost = useAuth((s) => s.lost)
  const workspaceId = useSession((s) => s.workspaceId)
  const profileId = useSession((s) => s.profileId)
  const user = useSession((s) => s.user)
  const [load, setLoad] = useState<ProfileLoad>()
  const [attempt, setAttempt] = useState(0)
  const uid = authUser?.id

  // who you are here: your profile, found again on every start
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
        if (!stop) setLoad({ uid, state: 'failed' })
      },
    )
    return () => {
      stop = true
    }
  }, [uid, attempt])

  if (!ready) return <Waiting title="Just a moment…" />
  if (loc.startsWith('/join/')) return <JoinLater />
  const me = (person: Person | null, id: string | null): MyProfile | null => (person && id ? { id, person } : null)
  const mine = me(user, profileId)
  // signed out while working (it ran out): everything stays on screen, with "Please sign in again" on top
  if (workspaceId && mine && (authUser || lost)) {
    return (
      <OpenWorkspace key={`${workspaceId}:${mine.id}`} workspaceId={workspaceId} me={mine}>
        {children}
      </OpenWorkspace>
    )
  }
  if (!authUser) return <SignIn />
  const state = load?.uid === authUser.id ? load.state : 'loading'
  if (state === 'loading') return <Waiting title="Signing you in…" />
  if (state === 'failed') return <ProfileFailed onRetry={() => setAttempt((n) => n + 1)} />
  if (state === 'none' || !mine) {
    return (
      <PickLogin
        onDone={(p) => {
          useSession.getState().setProfile(p.id, p.person)
          setLoad({ uid: authUser.id, state: 'ready' })
        }}
      />
    )
  }
  return <PickWorkspace />
}
