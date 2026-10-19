/** A copy of Sprawniej built without the address of the place that keeps the work (docs/supabase-setup.md). */
import { Step } from '@/features/onboarding/Step'

export function NotSetUp() {
  return (
    <Step title="Sprawniej isn't set up yet">
      <p>
        This copy of Sprawniej doesn't know where to keep your team's work yet. Whoever looks after it can finish the setup and publish it again.
      </p>
    </Step>
  )
}
