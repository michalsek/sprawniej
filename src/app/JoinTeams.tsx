/**
 * Someone in no team, in a workspace that has teams, sees almost nothing: this asks which teams they work with.
 * It waits for the first update from teammates (so the teams are current) and stays away while you're in Settings;
 * "Skip for now" keeps it away in this browser; + next to Your teams does the same any time.
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { useShallow } from 'zustand/react/shallow'
import { joinTeam } from '@/data/actions'
import { useData } from '@/data/store'
import { useSaveStatus } from '@/backend/status'
import { isSettingsPath } from '@/features/settings/nav'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { skipJoining, skippedJoining, useJoinTeams } from './joinTeamsState'

export function JoinTeams() {
  const [location, navigate] = useLocation()
  const where = useSession((s) => s.workspaceId ?? '')
  const me = useData((s) => s.me?.login)
  const teams = useData(useShallow((s) => Object.values(s.teams).sort((a, b) => a.name.localeCompare(b.name))))
  const synced = useSaveStatus((s) => !!s.synced)
  const inNone = !!me && teams.length > 0 && !teams.some((t) => t.members.includes(me))
  const [skipped, setSkipped] = useState(false)
  const open = synced && inNone && !!where && !skipped && !isSettingsPath(location) && !skippedJoining(where, me!)
  // nothing ticked yet: with one team there's nothing to choose, so it starts ticked
  const [chosen, setPicked] = useState<string[] | null>(null)
  const picked = chosen ?? (teams.length === 1 ? [teams[0].key] : [])

  useEffect(() => {
    useJoinTeams.setState({ open })
  }, [open])

  const skip = () => {
    skipJoining(where, me!)
    setSkipped(true)
  }
  const join = () => {
    for (const key of picked) joinTeam(key)
    const first = teams.find((t) => picked.includes(t.key))
    if (first) navigate(`/team/${first.key}/issues/active`)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && skip()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Join your teams</DialogTitle>
        <DialogDescription>
          Each team has its own issues, projects and views. Pick the ones you work with and they'll show up in the sidebar. You can change this any time
          with + next to Your teams.
        </DialogDescription>
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {teams.map((t) => {
            const on = picked.includes(t.key)
            const id = `join-${t.key}`
            return (
              <li key={t.key}>
                <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-accent/60 has-[:checked]:border-foreground/30">
                  <input
                    id={id}
                    type="checkbox"
                    className="size-4 accent-foreground"
                    checked={on}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, t.key] : picked.filter((k) => k !== t.key))}
                  />
                  <span className="text-emoji leading-none">{t.emoji}</span>
                  <span className="flex-1 font-medium">{t.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {t.members.length} {t.members.length === 1 ? 'member' : 'members'}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={skip}>
            Skip for now
          </Button>
          <Button disabled={!picked.length} onClick={join}>
            {picked.length > 1 ? `Join ${picked.length} teams` : 'Join'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
