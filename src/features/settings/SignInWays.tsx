/** Settings › Your account › Ways to sign in: an email and a password, GitHub (and Google, once it's switched on). */
import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, Mail, Plus, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { ADDING_KEY, addGitHub, friendlyAuthError, removeWay, useAuth, waysToSignIn, type WayRow } from '@/backend/auth'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Problem } from '@/features/onboarding/Step'
import { GitHubMark } from '@/features/onboarding/Welcome'
import { Button } from '@/ui/button'
import { PasswordDialog } from './PasswordDialog'

const NAMES: Record<WayRow['kind'], string> = { password: 'Email and password', github: 'GitHub', google: 'Google' }

function Icon({ kind }: { kind: WayRow['kind'] }) {
  if (kind === 'password') return <Mail className="size-5" />
  if (kind === 'github') return <span className="size-5 [&_svg]:size-5">{<GitHubMark />}</span>
  return <KeyRound className="size-5" />
}

export function SignInWays() {
  const urlProblem = useAuth((s) => s.urlProblem)
  const [ways, setWays] = useState<WayRow[]>()
  const [failed, setFailed] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [password, setPassword] = useState<'set' | 'change'>()
  const [removing, setRemoving] = useState<WayRow>()
  const [busy, setBusy] = useState<WayRow['kind'] | null>(null)

  const load = useCallback(async () => {
    try {
      const w = await waysToSignIn()
      setWays(w)
      setFailed(false)
      return w
    } catch (e) {
      console.warn('Sprawniej couldn’t read your ways to sign in', e)
      setFailed(true)
      return undefined
    }
  }, [])

  // back from GitHub, after adding it (or not)
  useEffect(() => {
    let adding: string | null = null
    try {
      adding = sessionStorage.getItem(ADDING_KEY)
      sessionStorage.removeItem(ADDING_KEY)
    } catch {
      // nothing was being added
    }
    void load().then((w) => {
      if (!adding) return
      if (w?.some((r) => r.kind === 'github' && r.on)) toast('GitHub added. You can sign in with it from now on.')
      else if (urlProblem) setProblem(urlProblem)
    })
    // once, when Settings opens
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function add() {
    setBusy('github')
    setProblem(undefined)
    try {
      await addGitHub() // leaves for GitHub
    } catch (e) {
      setProblem(friendlyAuthError(e))
      setBusy(null)
    }
  }

  async function remove(w: WayRow) {
    if (!w.identityId) return
    setBusy(w.kind)
    setProblem(undefined)
    try {
      await removeWay(w.identityId)
      toast(`You can't sign in with ${NAMES[w.kind]} any more.`)
      await load()
    } catch (e) {
      setProblem(friendlyAuthError(e))
    } finally {
      setBusy(null)
    }
  }

  const email = ways?.find((w) => w.kind === 'password')?.detail ?? ''

  return (
    <div>
      <h3 className="font-medium">Ways to sign in</h3>
      <p className="mb-3 text-sm text-muted-foreground">Use any of these to sign in to Sprawniej.</p>
      {!ways && !failed && <p className="text-sm text-muted-foreground">Loading…</p>}
      {failed && !ways && (
        <>
          <Problem>We couldn't load your ways to sign in. Try again.</Problem>
          <Button variant="outline" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </>
      )}
      {ways && (
        <ul className="flex max-w-xl flex-col gap-1">
          {ways.map((w) => (
            <li key={w.kind} className="flex items-center gap-3 py-1.5" data-way={w.kind}>
              <span className="flex size-8 items-center justify-center text-muted-foreground">
                <Icon kind={w.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{NAMES[w.kind]}</span>
                {(w.detail || w.why) && <span className="block truncate text-sm text-muted-foreground">{w.action ? w.detail : [w.detail, w.why].filter(Boolean).join(' · ')}</span>}
              </span>
              {w.action === 'set-password' && (
                <Button variant="outline" size="sm" onClick={() => setPassword('set')}>
                  Set a password
                </Button>
              )}
              {w.action === 'change-password' && (
                <Button variant="outline" size="sm" onClick={() => setPassword('change')}>
                  Change password
                </Button>
              )}
              {w.action === 'add' && w.kind === 'github' && (
                <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void add()}>
                  {busy === 'github' ? <Loader2 className="animate-spin" /> : <Plus />} Add GitHub
                </Button>
              )}
              {w.action === 'remove' && (
                <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setRemoving(w)}>
                  {busy === w.kind ? <Loader2 className="animate-spin" /> : <Unlink />} Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Problem>{problem}</Problem>
      {password && (
        <PasswordDialog
          change={password === 'change'}
          email={email}
          onDone={(saved) => {
            setPassword(undefined)
            if (saved) void load()
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(undefined)}
        title={`Stop signing in with ${removing ? NAMES[removing.kind] : 'GitHub'}?`}
        confirm={`Remove ${removing ? NAMES[removing.kind] : 'GitHub'}`}
        keep="Cancel"
        onConfirm={() => removing && void remove(removing)}
      >
        <span>You can still sign in with your email and password, and add {removing ? NAMES[removing.kind] : 'GitHub'} again later.</span>
      </ConfirmDialog>
    </div>
  )
}
