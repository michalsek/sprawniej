/** Settings › Archive: per team, how long finished issues stay in the lists before they're archived. */
import { Link } from 'wouter'
import { Archive } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { EmptyState } from '@/components/EmptyState'
import { setAutoArchive } from '@/data/actions'
import { useData } from '@/data/store'
import { AUTO_ARCHIVE_MONTHS } from '@/model/schema'
import { Button } from '@/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

const ARCHIVE_CHOICES = [1, 3, 6, 12, 0]

export function ArchivePage() {
  const teams = useData(useShallow((s) => Object.values(s.teams).sort((a, b) => a.name.localeCompare(b.name))))
  if (!teams.length) {
    return (
      <EmptyState
        icon={<Archive />}
        title="No teams yet"
        action={
          <Button asChild variant="outline">
            <Link href="/settings/workspace/teams">Go to Teams</Link>
          </Button>
        }
      >
        Each team picks when its finished issues are archived.
      </EmptyState>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {teams.map((t) => (
        <li key={t.key} className="flex items-center gap-3">
          <span className="w-5 text-center">{t.emoji}</span>
          <span className="min-w-0 flex-1 truncate text-[15px]">{t.name}</span>
          <Select value={String(t.autoArchive ?? AUTO_ARCHIVE_MONTHS)} onValueChange={(v) => setAutoArchive(t.key, Number(v))}>
            <SelectTrigger className="w-44" aria-label={`When ${t.name} archives finished issues`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARCHIVE_CHOICES.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m === 0 ? 'Never' : `After ${m} ${m === 1 ? 'month' : 'months'}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </li>
      ))}
    </ul>
  )
}
