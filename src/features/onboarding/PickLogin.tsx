/** Signed in for the first time: your name and @handle, the way teammates will see you. */
import { useState, type SubmitEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/backend/auth'
import { createProfile, LOGIN_PATTERN, suggestLogin, type MyProfile } from '@/backend/profiles'
import { useSignOut } from '@/components/SignOut'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Problem, Step } from './Step'

const BAD_HANDLE = 'Use up to 39 letters, digits and dashes, starting with a letter or a digit.'

export function PickLogin({ onDone }: { onDone: (p: MyProfile) => void }) {
  const user = useAuth((s) => s.user)
  const { signOut, dialog: signOutDialog } = useSignOut()
  const [name, setName] = useState(user?.name ?? '')
  const [login, setLogin] = useState(() => suggestLogin(user?.email ?? null, user?.name))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const bad = !!login && !LOGIN_PATTERN.test(login)
  const ok = !!name.trim() && !!login && !bad

  async function submit(e?: SubmitEvent<HTMLFormElement>) {
    e?.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    setProblem(undefined)
    try {
      onDone(await createProfile(login, name))
    } catch (err) {
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
          <Problem>{bad ? BAD_HANDLE : problem}</Problem>
        </div>
        <button type="submit" hidden />
      </form>
    </Step>
  )
}
