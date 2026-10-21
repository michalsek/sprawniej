/**
 * What a list of issues shows when it has nothing to show: the quick filters leave nothing, your filters leave
 * nothing, or the page has no issues yet (its own message, or a general one).
 */
import type { ReactNode } from 'react'
import { Plus, SearchX, SquareStack } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/ui/button'
import { openComposer } from './composer'

export type EmptyKind = 'quick' | 'filters' | 'page'

export function IssuesEmpty({ kind, onClearQuick, onClear, empty }: { kind: EmptyKind; onClearQuick: () => void; onClear: () => void; empty?: ReactNode }) {
  if (kind === 'quick') {
    return (
      <EmptyState
        icon={<SearchX />}
        title="No issues match these filters"
        action={
          <Button variant="outline" onClick={onClearQuick}>
            Clear quick filters
          </Button>
        }
      >
        Pick something else in the side panel, or pick less.
      </EmptyState>
    )
  }
  if (kind === 'filters') {
    return (
      <EmptyState
        icon={<SearchX />}
        title="No issues match these filters"
        action={
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        }
      >
        Try fewer filters, or switch a group to “or”.
      </EmptyState>
    )
  }
  return (
    empty ?? (
      <EmptyState
        icon={<SquareStack />}
        title="No issues here yet"
        action={
          <Button variant="outline" onClick={() => openComposer()}>
            <Plus /> New issue
          </Button>
        }
      >
        Issues that fit this page show up here by themselves.
      </EmptyState>
    )
  )
}
