/**
 * Settings › GitHub: the repositories whose pull requests move this workspace's issues (docs/github-app.md). Admins
 * and owners connect and remove them; everyone sees whether their own pull requests count.
 */
import { useCallback, useEffect, useState, type SubmitEvent } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'wouter'
import { listRepos, type GitHubRepo } from '@/backend/github'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GITHUB_APP_URL } from '@/config'
import { connectRepo, disconnectRepo } from '@/data/actions'
import { useData } from '@/data/store'
import { GitHubMark } from '@/features/onboarding/Welcome'
import { Problem } from '@/features/onboarding/Step'
import { timeAgo } from '@/features/issues/format'
import { useNow } from '@/lib/useNow'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { lastText } from './githubText'

/** the connected repositories, read when Settings › GitHub opens, after a change and when the window gets focus */
function useRepos(ws: string | null, admin: boolean) {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [asked, setAsked] = useState(0)
  const reload = useCallback(() => setAsked((n) => n + 1), [])

  useEffect(() => {
    if (!ws || !admin) return
    let stop = false
    listRepos(ws).then(
      (list) => {
        if (stop) return
        setRepos(list)
        setState('ready')
      },
      (e: unknown) => {
        console.warn('Sprawniej couldn’t read the connected repositories', e)
        if (!stop) setState((s) => (s === 'ready' ? s : 'failed'))
      },
    )
    return () => {
      stop = true
    }
  }, [ws, admin, asked])

  useEffect(() => {
    if (!admin) return
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [admin, reload])

  return { repos, state, reload }
}

function ConnectDialog({ onDone }: { onDone: (repo?: string) => void }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setProblem(undefined)
    try {
      onDone(await connectRepo(input))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "We couldn't connect the repository. Try again in a moment.")
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onDone()}>
      <DialogContent className="[overflow-wrap:anywhere] sm:max-w-lg">
        <DialogTitle>Connect a repository</DialogTitle>
        <DialogDescription>Its pull requests will move the issues they mention, as the person who opened them.</DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div>
            <label htmlFor="github-repo" className="mb-1.5 block text-sm font-medium">
              Repository
            </label>
            <Input
              id="github-repo"
              className="h-10 font-mono"
              placeholder="owner/name"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <p className="mt-1.5 text-sm text-muted-foreground">As on GitHub, for example acme/website. You can also paste its address.</p>
          </div>
          <Problem>{problem}</Problem>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onDone()}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !input.trim()}>
              {busy && <Loader2 className="animate-spin" />} Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RepoLine({ r, now, onRemove }: { r: GitHubRepo; now: number; onRemove: () => void }) {
  const last = r.last
  const statuses = useData((s) => s.statuses)
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="size-5 shrink-0 text-muted-foreground [&_svg]:size-5">
        <GitHubMark />
      </span>
      <span className="min-w-0 flex-1">
        <a className="block truncate font-medium hover:underline" href={`https://github.com/${r.repo}`} target="_blank" rel="noreferrer">
          {r.repo}
        </a>
        <span className="block text-sm text-muted-foreground">
          {last && r.lastAt ? (
            <>
              Last pull request:{' '}
              {last.url ? (
                <a className="underline-offset-2 hover:underline" href={last.url} target="_blank" rel="noreferrer">
                  #{last.number}
                </a>
              ) : (
                `#${last.number ?? '?'}`
              )}{' '}
              {lastText(last, statuses)} · {timeAgo(r.lastAt, new Date(now))}
            </>
          ) : (
            'Waiting for the first pull request'
          )}
        </span>
      </span>
      <Button variant="ghost" size="sm" onClick={onRemove}>
        <Trash2 /> Remove
      </Button>
    </li>
  )
}

function Repos({ ws }: { ws: string | null }) {
  const { repos, state, reload } = useRepos(ws, true)
  const now = useNow()
  const [connecting, setConnecting] = useState(false)
  const [removing, setRemoving] = useState<GitHubRepo>()

  async function remove(r: GitHubRepo) {
    try {
      await disconnectRepo(r.id)
      toast(`${r.repo} removed. Its pull requests don't move issues any more.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : "We couldn't remove the repository. Try again in a moment.")
    } finally {
      reload()
    }
  }

  const connect = (
    <Button variant="outline" onClick={() => setConnecting(true)}>
      <Plus /> Connect a repository
    </Button>
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">Repositories</h2>
          <p className="text-sm text-muted-foreground">
            A repository also needs the Sprawniej GitHub App.{' '}
            {GITHUB_APP_URL ? (
              <a className="underline underline-offset-2" href={GITHUB_APP_URL} target="_blank" rel="noreferrer">
                Add the app to a repository
              </a>
            ) : (
              'Ask whoever set up Sprawniej to add it.'
            )}
          </p>
        </div>
        {state === 'ready' && repos.length > 0 && connect}
      </div>
      {state === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
      {state === 'failed' && (
        <>
          <Problem>We couldn't load the connected repositories. Try again.</Problem>
          <Button variant="outline" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </>
      )}
      {state === 'ready' && !repos.length && (
        <EmptyState icon={<GitHubMark />} title="No repositories yet" action={connect}>
          Connect a repository and its pull requests move the issues they mention.
        </EmptyState>
      )}
      {state === 'ready' && repos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {repos.map((r) => (
            <RepoLine key={r.id} r={r} now={now} onRemove={() => setRemoving(r)} />
          ))}
        </ul>
      )}
      {connecting && (
        <ConnectDialog
          onDone={(repo) => {
            setConnecting(false)
            if (repo) {
              toast(`${repo} connected. Its next pull request moves the issues it mentions.`)
              reload()
            }
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(undefined)}
        title={`Remove ${removing?.repo ?? 'the repository'}?`}
        confirm="Remove"
        onConfirm={() => removing && void remove(removing)}
      >
        <span>Its pull requests stop moving issues. Issues that already moved stay where they are.</span>
      </ConfirmDialog>
    </div>
  )
}

/** whether your own pull requests count: they do once GitHub is one of your ways to sign in */
function Yours() {
  const login = useSession((s) => s.user?.login)
  const linked = useData((s) => (login ? (s.people[login]?.githubId ?? 0) > 0 : false))
  return (
    <p className="text-sm text-muted-foreground">
      {linked ? (
        'Your pull requests move your issues: you sign in with GitHub.'
      ) : (
        <>
          Your pull requests move issues once GitHub is one of your{' '}
          <Link href="/settings/account/sign-in" className="text-foreground underline underline-offset-2">
            ways to sign in
          </Link>
          .
        </>
      )}
    </p>
  )
}

export function GitHubSettings({ admin }: { admin: boolean }) {
  const ws = useSession((s) => s.workspaceId)
  return (
    <div className="flex flex-col gap-6">
      <Yours />
      {admin ? <Repos ws={ws} /> : <p className="text-sm text-muted-foreground">Admins and owners connect repositories.</p>}
    </div>
  )
}
