/**
 * Opening an invite link (#/join/<token>): who invited you and to what, then Join, an account if you have none, your
 * name, and in. The press of Join is remembered in this tab (JOINING_KEY), so a trip to GitHub to sign in carries on
 * by itself when it comes back.
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ProfileFailed, Waiting } from '@/app/Gate'
import type { MyProfileState } from '@/app/useMyProfile'
import { useAuth } from '@/backend/auth'
import { InviteError, inviteInfo, type InviteInfo } from '@/backend/workspaces'
import { PersonAvatar } from '@/components/Avatar'
import { useSignOut } from '@/components/SignOut'
import { joinWorkspace } from '@/data/actions'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { JOINING_KEY, joinStage, peopleLine } from './invite'
import { PickLogin } from './PickLogin'
import { Problem, Step } from './Step'
import { SignInForm, type Mode } from './Welcome'

const pressedFor = (token: string) => {
  try {
    return sessionStorage.getItem(JOINING_KEY) === token
  } catch {
    return false
  }
}

function forget() {
  try {
    sessionStorage.removeItem(JOINING_KEY)
  } catch {
    // nothing kept, nothing to forget
  }
}

function GoHome({ title, children }: { title: string; children: string }) {
  const [, navigate] = useLocation()
  return (
    <Step
      title={title}
      footer={
        <Button
          size="lg"
          onClick={() => {
            forget()
            navigate('/', { replace: true })
          }}
        >
          Go to Sprawniej
        </Button>
      }
    >
      <p>{children}</p>
    </Step>
  )
}

export function JoinFlow({ link, profile }: { link: { token: string } | 'old'; profile: MyProfileState }) {
  if (link === 'old') return <GoHome title="This invite link is from an older Sprawniej">Ask whoever invited you for a new link.</GoHome>
  return <Join key={link.token} token={link.token} profile={profile} />
}

function People({ people }: { people: InviteInfo['people'] }) {
  if (!people.length) return null
  return (
    <div className="mt-5 flex flex-col gap-2">
      <div className="flex -space-x-1.5">
        {people.map((p, i) => (
          <PersonAvatar key={i} person={{ login: p.name, name: p.name, avatarUrl: p.avatarUrl, githubId: 0 }} className="size-8 text-xs ring-2 ring-background" />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{peopleLine(people.map((p) => p.name))}</p>
    </div>
  )
}

function Join({ token, profile }: { token: string; profile: MyProfileState }) {
  const [, navigate] = useLocation()
  const user = useAuth((s) => s.user)
  const uid = user?.id
  const [info, setInfo] = useState<InviteInfo | null | undefined>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pressed, setPressed] = useState(() => pressedFor(token))
  const [mode, setMode] = useState<Mode>('sign-up')
  const [sentTo, setSentTo] = useState<string>()
  const [joinProblem, setJoinProblem] = useState<string>()
  const joining = useRef(false)
  const { signOut, dialog: signOutDialog } = useSignOut(location.hash)

  // signing in can make it "you're already in"
  useEffect(() => {
    let stop = false
    inviteInfo(token).then(
      (i) => {
        if (stop) return
        setFailed(false)
        setInfo(i)
      },
      (e: unknown) => {
        console.warn('Sprawniej couldn’t read the invite', e)
        if (!stop) setFailed(true)
      },
    )
    return () => {
      stop = true
    }
  }, [token, uid, attempt])

  const stage = joinStage({ info, failed, signedIn: !!user, profile: profile.state, pressedJoin: pressed })
  const ws = info?.workspaceName ?? ''
  const by = info?.invitedBy?.name ?? 'whoever invited you'

  useEffect(() => {
    if (stage !== 'joining' || joining.current || joinProblem || !info) return
    joining.current = true
    joinWorkspace(token).then(
      (id) => {
        forget()
        useSession.getState().open({ id, name: info.workspaceName })
        navigate('/', { replace: true })
        toast(`You joined ${info.workspaceName}`)
      },
      (e: unknown) => {
        const err = e instanceof InviteError ? e : new InviteError('other', String(e))
        if (err.kind === 'used' || err.kind === 'expired') {
          forget()
          setInfo({ ...info, state: err.kind, people: [] })
        } else if (err.kind === 'unknown') {
          forget()
          setInfo(null)
        } else {
          joining.current = false
          setJoinProblem(err.message)
        }
      },
    )
  }, [stage, token, info, joinProblem, navigate])

  const goHome = () => {
    forget()
    navigate('/', { replace: true })
  }

  switch (stage) {
    case 'loading':
      return <Waiting title="Just a moment…" />
    case 'failed':
      return (
        <Step
          title="We couldn't open this invite"
          footer={
            <Button size="lg" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          <Problem>Can't reach Sprawniej. Check your internet connection and try again.</Problem>
        </Step>
      )
    case 'unknown':
      return (
        <GoHome title="This invite link doesn't work">
          It may have been deleted, or part of the link is missing. Ask whoever invited you for a new one.
        </GoHome>
      )
    case 'used':
      return <GoHome title="This invite was already used">{`Each invite link works once. Ask ${by} for a new one.`}</GoHome>
    case 'expired':
      return <GoHome title="This invite has expired">{`Invite links work for 14 days. Ask ${by} for a new one.`}</GoHome>
    case 'member':
      return (
        <Step
          title={`You're already in ${ws}`}
          footer={
            <Button
              size="lg"
              onClick={() => {
                forget()
                if (info?.workspaceId) useSession.getState().open({ id: info.workspaceId, name: ws })
                navigate('/', { replace: true })
              }}
            >
              Open {ws}
            </Button>
          }
        >
          <p>There's nothing more to do.</p>
          {info?.forName && <p className="mt-3">If you're {info.forName} from Linear, ask an admin to link you in Settings.</p>}
        </Step>
      )
    case 'welcome':
      return (
        <Step
          title={`Join ${ws}`}
          footer={
            <>
              <Button
                size="lg"
                onClick={() => {
                  try {
                    sessionStorage.setItem(JOINING_KEY, token)
                  } catch {
                    // this tab only, then
                  }
                  setPressed(true)
                }}
              >
                Join {ws}
              </Button>
              {user && (
                <span className="ml-auto text-sm text-muted-foreground">
                  Signed in as {user.email ?? profile.mine?.person.login} ·{' '}
                  <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={signOut}>
                    use another account
                  </button>
                </span>
              )}
            </>
          }
        >
          {signOutDialog}
          <p>
            {info?.invitedBy ? `${info.invitedBy.name} invited you to ${ws}` : `You're invited to ${ws}`}, where the team plans and tracks its work in
            Sprawniej.
          </p>
          <People people={info?.people ?? []} />
          {info?.role === 'admin' && <p className="mt-4">You'll be an admin: you can invite people and change roles.</p>}
          {info?.forName && (
            <p className="mt-4 rounded-lg border px-3 py-2 text-sm">
              This invite is for {info.forName}. When you join, {info.forName}'s issues, comments and views from Linear become yours.
            </p>
          )}
        </Step>
      )
    case 'account':
      if (sentTo) {
        return (
          <Step title="Check your email">
            <p>We sent a link to {sentTo}. Open it to finish creating your account, then open your invite link again.</p>
          </Step>
        )
      }
      return (
        <Step
          title={mode === 'sign-up' ? 'Create your account' : `Sign in to join ${ws}`}
          footer={
            <Button
              variant="ghost"
              onClick={() => {
                forget()
                setPressed(false)
              }}
            >
              Back
            </Button>
          }
        >
          <p className="mb-6">You'll use it to sign in to Sprawniej from now on.</p>
          <SignInForm mode={mode} onMode={setMode} onCheckEmail={setSentTo} />
        </Step>
      )
    case 'profile':
      return profile.state === 'failed' ? <ProfileFailed problem={profile.problem ?? ''} onRetry={profile.retry} /> : <Waiting title="Just a moment…" />
    case 'name':
      return <PickLogin initialName={info?.forName ?? undefined} onDone={profile.picked} />
    case 'joining':
      return joinProblem ? (
        <Step
          title={`Joining ${ws}…`}
          footer={
            <>
              <Button size="lg" onClick={() => setJoinProblem(undefined)}>
                Try again
              </Button>
              <Button variant="ghost" size="lg" onClick={goHome}>
                Go to Sprawniej
              </Button>
            </>
          }
        >
          <Problem>{joinProblem}</Problem>
        </Step>
      ) : (
        <Step title={`Joining ${ws}…`}>
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-label="Loading" /> Just a moment.
          </p>
        </Step>
      )
  }
}
