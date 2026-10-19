/** Small screens shared by the way in (src/app/Gate.tsx) and the invite flow (JoinFlow.tsx). */
import { Loader2 } from 'lucide-react'
import { useSignOut } from '@/components/SignOut'
import { Button } from '@/ui/button'
import { Problem, Step } from './Step'

/** a title and a spinner; `line`: how far it got, when there's something to say */
export function Waiting({ title, line }: { title: string; line?: string }) {
  return (
    <Step title={title}>
      <p className="flex items-center gap-2 text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-label="Loading" /> {line}
      </p>
    </Step>
  )
}

export function ProfileFailed({ problem, onRetry }: { problem: string; onRetry: () => void }) {
  const { signOut, dialog } = useSignOut()
  return (
    <Step
      title="We couldn't sign you in"
      footer={
        <>
          <Button size="lg" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="outline" size="lg" onClick={signOut}>
            Sign out
          </Button>
        </>
      }
    >
      {dialog}
      <Problem>{problem}</Problem>
    </Step>
  )
}
