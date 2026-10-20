/**
 * Settings › Notion: a button or an automation in Notion sends a page here, and it becomes an issue (docs/notion.md).
 * Admins and owners connect the workspace, pick the team pages go to, replace the address and disconnect; members
 * read one line. The address is shown once, when it's made: only its key's sha256 is kept.
 */
import { useCallback, useEffect, useState, type SubmitEvent } from 'react'
import { Copy, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { getNotion, type NotionConnection } from '@/backend/notion'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { NotionMark } from '@/components/NotionMark'
import { connectNotion, disconnectNotion, newNotionAddress, setNotionTeam } from '@/data/actions'
import { myTeamKeys } from '@/data/select'
import { useData } from '@/data/store'
import { timeAgo } from '@/features/issues/format'
import { Problem } from '@/features/onboarding/Step'
import { useNow } from '@/lib/useNow'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { copy } from './copy'
import { notionText } from './notionText'

const words = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

/** the connection, read when Settings › Notion opens, after a change and when the window gets focus */
function useNotion(ws: string | null) {
  const [conn, setConn] = useState<NotionConnection | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [asked, setAsked] = useState(0)
  const reload = useCallback(() => setAsked((n) => n + 1), [])

  useEffect(() => {
    if (!ws) return
    let stop = false
    getNotion(ws).then(
      (c) => {
        if (stop) return
        setConn(c)
        setState('ready')
      },
      (e: unknown) => {
        console.warn('Sprawniej couldn’t read the Notion connection', e)
        if (!stop) setState((s) => (s === 'ready' ? s : 'failed'))
      },
    )
    return () => {
      stop = true
    }
  }, [ws, asked])

  useEffect(() => {
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [reload])

  return { conn, state, reload }
}

/** the workspace's teams, the ones you're in first, as the sidebar lists them */
function useTeamChoices() {
  const teams = useData((s) => s.teams)
  const me = useData((s) => s.me)
  const mine = myTeamKeys({ teams, me })
  const rest = Object.keys(teams)
    .filter((k) => !mine.includes(k))
    .sort()
  return { teams, keys: [...mine, ...rest] }
}

function TeamPicker({ id, value, onChange, disabled }: { id: string; value: string | undefined; onChange: (key: string) => void; disabled?: boolean }) {
  const { teams, keys } = useTeamChoices()
  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="h-10 w-60">
        <SelectValue placeholder="Pick a team" />
      </SelectTrigger>
      <SelectContent>
        {keys.map((k) => (
          <SelectItem key={k} value={k}>
            <span className="w-4 text-center leading-none">{teams[k]?.emoji}</span> {teams[k]?.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** the address, once: copied now or never seen again */
function AddressView({ address, onDone }: { address: string; onDone: () => void }) {
  return (
    <>
      <DialogTitle>Copy the address for Notion</DialogTitle>
      <DialogDescription>
        Copy it now: it's shown only once. In Notion, add a <span className="font-medium text-foreground">Send webhook</span> action to a
        database button or automation and paste it as the URL.
      </DialogDescription>
      <Input readOnly value={address} className="h-10 font-mono text-sm" onFocus={(e) => e.target.select()} aria-label="Address for Notion" />
      <div>
        <Button onClick={() => copy(address, 'Address')}>
          <Copy /> Copy
        </Button>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  )
}

/** shows an address made somewhere else (Replace address) */
function AddressDialog({ address, onDone }: { address: string; onDone: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="[overflow-wrap:anywhere] sm:max-w-lg">
        <AddressView address={address} onDone={onDone} />
      </DialogContent>
    </Dialog>
  )
}

/** Connect Notion: the team pages go to, then the address */
function ConnectDialog({ onDone }: { onDone: (made: boolean) => void }) {
  const { keys } = useTeamChoices()
  const [team, setTeam] = useState<string | undefined>(keys[0])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [address, setAddress] = useState<string>()

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || !team) return
    setBusy(true)
    setProblem(undefined)
    try {
      setAddress((await connectNotion(team)).address)
    } catch (err) {
      setProblem(words(err, "We couldn't connect Notion. Try again in a moment."))
    } finally {
      setBusy(false)
    }
  }

  const close = () => !busy && onDone(!!address)

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="[overflow-wrap:anywhere] sm:max-w-lg">
        {address ? (
          <AddressView address={address} onDone={close} />
        ) : (
          <>
            <DialogTitle>Connect Notion</DialogTitle>
            <DialogDescription>You'll get an address to paste into Notion. Pages sent to it become issues.</DialogDescription>
            <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
              <div>
                <label htmlFor="notion-team" className="mb-1.5 block text-sm font-medium">
                  Pages become issues in
                </label>
                <TeamPicker id="notion-team" value={team} onChange={setTeam} />
                <p className="mt-1.5 text-sm text-muted-foreground">
                  A page with a Team property goes to the team it names instead. You can change this later.
                </p>
              </div>
              <Problem>{problem}</Problem>
              <DialogFooter>
                <Button type="button" variant="ghost" disabled={busy} onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !team}>
                  {busy && <Loader2 className="animate-spin" />} Make the address
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Connected({ conn, reload }: { conn: NotionConnection; reload: () => void }) {
  const teams = useData((s) => s.teams)
  const now = useNow()
  const [moving, setMoving] = useState(false)
  const [confirm, setConfirm] = useState<'replace' | 'disconnect'>()
  const [address, setAddress] = useState<string>()
  const team = conn.teamKey && teams[conn.teamKey] ? conn.teamKey : undefined

  async function move(key: string) {
    if (key === team) return
    setMoving(true)
    try {
      await setNotionTeam(key)
      toast(`Pages from Notion now go to ${teams[key]?.name ?? key}.`)
    } catch (e) {
      toast(words(e, "We couldn't change the team. Try again in a moment."))
    } finally {
      setMoving(false)
      reload()
    }
  }

  async function replace() {
    try {
      setAddress(await newNotionAddress())
    } catch (e) {
      toast(words(e, "We couldn't make a new address. Try again in a moment."))
    } finally {
      reload()
    }
  }

  async function disconnect() {
    try {
      await disconnectNotion()
      toast("Notion disconnected. Pages sent from it don't become issues any more.")
    } catch (e) {
      toast(words(e, "We couldn't disconnect Notion. Try again in a moment."))
    } finally {
      reload()
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="notion-team" className="mb-1.5 block text-sm font-medium">
          Pages become issues in
        </label>
        <TeamPicker id="notion-team" value={team} onChange={(k) => void move(k)} disabled={moving} />
        {!team && <Problem>The team for Notion pages was deleted. Pick another.</Problem>}
      </div>
      <div className="flex items-start gap-3">
        <NotionMark className="mt-0.5" />
        <p className="min-w-0 text-sm text-muted-foreground">
          <span className="text-foreground">
            {notionText(conn.last)}
            {conn.last && conn.lastAt && ` · ${timeAgo(conn.lastAt, new Date(now))}`}
          </span>
          <br />
          Address made {timeAgo(conn.secretSetAt, new Date(now))}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setConfirm('replace')}>
          <RefreshCw /> Replace address
        </Button>
        <Button variant="ghost" onClick={() => setConfirm('disconnect')}>
          <Unplug /> Disconnect
        </Button>
      </div>
      <ConfirmDialog
        open={confirm === 'replace'}
        onOpenChange={(o) => !o && setConfirm(undefined)}
        title="Replace the address?"
        confirm="Replace address"
        tone="default"
        onConfirm={() => void replace()}
      >
        <span>The old address stops working at once. Paste the new one into Notion's button or automation.</span>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'disconnect'}
        onOpenChange={(o) => !o && setConfirm(undefined)}
        title="Disconnect Notion?"
        confirm="Disconnect"
        onConfirm={() => void disconnect()}
      >
        <span>Pages sent from Notion stop becoming issues. Issues already made stay.</span>
      </ConfirmDialog>
      {address && <AddressDialog address={address} onDone={() => setAddress(undefined)} />}
    </div>
  )
}

function Connection({ ws }: { ws: string | null }) {
  const { conn, state, reload } = useNotion(ws)
  const [connecting, setConnecting] = useState(false)

  if (state === 'loading') return <p className="text-sm text-muted-foreground">Loading…</p>
  if (state === 'failed') {
    return (
      <div>
        <Problem>We couldn't load the Notion connection. Try again.</Problem>
        <Button variant="outline" className="mt-3" onClick={reload}>
          Try again
        </Button>
      </div>
    )
  }
  return (
    <>
      {conn ? (
        <Connected conn={conn} reload={reload} />
      ) : (
        <EmptyState
          icon={<NotionMark className="size-12" />}
          title="Notion isn't connected"
          action={
            <Button variant="outline" onClick={() => setConnecting(true)}>
              Connect Notion
            </Button>
          }
        >
          A button in Notion can send a page here, and it becomes an issue: its title and a link back, plus its description,
          status, priority, assignee and due date when the page has them.
        </EmptyState>
      )}
      {connecting && (
        <ConnectDialog
          onDone={(made) => {
            setConnecting(false)
            if (made) {
              toast('Notion connected. The next page sent to that address becomes an issue.')
              reload()
            }
          }}
        />
      )}
    </>
  )
}

export function NotionSettings({ admin }: { admin: boolean }) {
  const ws = useSession((s) => s.workspaceId)
  if (!admin) return <p className="text-sm text-muted-foreground">Admins and owners can connect Notion so pages sent from it become issues.</p>
  return <Connection ws={ws} />
}
