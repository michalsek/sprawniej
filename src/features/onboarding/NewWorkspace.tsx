/** Create a workspace: its name and its first team. You are its owner. */
import { useState, type SubmitEvent } from 'react'
import { useLocation } from 'wouter'
import { Loader2 } from 'lucide-react'
import { friendlyDbError } from '@/backend/problem'
import { startWorkspace } from '@/data/actions'
import { TeamFields } from '@/features/teams/TeamFields'
import { teamDraftOk, type TeamDraft } from '@/model/teamDraft'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Problem, Step } from './Step'

export function NewWorkspace({ onBack }: { onBack: () => void }) {
  const [, navigate] = useLocation()
  const open = useSession((s) => s.open)
  const [name, setName] = useState('')
  const [team, setTeam] = useState<TeamDraft>({ name: '', key: '', emoji: '🚀' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const ok = !!name.trim() && teamDraftOk(team)

  async function create(e?: SubmitEvent<HTMLFormElement>) {
    e?.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    setProblem(undefined)
    try {
      const id = await startWorkspace(name, team)
      open({ id, name: name.trim() })
      navigate(`/team/${team.key}/issues/active`, { replace: true })
    } catch (err) {
      setProblem(friendlyDbError(err, "We couldn't create the workspace. Try again in a moment."))
      setBusy(false)
    }
  }

  return (
    <Step
      title="Create a workspace"
      footer={
        <>
          <Button size="lg" disabled={!ok || busy} onClick={() => void create()}>
            {busy && <Loader2 className="animate-spin" />} Create workspace
          </Button>
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => void create(e)}>
        <div>
          <label htmlFor="ws-name" className="mb-1.5 block text-sm font-medium">
            Workspace name
          </label>
          <Input id="ws-name" className="h-10" autoFocus placeholder="Software Mansion" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <p className="text-muted-foreground">Your first team. Teams keep their own issues, projects and views; you can add more later.</p>
        <TeamFields value={team} onChange={setTeam} />
        <Problem>{problem}</Problem>
        <button type="submit" hidden />
      </form>
    </Step>
  )
}
