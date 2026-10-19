/** Settings › Import from Linear is for admins and owners; everyone else is told so instead. */
import { Link } from 'wouter'
import { Download } from 'lucide-react'
import { useCrumbs } from '@/app/chrome'
import { EmptyState } from '@/components/EmptyState'
import { isAdmin } from '@/data/select'
import { useData } from '@/data/store'
import { ImportPage } from '@/features/import/ImportPage'
import { Button } from '@/ui/button'

function MembersCantImport() {
  useCrumbs([{ label: 'Settings', href: '/settings' }, { label: 'Import from Linear' }])
  return (
    <EmptyState
      icon={<Download />}
      title="Only admins and owners can import"
      action={
        <Button asChild variant="outline">
          <Link href="/settings">Back to Settings</Link>
        </Button>
      }
    >
      Ask one of them to bring your team's work over from Linear.
    </EmptyState>
  )
}

export function ImportGate() {
  const admin = useData(isAdmin)
  return admin ? <ImportPage /> : <MembersCantImport />
}
