/**
 * Signed in for the first time: your name and @handle, the way teammates will see you. A new account made with GitHub
 * also gives its sign-up code here (GitHub can't carry one), or uses the invite link it came from.
 */
import { useEffect, useState, type SubmitEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { CODE_KEY, giveSignupCode, signupCodeNeeded, useAuth } from '@/backend/auth'
import { createProfile, LOGIN_PATTERN, ProfileProblem, suggestLogin, type MyProfile } from '@/backend/profiles'
import { useSignOut } from '@/components/SignOut'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Problem, Step } from './Step'
import { SignupCodeField } from './Welcome'

const BAD_HANDLE = 'Use up to 39 letters, digits and dashes, starting with a letter or a digit.'

/**
 * `initialName`: the name to start from when the sign-in has none (an invite for someone from Linear has theirs).
 * `invite`: the invite link's token, which lets a new account in without a code.
 */
export function PickLogin({ onDone, initialName, invite }: { onDone: (p: MyProfile) => void; initialName?: string; invite?: string }) {
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
      if (!askCode) setInviteRefused(true)
      setProblem(err instanceof Error ? err.message : String(err))
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
          <div className="flex h-10 overflow-hidden rounded-md border bg-input/30 text-[15px] focus-within:ring-2 focus-within:ring-ring/50">
            <span className="flex items-center border-r bg-muted px-3 text-muted-foreground select-none">@</span>
            <input
              id="my-handle"
              className="min-w-0 flex-1 bg-transparent px-3 outline-none"
              autoComplete="username"
              spellCheck={false}
              value={login}
              aria-invalid={bad}
              onChange={(e) => {
                setProblem(undefined)
                setLogin(e.target.value.replace(/[\s@]/g, ''))
              }}
            />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">Letters, digits and dashes. It can't be changed later.</p>
          <Problem>{bad ? BAD_HANDLE : askCode ? undefined : problem}</Problem>
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
