/** The first screen: sign in (with GitHub, or an email and a password), or create an account. */
import { useEffect, useState, type SubmitEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { friendlyAuthError, githubAvailable, signInWithGitHub, signInWithPassword, signUpWithPassword, useAuth } from '@/backend/auth'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Separator } from '@/ui/separator'
import { Problem, Step } from './Step'

/** GitHub's mark (lucide has none) */
export function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

export type Mode = 'sign-in' | 'sign-up'

/**
 * The sign-in form, also used when a sign-in ran out (SignInAgain). Without `onMode` there's no "Create an account".
 * `onCheckEmail`: a new account has to open an emailed link first. "Continue with GitHub" shows once we know GitHub
 * sign-in is switched on, or when Sprawniej can't be reached to ask (the button then says so).
 */
export function SignInForm({ mode = 'sign-in', onMode, onCheckEmail }: { mode?: Mode; onMode?: (m: Mode) => void; onCheckEmail?: (email: string) => void }) {
  const urlProblem = useAuth((s) => s.urlProblem)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'github' | 'email' | null>(null)
  const [problem, setProblem] = useState<string>()
  const [githubProblem, setGithubProblem] = useState<string>()
  const signUp = mode === 'sign-up'
  const [github, setGithub] = useState<'on' | 'off' | 'unknown' | null>(null)

  useEffect(() => {
    let here = true
    void githubAvailable().then((a) => here && setGithub(a))
    return () => {
      here = false
    }
  }, [])

  async function continueWithGitHub() {
    setBusy('github')
    setGithubProblem(undefined)
    try {
      await signInWithGitHub() // leaves for GitHub
    } catch (e) {
      setGithubProblem(friendlyAuthError(e))
      setBusy(null)
    }
  }

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email.trim() || !password || busy) return
    setBusy('email')
    setProblem(undefined)
    try {
      if (!signUp) await signInWithPassword(email, password)
      else if ((await signUpWithPassword(email, password)) === 'check-email') onCheckEmail?.(email.trim())
    } catch (err) {
      setProblem(friendlyAuthError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      {github && github !== 'off' && (
        <>
          <Button variant="outline" size="lg" className="w-full" disabled={!!busy} onClick={() => void continueWithGitHub()}>
            {busy === 'github' ? <Loader2 className="animate-spin" /> : <GitHubMark />} Continue with GitHub
          </Button>
          <Problem>{githubProblem ?? urlProblem}</Problem>
          <div className="my-5 flex items-center gap-3 text-sm text-muted-foreground">
            <Separator className="flex-1" /> or <Separator className="flex-1" />
          </div>
        </>
      )}
      {/* coming back from a sign-in that didn't work, with GitHub's button hidden */}
      {(!github || github === 'off') && urlProblem && (
        <div className="-mt-3 mb-5">
          <Problem>{urlProblem}</Problem>
        </div>
      )}
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
            Email
          </label>
          <Input id="email" type="email" autoComplete="email" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete={signUp ? 'new-password' : 'current-password'}
            className="h-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signUp && <p className="mt-1.5 text-sm text-muted-foreground">At least 8 characters.</p>}
        </div>
        <Problem>{problem}</Problem>
        <Button type="submit" size="lg" disabled={!!busy || !email.trim() || !password}>
          {busy === 'email' && <Loader2 className="animate-spin" />} {signUp ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      {onMode && (
        <p className="mt-5 text-sm text-muted-foreground">
          {signUp ? 'Already have an account?' : 'New here?'}{' '}
          <button
            type="button"
            className="text-foreground underline underline-offset-2"
            onClick={() => {
              setProblem(undefined)
              onMode(signUp ? 'sign-in' : 'sign-up')
            }}
          >
            {signUp ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      )}
    </div>
  )
}

export function SignIn() {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [sentTo, setSentTo] = useState<string>()
  if (sentTo) {
    return (
      <Step title="Check your email" footer={<Button onClick={() => setSentTo(undefined)}>Back to sign in</Button>}>
        <p>We sent a link to {sentTo}. Open it to finish creating your account.</p>
      </Step>
    )
  }
  return (
    <Step title={mode === 'sign-up' ? 'Create your account' : 'Welcome to Sprawniej'}>
      {mode === 'sign-in' && <p className="mb-6">Plan and track your team's work: issues, projects and views, on a list or a board.</p>}
      <SignInForm mode={mode} onMode={setMode} onCheckEmail={setSentTo} />
    </Step>
  )
}
