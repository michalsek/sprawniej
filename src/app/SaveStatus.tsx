/** The small save chip in the top bar. Everyday words only: never commit, push or merge (CLAUDE.md, writing). */
import { CloudAlert, CloudCheck, CloudOff, Loader2, LogIn } from 'lucide-react'
import { useSaveStatus } from '@/backend/status'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

export function SaveStatus() {
  const { state, detail } = useSaveStatus()
  const view = {
    loading: { icon: <Loader2 className="size-4 animate-spin" />, label: 'Loading…', tip: 'Getting the latest from your team.' },
    saving: {
      icon: <Loader2 className="size-4 animate-spin" />,
      label: 'Saving…',
      tip: `Your changes are safe on this device and on their way to your team.${detail ? ` ${detail}` : ''}`,
    },
    saved: { icon: <CloudCheck className="size-4" />, label: 'Saved', tip: 'Everything is saved, and your team can see it.' },
    offline: {
      icon: <CloudOff className="size-4" />,
      label: 'Offline',
      tip: 'You’re offline. Your teammates’ changes will show up again once you’re back online.',
    },
    error: { icon: <CloudAlert className="size-4 text-urgent" />, label: 'Not saved yet', tip: `We can’t reach Sprawniej right now. We’ll keep trying.${detail ? ` ${detail}` : ''}` },
    'signed-out': { icon: <LogIn className="size-4 text-urgent" />, label: 'Signed out', tip: 'You were signed out. Sign in again to keep working.' },
  }[state]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status" aria-live="polite" data-state={state} data-tour="saved">
          {view.icon}
          <span className="hidden sm:inline">{view.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{view.tip}</TooltipContent>
    </Tooltip>
  )
}
