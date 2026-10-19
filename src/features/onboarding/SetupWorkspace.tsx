/** An empty (or not-yet-Sprawniej) repository was opened: name the workspace and make the first team. */
import { useState } from 'react'
import { useLocation } from 'wouter'
import { startWorkspace } from '@/data/actions'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { TeamFields } from '@/features/teams/TeamFields'
import { teamDraftOk, type TeamDraft } from '@/model/teamDraft'
import { Step } from './Step'
import { takeWorkspaceName } from './setupDraft'

export function SetupWorkspace({ hasOtherFiles }: { hasOtherFiles: boolean }) {
  const [, navigate] = useLocation()
  const close = useSession((s) => s.close)
  const [name, setName] = useState(takeWorkspaceName)
  const [team, setTeam] = useState<TeamDraft>({ name: '', key: '', emoji: '🚀' })
  const ok = !!name.trim() && teamDraftOk(team)

  return (
    <Step
      title="Set up your workspace"
      footer={
        <>
          <Button
            size="lg"
            disabled={!ok}
            onClick={() => {
              startWorkspace(name, team)
              navigate(`/team/${team.key}/issues/active`, { replace: true })
            }}
          >
            Start
          </Button>
          <Button variant="ghost" onClick={close}>
            Choose another workspace
          </Button>
        </>
      }
    >
      {hasOtherFiles && (
        <p className="mb-5 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
          This repository already has other files. Sprawniej adds its own next to them and leaves the rest alone.
        </p>
      )}
      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="ws-name" className="mb-1.5 block text-sm font-medium">
            Workspace name
          </label>
          <Input id="ws-name" className="h-10" value={name} placeholder="Software Mansion" onChange={(e) => setName(e.target.value)} />
        </div>
        <p className="text-muted-foreground">Your first team. Teams keep their own issues, projects and views; you can add more later.</p>
        <TeamFields value={team} onChange={setTeam} />
      </div>
    </Step>
  )
}
