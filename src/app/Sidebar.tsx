/** The left column: product name, personal pages, workspace pages and your favourites, your teams, and you at the bottom. */
import { useState } from 'react'
import { Link } from 'wouter'
import { SquarePen, ChevronDown, ChevronsUpDown, CircleHelp, CircleUser, Inbox, Layers, LogOut, Box, Plus, Settings, SquareStack, Repeat, Sparkles } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Logo } from '@/components/Logo'
import { PersonAvatar } from '@/components/Avatar'
import { useSwitchWorkspace } from '@/components/SignOut'
import { isUnread, myTeamKeys } from '@/data/select'
import { useData } from '@/data/store'
import { handleOf } from '@/model/schema'
import { TeamMenu } from '@/features/teams/TeamMenu'
import { TeamsDialog } from '@/features/teams/TeamsDialog'
import { openComposer } from '@/features/issues/composer'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { Favourites } from './Favourites'
import { NavGroup, NavItem } from './NavItem'

function TeamGroup({ teamKey }: { teamKey: string }) {
  const team = useData((s) => s.teams[teamKey])
  const [open, setOpen] = useState(true)
  if (!team) return null
  return (
    <div>
      <div className="group/team relative flex items-center rounded-lg hover:bg-sidebar-accent/60">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-left text-ui text-sidebar-foreground/90">
          <span className="w-[18px] text-center text-base leading-none">{team.emoji}</span>
          <span className="truncate">{team.name}</span>
          <ChevronDown className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
        </button>
        <TeamMenu teamKey={team.key} className="mr-1 md:opacity-0 md:group-hover/team:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100" />
      </div>
      {open && (
        <div className="flex flex-col gap-0.5">
          <NavItem indent href={`/team/${team.key}/issues`} icon={<SquareStack />}>
            Issues
          </NavItem>
          <NavItem indent href={`/team/${team.key}/projects`} icon={<Box />}>
            Projects
          </NavItem>
          <NavItem indent href={`/team/${team.key}/views`} icon={<Layers />}>
            Views
          </NavItem>
        </div>
      )}
    </div>
  )
}

function Me() {
  // your account's name, as teammates see it (it may differ from your name on GitHub)
  const me = useData((s) => (s.me ? (s.people[s.me.login] ?? s.me) : null))
  const workspace = useData((s) => s.workspace)
  const { switchWorkspace, dialog } = useSwitchWorkspace()
  if (!me) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg p-2 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
          <PersonAvatar person={me} className="size-10 text-sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui font-semibold">{me.name}</span>
            <span className="block truncate text-label text-muted-foreground">@{handleOf(me)}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Workspace: {workspace?.name}</div>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings /> Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/help">
              <CircleHelp /> Help
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/whats-new">
              <Sparkles /> What’s new
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={switchWorkspace}>
            <Repeat /> Switch workspace
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/account">
              <LogOut /> Sign out…
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  )
}

export function Sidebar() {
  const [teamsOpen, setTeamsOpen] = useState(false)
  const myTeams = useData(useShallow(myTeamKeys))
  const unread = useData((s) => s.inbox.filter((n) => isUnread(n, s.readState)).length)
  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r bg-sidebar md:w-[17.5rem]">
      <div className="flex h-16 items-center gap-3 pr-3 pl-5">
        <Link href="/" className="flex items-center gap-3 text-title font-semibold tracking-tight">
          <Logo />
          Sprawniej
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => openComposer()} className="ml-auto rounded-lg border p-2 text-sidebar-foreground/90 hover:bg-sidebar-accent" aria-label="New issue" data-tour="new-issue">
              <SquarePen className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            New issue <kbd className="ml-1 rounded border px-1">C</kbd>
          </TooltipContent>
        </Tooltip>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="mt-2 flex flex-col gap-0.5">
          <NavItem href="/inbox" icon={<Inbox />} count={unread}>
            Inbox
          </NavItem>
          <NavItem href="/my-issues" icon={<CircleUser />}>
            My issues
          </NavItem>
        </div>
        <NavGroup title="Workspace">
          <NavItem href="/projects" icon={<Box />}>
            Projects
          </NavItem>
          <NavItem href="/views" icon={<Layers />}>
            Views
          </NavItem>
          <Favourites />
        </NavGroup>
        <NavGroup
          title="Your teams"
          action={
            <button type="button" onClick={() => setTeamsOpen(true)} className="rounded-md p-1 hover:bg-sidebar-accent hover:text-foreground" aria-label="Join or create a team">
              <Plus className="size-4" />
            </button>
          }
        >
          {myTeams.map((key) => (
            <TeamGroup key={key} teamKey={key} />
          ))}
          {!myTeams.length && (
            <button type="button" onClick={() => setTeamsOpen(true)} className="mx-3 mt-1 rounded-lg border border-dashed px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground">
              You're not in a team yet. Join one to see its issues.
            </button>
          )}
        </NavGroup>
        <TeamsDialog open={teamsOpen} onOpenChange={setTeamsOpen} />
      </nav>
      <div className="border-t p-2">
        <Me />
      </div>
    </aside>
  )
}
