/** The user guide (docs/user-guide.md), shown inside the app so teammates find it where they work. */
import { Markdown } from '@/components/Markdown'
import guide from '../../../docs/user-guide.md?raw'
import { useLocation } from 'wouter'
import { useCrumbs } from '@/app/chrome'
import { replayTour } from '@/app/tourState'
import { Button } from '@/ui/button'

export function HelpPage() {
  useCrumbs([{ label: 'Help' }])
  const [, navigate] = useLocation()
  return (
    <div className="flex-1 overflow-y-auto px-4 py-10 md:px-8">
      <div className="mx-auto max-w-2xl">
        <Button
          variant="outline"
          className="float-right"
          onClick={() => {
            navigate('/')
            replayTour()
          }}
        >
          Show the tour again
        </Button>
        <div className="prose-sprawniej">
          <Markdown>{guide}</Markdown>
        </div>
      </div>
    </div>
  )
}
