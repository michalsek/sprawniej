/**
 * Signed in for the first time: your name and @handle, the way teammates will see you. A new account made with GitHub
 * also gives its sign-up code here (GitHub can't carry one), or uses the invite link it came from.
 */
import { useEffect, useState, type SubmitEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { CODE_KEY, giveSignupCode, INVITE_NO_PLACES, INVITE_REFUSED, signupCodeNeeded, useAuth } from '@/backend/auth'
import { createProfile, LOGIN_PATTERN, ProfileProblem, suggestLogin, type MyProfile } from '@/backend/profiles'
import { HandleInput } from '@/components/HandleInput'
import { useSignOut } from '@/components/SignOut'
import { HANDLE_WORDS } from '@/data/handles'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Problem, Step } from './Step'
import { SignupCodeField } from './Welcome'

/**
 * `initialName`: the name to start from when the sign-in has none (an invite for someone from Linear has theirs).
 * `invite`: the invite link's token, which lets a new account in without a code. `onInviteRefused`: it couldn't (the
 * link was used, ended, is full or expired, or has no places left), with the reason.
 */
export function PickLogin({
  onDone,
  initialName,
  invite,
  onInviteRefused,
}: {
  onDone: (p: MyProfile) => void
  initialName?: string
  invite?: string
  onInviteRefused?: (why: string) => void
}) {
  const user = useAuth((s) => s.user)
  // signing out on the way in through an invite comes back to the invite
  const { signOut, dialog: signOutDialog } = useSignOut(location.hash.startsWith('#/join/') ? location.hash : undefined)
  const [name, setName] = useState(user?.name || initialName || '')
  const [login, setLogin] = useState(() => suggestLogin(user?.email ?? null, user?.name))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  // whether this account still has to be let in (null: asking); the invite link is tried first, the field shows if it can't
  const [needed, setNeeded] = useState<boolean | null>(null)
  const [inviteRefused, setInviteRefused] = useState(false)
  const [code, setCode] = useState(() => sessionStorage.getItem(CODE_KEY) ?? '')
  const askCode = !!needed && (!invite || inviteRefused)
  const bad = !!login && !LOGIN_PATTERN.test(login)
  const ok = !!name.trim() && !!login && !bad && (!askCode || !!code.trim())

  useEffect(() => {
    let here = true
    // not known (no connection): picking the name says so, if it comes to that
    signupCodeNeeded().then(
      (n) => here && setNeeded(n),
      () => here && setNeeded(false),
    )
    return () => {
      here = false
    }
  }, [])

  async function letIn(): Promise<boolean> {
    if (!needed) return true
    try {
      await giveSignupCode(askCode ? { code } : { invite })
      setNeeded(false)
      return true
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      if (!askCode) setInviteRefused(true)
      setProblem(why)
      if (why === INVITE_REFUSED || why === INVITE_NO_PLACES) onInviteRefused?.(why)
      return false
    }
  }

  async function submit(e?: SubmitEvent<HTMLFormElement>) {
    e?.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    setProblem(undefined)
    if (!(await letIn())) return setBusy(false)
    try {
      onDone(await createProfile(login, name))
    } catch (err) {
      // asked whether a code was needed and couldn't tell: it was
      if (err instanceof ProfileProblem && err.code === 'SP004') setNeeded(true)
      setProblem(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Step
      title="What should we call you?"
      footer={
        <>
          <Button size="lg" disabled={!ok || busy} onClick={() => void submit()}>
            {busy && <Loader2 className="animate-spin" />} Continue
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">
            Signed in as {user?.email ?? user?.name} ·{' '}
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={signOut}>
              sign out
            </button>
          </span>
        </>
      }
    >
      {signOutDialog}
      <p className="mb-5">Teammates see your name on issues and comments, and @mention you by your handle.</p>
      <form className="flex flex-col gap-5" onSubmit={(e) => void submit(e)}>
        <div>
          <label htmlFor="my-name" className="mb-1.5 block text-sm font-medium">
            Your name
          </label>
          <Input id="my-name" className="h-10" autoFocus autoComplete="name" placeholder="Ania Kowalska" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="my-handle" className="mb-1.5 block text-sm font-medium">
            Handle
          </label>
          <HandleInput
            id="my-handle"
            autoComplete="username"
            value={login}
            aria-invalid={bad}
            aria-describedby="my-handle-hint my-handle-problem"
            onChange={(e) => {
              setProblem(undefined)
              setLogin(e.target.value.replace(/[\s@]/g, ''))
            }}
          />
          <p id="my-handle-hint" className="mt-1.5 text-sm text-muted-foreground">
            Letters, digits and dashes. You can change it later in Settings.
          </p>
          <Problem id="my-handle-problem">{bad ? HANDLE_WORDS.invalid : askCode ? undefined : problem}</Problem>
        </div>
        {askCode && (
          <div>
            <SignupCodeField value={code} onChange={setCode} />
            <Problem>{problem}</Problem>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Step>
  )
}
