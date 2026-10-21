/** "+" next to Your teams: join a team that exists, or make a new one. */
import { useState } from 'react'
import { useLocation } from 'wouter'
import { useShallow } from 'zustand/react/shallow'
import { createTeam, joinTeam } from '@/data/actions'
import { useData } from '@/data/store'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { TeamFields } from './TeamFields'
import { teamDraftOk, type TeamDraft } from '@/model/teamDraft'

export function TeamsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [, navigate] = useLocation()
  const others = useData(useShallow((s) => Object.values(s.teams).filter((t) => s.me && !t.members.includes(s.me.login))))
  const keys = useData(useShallow((s) => Object.keys(s.teams)))
  const [draft, setDraft] = useState<TeamDraft>({ name: '', key: '', emoji: '🚀' })
  const done = (key: string) => {
    onOpenChange(false)
    setDraft({ name: '', key: '', emoji: '🚀' })
    navigate(`/team/${key}/issues/active`)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Teams</DialogTitle>
        <DialogDescription>Each team has its own issues, projects and views. Join the ones you work with.</DialogDescription>
        {others.length > 0 && (
          <ul className="flex flex-col gap-1">
            {others.map((t) => (
              <li key={t.key} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <span className="text-emoji">{t.emoji}</span>
                <span className="flex-1 font-medium">{t.name}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    joinTeam(t.key)
                    done(t.key)
                  }}
                >
                  Join
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-2 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!teamDraftOk(draft, keys)) return
            createTeam(draft)
            done(draft.key)
          }}
        >
          <h3 className="font-medium">Create a team</h3>
          <TeamFields value={draft} onChange={setDraft} takenKeys={keys} />
          <DialogFooter>
            <Button type="submit" disabled={!teamDraftOk(draft, keys)}>
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
