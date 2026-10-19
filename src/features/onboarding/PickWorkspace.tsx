/** Signed in, but no workspace open: the workspaces you're in (the ones you opened lately first), or a new one. */
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { Boxes, Plus } from 'lucide-react'
import { myWorkspaces, type WorkspaceInfo } from '@/backend/workspaces'
import { EmptyState } from '@/components/EmptyState'
import { Logo } from '@/components/Logo'
import { useSignOut } from '@/components/SignOut'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { NewWorkspace } from './NewWorkspace'
import { Problem, Step } from './Step'

/** pages every workspace has: a link to one (opened before signing in) is kept while you choose */
const WORKSPACE_PAGE = /^\/(inbox|my-issues|projects|project\/[^/]+|views|view\/[^/]+|team\/[^/]+(\/.*)?|issue\/[^/]+|help|whats-new|settings(\/import)?)$/

export function PickWorkspace() {
  const [loc, navigate] = useLocation()
  const { user, recent, open } = useSession()
  const { signOut, dialog: signOutDialog } = useSignOut()
  const [list, setList] = useState<WorkspaceInfo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let stop = false
    myWorkspaces().then(
      (l) => !stop && setList(l),
      () => !stop && setFailed(true),
    )
    return () => {
      stop = true
    }
  }, [attempt])

  const shown = useMemo(() => {
    const rank = (w: WorkspaceInfo) => {
      const n = recent.findIndex((r) => r.id === w.id)
      return n < 0 ? recent.length : n
    }
    return [...(list ?? [])].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [list, recent])

  if (creating) return <NewWorkspace onBack={() => setCreating(false)} />

  const pick = (w: WorkspaceInfo) => {
    open({ id: w.id, name: w.name })
    if (!WORKSPACE_PAGE.test(loc)) navigate('/', { replace: true })
  }
  const empty = list !== null && !list.length

  return (
    <Step
      wide
      title="Choose a workspace"
      footer={
        <>
          {!empty && (
            <Button size="lg" onClick={() => setCreating(true)}>
              <Plus /> Create a new workspace
            </Button>
          )}
          <span className="ml-auto text-sm text-muted-foreground">
            Signed in as @{user?.login} ·{' '}
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={signOut}>
              sign out
            </button>
          </span>
        </>
      }
    >
      {signOutDialog}
      {failed && (
        <>
          <Problem>We couldn't load your workspaces. Check your connection and try again.</Problem>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              setFailed(false)
              setAttempt((n) => n + 1)
            }}
          >
            Try again
          </Button>
        </>
      )}
      {list === null && !failed && <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>}
      {empty && (
        <EmptyState
          icon={<Boxes />}
          title="No workspaces yet"
          action={
            <Button size="lg" onClick={() => setCreating(true)}>
              <Plus /> Create a workspace
            </Button>
          }
        >
          A workspace holds your teams and their issues, projects and views. Create one to get started. Joining your team instead? Open the invite
          link they sent you.
        </EmptyState>
      )}
      {shown.length > 0 && (
        <div className="-mx-3 max-h-80 overflow-y-auto">
          {shown.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => pick(w)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
            >
              <Logo className="size-5" />
              <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </Step>
  )
}
