/** Settings › Ways to sign in: an email and a password, GitHub (and Google, once it's switched on). */
import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { KeyRound, Loader2, Mail, Plus, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { ADDING_KEY, addWay, friendlyAuthError, removeWay, useAuth, waysToSignIn, type WayRow } from '@/backend/auth'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Problem } from '@/features/onboarding/Step'
import { GitHubMark } from '@/features/onboarding/Welcome'
import { sessionStore } from '@/lib/storage'
import { Button } from '@/ui/button'
import { PasswordDialog } from './PasswordDialog'

const NAMES: Record<WayRow['kind'], string> = { password: 'Email and password', github: 'GitHub', google: 'Google' }

function Icon({ kind }: { kind: WayRow['kind'] }) {
  if (kind === 'password') return <Mail className="size-5" />
  if (kind === 'github')
    return (
      <span className="size-5 [&_svg]:size-5">
        <GitHubMark />
      </span>
    )
  return <KeyRound className="size-5" />
}

export function SignInWays() {
  const urlProblem = useAuth((s) => s.urlProblem)
  const [ways, setWays] = useState<WayRow[]>()
  const [failed, setFailed] = useState(false)
  const [problem, setProblem] = useState<string>()
  /** the password dialog, for setting one or changing it */
  const [passwordDialog, setPasswordDialog] = useState<'set' | 'change'>()
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

  // back from GitHub after adding it (or not): say how it went, with the problem as it was when Settings opened
  const cameBack = useEffectEvent((adding: string | null, w: WayRow[] | undefined) => {
    if (!adding) return
    if (w?.some((r) => r.kind === adding && r.on)) toast(`${NAMES[adding === 'google' ? 'google' : 'github']} added. You can sign in with it from now on.`)
    else if (urlProblem) setProblem(urlProblem)
  })

  useEffect(() => {
    const adding = sessionStore.getItem(ADDING_KEY)
    sessionStore.removeItem(ADDING_KEY)
    let stop = false
    waysToSignIn().then(
      (w) => {
        if (stop) return
        setWays(w)
        cameBack(adding, w)
      },
      (e: unknown) => {
        console.warn('Sprawniej couldn’t read your ways to sign in', e)
        if (!stop) setFailed(true)
      },
    )
    return () => {
      stop = true
    }
  }, [])

  async function add(kind: 'github' | 'google') {
    setBusy(kind)
    setProblem(undefined)
    try {
      await addWay(kind) // leaves for GitHub or Google
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
            <li key={w.kind} className="flex flex-wrap items-center gap-3 py-1.5" data-way={w.kind}>
              <span className="flex size-8 items-center justify-center text-muted-foreground">
                <Icon kind={w.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{NAMES[w.kind]}</span>
                {(w.detail || w.why) && (
                  <span className="block text-sm break-words text-muted-foreground">{w.action ? w.detail : [w.detail, w.why].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              {w.action === 'set-password' && (
                <Button variant="outline" size="sm" onClick={() => setPasswordDialog('set')}>
                  Set a password
                </Button>
              )}
              {w.action === 'change-password' && (
                <Button variant="outline" size="sm" onClick={() => setPasswordDialog('change')}>
                  Change password
                </Button>
              )}
              {w.action === 'add' && w.kind !== 'password' && (
                <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void add(w.kind === 'google' ? 'google' : 'github')}>
                  {busy === w.kind ? <Loader2 className="animate-spin" /> : <Plus />} Add {NAMES[w.kind]}
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
      {passwordDialog && (
        <PasswordDialog
          change={passwordDialog === 'change'}
          email={email}
          onDone={(saved) => {
            setPasswordDialog(undefined)
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
        <span>You can still sign in another way, and add {removing ? NAMES[removing.kind] : 'GitHub'} again later.</span>
      </ConfirmDialog>
    </div>
  )
}
