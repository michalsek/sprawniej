/**
 * Settings › Members: who is in the workspace and their roles. Admins and owners change roles and remove people;
 * only what the rules allow is offered (src/data/roles.ts), and anything else shows why.
 */
import { useMemo, useState } from 'react'
import { Loader2, MoreHorizontal, Search, UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import type { Role } from '@/backend/workspaces'
import { PersonAvatar } from '@/components/Avatar'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PagedList } from '@/components/PagedList'
import { removeFromWorkspace, setRole } from '@/data/actions'
import { choicesFor, ROLE_NAMES, ROLES, type Who } from '@/data/roles'
import { ownerCount } from '@/data/select'
import { useData } from '@/data/store'
import { fuzzy } from '@/lib/fuzzy'
import type { Person } from '@/model/schema'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

interface Row {
  who: Who
  person: Person
}

const RANK: Record<Role, number> = { owner: 0, admin: 1, member: 2 }
const anA = (r: Role) => (r === 'member' ? 'a member' : `an ${r}`)

/** "Ania, Tomek or Ola" */
const orList = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? ''))

/** what to ask before a role change, if anything */
type Asking = { kind: 'owner'; row: Row } | { kind: 'step-down'; row: Row; to: Role } | { kind: 'remove'; row: Row }

export function Members() {
  const ws = useData((s) => s.workspace?.name ?? '')
  const meLogin = useData((s) => s.me?.login)
  const { members, people } = useData(useShallow((s) => ({ members: s.members, people: s.people })))
  const rows: Row[] = useMemo(
    () =>
      Object.entries(members)
        .filter(([, m]) => !m.removedAt)
        .map(([login, m]) => ({ who: { login, role: m.role }, person: people[login] ?? { login, githubId: 0, name: login, avatarUrl: '' } })),
    [members, people],
  )
  const owners = ownerCount({ members })
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState<Asking>()

  const sorted = [...rows].sort((a, b) => RANK[a.who.role] - RANK[b.who.role] || a.person.name.localeCompare(b.person.name))
  const me = rows.find((r) => r.who.login === meLogin)?.who ?? null
  const shown = fuzzy(sorted, query, (r) => [r.person.name, r.who.login])
  const admins = sorted.filter((r) => r.who.role !== 'member' && r.who.login !== meLogin).map((r) => r.person.name)

  async function run(row: Row, to: Role | 'removed') {
    setBusy(row.who.login)
    try {
      if (to === 'removed') {
        await removeFromWorkspace(row.who.login)
        toast(`${row.person.name} was removed from ${ws}.`)
      } else {
        await setRole(row.who.login, to)
        toast(`${row.who.login === meLogin ? 'You are' : `${row.person.name} is`} now ${anA(to)}.`)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "That change couldn't be made. Try again in a moment.")
    } finally {
      setBusy(null)
    }
  }

  function pick(row: Row, to: Role) {
    if (to === row.who.role) return
    if (to === 'owner') setAsking({ kind: 'owner', row })
    else if (row.who.login === meLogin && row.who.role === 'owner') setAsking({ kind: 'step-down', row, to })
    else void run(row, to)
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length > 10 && (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-10 pl-9"
            placeholder="Search people…"
            aria-label="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
        </div>
      )}
      {query.trim() && !shown.length && <p className="text-muted-foreground">Nobody here matches “{query.trim()}”.</p>}
      <PagedList
        key={query.trim()}
        items={shown}
        noun="people"
        className="flex flex-col gap-1"
        row={(row) => {
          const { who, person } = row
          const choices = choicesFor(me, who, owners)
          const mine = who.login === meLogin
          return (
            <li key={who.login} className="flex items-center gap-3 py-1.5" data-member={who.login}>
              <PersonAvatar person={person} className="size-8 text-xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {person.name}
                  {mine && <span className="font-normal text-muted-foreground"> (you)</span>}
                </span>
                <span className="block truncate text-sm text-muted-foreground">@{who.login}</span>
              </span>
              {choices.roles.length > 1 ? (
                <Select value={who.role} disabled={busy === who.login} onValueChange={(v) => pick(row, v as Role)}>
                  <SelectTrigger className="w-32" aria-label={`Role of ${person.name}`}>
                    {busy === who.login && <Loader2 className="animate-spin" />}
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.filter((r) => choices.roles.includes(r)).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_NAMES[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline" className="text-muted-foreground" title={choices.why}>
                  {ROLE_NAMES[who.role]}
                </Badge>
              )}
              {choices.canRemove ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`More for ${person.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                    <DropdownMenuItem variant="destructive" onSelect={() => setAsking({ kind: 'remove', row })}>
                      <UserMinus /> Remove from workspace
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="size-8" aria-hidden />
              )}
            </li>
          )
        }}
      />
      {me?.role === 'member' && (
        <p className="text-sm text-muted-foreground">
          Only admins and owners can invite people.{admins.length ? ` Ask ${orList(admins.slice(0, 3))} for an invite link.` : ''}
        </p>
      )}

      <ConfirmDialog
        open={asking?.kind === 'owner'}
        onOpenChange={(o) => !o && setAsking(undefined)}
        title={`Make ${asking?.row.person.name} an owner?`}
        confirm="Make owner"
        keep="Cancel"
        onConfirm={() => asking && void run(asking.row, 'owner')}
      >
        <span>Owners can do everything, including changing other owners. You stay an owner too.</span>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking?.kind === 'step-down'}
        onOpenChange={(o) => !o && setAsking(undefined)}
        title="Stop being an owner?"
        confirm="Change my role"
        keep="Cancel"
        onConfirm={() => asking?.kind === 'step-down' && void run(asking.row, asking.to)}
      >
        <span>You'll be {asking?.kind === 'step-down' ? anA(asking.to) : 'an admin'}. The other owners stay in charge.</span>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking?.kind === 'remove'}
        onOpenChange={(o) => !o && setAsking(undefined)}
        title={`Remove ${asking?.row.person.name} from ${ws}?`}
        confirm="Remove"
        keep="Cancel"
        onConfirm={() => asking && void run(asking.row, 'removed')}
      >
        <span>They can't open the workspace any more. Their issues and comments stay, with their name. To bring them back, send them a new invite.</span>
      </ConfirmDialog>
    </div>
  )
}
