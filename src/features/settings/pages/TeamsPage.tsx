/**
 * Settings › Teams: every team in the workspace. Join one you're not in; in yours, ⋯ edits, leaves or deletes it
 * (TeamMenu, as in the sidebar). Creating a team opens the same dialog as + next to Your teams.
 */
import { useState } from 'react'
import { Link } from 'wouter'
import { Plus, SquareStack } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { EmptyState } from '@/components/EmptyState'
import { joinTeam } from '@/data/actions'
import { useData } from '@/data/store'
import { TeamMenu } from '@/features/teams/TeamMenu'
import { TeamsDialog } from '@/features/teams/TeamsDialog'
import { Button } from '@/ui/button'

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

export function TeamsPage() {
  const teams = useData(useShallow((s) => Object.values(s.teams).sort((a, b) => a.name.localeCompare(b.name))))
  const me = useData((s) => s.me?.login)
  const [creating, setCreating] = useState(false)

  const create = (
    <Button variant="outline" onClick={() => setCreating(true)}>
      <Plus /> Create a team
    </Button>
  )

  return (
    <>
      {teams.length ? (
        <>
          <div className="mb-3">{create}</div>
          <ul className="flex flex-col gap-1">
            {teams.map((t) => {
              const mine = !!me && t.members.includes(me)
              return (
                <li key={t.key} className="flex flex-wrap items-center gap-3 py-1.5" data-team={t.key}>
                  <span className="w-8 text-center text-emoji">{t.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/team/${t.key}/issues/active`} className="block truncate font-medium hover:underline">
                      {t.name}
                    </Link>
                    <span className="block truncate text-sm text-muted-foreground">
                      {t.key} · {people(t.members.length)}
                      {mine && ' · You’re in it'}
                    </span>
                  </span>
                  {mine ? (
                    <TeamMenu teamKey={t.key} />
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => joinTeam(t.key)}>
                      Join
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <EmptyState icon={<SquareStack />} title="No teams yet" action={create}>
          Make one for each group of people who work together.
        </EmptyState>
      )}
      <TeamsDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
