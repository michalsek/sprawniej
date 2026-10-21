import { useParams } from 'wouter'
import { Plus, SquareStack } from 'lucide-react'
import { Button } from '@/ui/button'
import { openComposer } from '@/features/issues/composer'
import { useCrumbs } from '@/app/chrome'
import { EmptyState } from '@/components/EmptyState'
import { LinkTabs } from '@/components/Tabs'
import { IssuesView } from '@/features/issues/IssuesView'
import { TeamDetails } from '@/features/issues/PageDetails'
import { ArchiveList } from './ArchiveList'
import { NotFound } from '@/app/NotFound'
import { useData } from '@/data/store'
import type { IssueTab } from '@/model/status'

const TABS: { tab: IssueTab; label: string }[] = [
  { tab: 'active', label: 'Active' },
  { tab: 'backlog', label: 'Backlog' },
  { tab: 'all', label: 'All issues' },
]

export function TeamIssuesPage() {
  const { key = '', tab = 'active' } = useParams<{ key: string; tab?: string }>()
  const team = useData((s) => s.teams[key])
  const current = (TABS.find((t) => t.tab === tab)?.tab ?? 'active') as IssueTab
  useCrumbs(team ? [{ label: `${team.emoji} ${team.name}` }, { label: 'Issues' }] : [])
  if (!team) return <NotFound />
  const base = `/team/${team.key}/issues`
  const tabs = [...TABS.map((t) => ({ href: `${base}/${t.tab}`, label: t.label })), { href: `${base}/archived`, label: 'Archived' }]
  if (tab === 'archived') return <ArchiveList team={team.key} left={<LinkTabs current={`${base}/archived`} tabs={tabs} />} />
  return (
    <IssuesView
      page={`team:${team.key}:${current}`}
      filters={{ teams: [team.key] }}
      hideFilters={['teams']}
      viewScope={team.key}
      tab={current}
      baseDisplay={{ showCompleted: current === 'all' }}
      left={<LinkTabs current={`${base}/${current}`} tabs={tabs} />}
      details={<TeamDetails team={team} />}
      empty={
        <EmptyState
          icon={<SquareStack />}
          title={current === 'backlog' ? 'The backlog is empty' : 'No issues here yet'}
          action={
            <Button variant="outline" onClick={() => openComposer({ team: team.key, status: current === 'backlog' ? 'backlog' : 'todo' })}>
              <Plus /> New issue <kbd className="ml-1 rounded border px-1 text-xs">C</kbd>
            </Button>
          }
        >
          Issues are tasks, bugs or ideas your team wants to work on.
        </EmptyState>
      }
    />
  )
}
