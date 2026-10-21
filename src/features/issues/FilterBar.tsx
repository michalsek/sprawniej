/**
 * Filters for a list of issues: the Filter button, and the summary chip that reads the whole filter as a sentence
 * ("Status is In Progress or In Review and (Assignee is Me or Labels include Bug)"). Both open the builder
 * (FilterBuilder.tsx), where conditions are added, changed and grouped. src/data/filterTree.ts does the matching.
 */
import { Fragment, type ReactNode, type Ref } from 'react'
import { ListFilter, X } from 'lucide-react'
import { NEWER_FILTER, describeTree, isCondition, isGroup } from '@/data/filterTree'
import type { FilterField, FilterGroup, FilterValue } from '@/model/schema'
import { Button } from '@/ui/button'
import { itemFor, kindOf, sayCondition, upperFirst, useFilterItems, type FilterItems } from './filterKinds'

/** a condition's values, short: one shows its icon and name, several show their icons and "4 statuses" */
export function ValuesLabel({ field, values, items }: { field: FilterField; values: FilterValue[]; items: FilterItems }) {
  const kind = kindOf(field)
  if (!values.length) return <span className="text-muted-foreground">any…</span>
  const known = values.map((v) => itemFor(items[field], v)).filter((i) => !!i)
  if (values.length === 1) {
    if (!known.length) return <span className="text-muted-foreground">1 deleted {kind.one}</span>
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {known[0].icon}
        <span className="truncate">{known[0].label}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {known.length > 0 && (
        <span className="flex shrink-0 items-center -space-x-1" aria-hidden>
          {known.slice(0, 3).map((i, n) => (
            <Fragment key={n}>{i.icon}</Fragment>
          ))}
        </span>
      )}
      <span className="truncate">
        {values.length} {kind.many}
      </span>
    </span>
  )
}

export function FilterButton({ count, open, onClick, ref }: { count: number; open: boolean; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <Button
      ref={ref}
      variant="outline"
      className="h-10 gap-2 text-[15px]"
      aria-label={count ? `Filter, ${count} set` : 'Filter'}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-state={open ? 'open' : 'closed'}
      onClick={onClick}
    >
      <ListFilter /> <span className="hidden sm:inline">Filter</span>
      {count > 0 && <span className="-mr-1 rounded-md bg-accent px-1.5 text-xs leading-5 tabular-nums">{count}</span>}
    </Button>
  )
}

/** the filter as words and values, for the summary chip; `first`: it starts the sentence */
function Sentence({ tree, items, first }: { tree: FilterGroup; items: FilterItems; first?: boolean }) {
  return tree.items.map((n, k) => (
    <Fragment key={k}>
      {k > 0 && <span className="text-muted-foreground"> {tree.join} </span>}
      {isGroup(n) ? (
        <>
          <span className="text-muted-foreground">(</span>
          <Sentence tree={n} items={items} />
          <span className="text-muted-foreground">)</span>
        </>
      ) : isCondition(n) ? (
        <>
          <span className="text-muted-foreground">
            {kindOf(n.field).name} {n.op === 'not' ? kindOf(n.field).not : kindOf(n.field).is}{' '}
          </span>
          <span className="inline-flex max-w-56 items-center align-bottom [&_svg]:size-3.5">
            <ValuesLabel field={n.field} values={n.values} items={items} />
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">{first && k === 0 ? upperFirst(NEWER_FILTER) : NEWER_FILTER}</span>
      )}
    </Fragment>
  ))
}

interface SummaryProps {
  tree: FilterGroup
  onOpen: () => void
  onClear: () => void
  open: boolean
  ref?: Ref<HTMLButtonElement>
  /** at the right end of the band, e.g. "Save as view" */
  extra?: ReactNode
}

/** the whole filter as one chip: click it to change the filter, × to clear it */
export function FilterSummary({ tree, onOpen, onClear, open, ref, extra }: SummaryProps) {
  const items = useFilterItems()
  const words = upperFirst(describeTree(tree, (c) => sayCondition(c, items)))
  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 items-stretch rounded-lg border text-sm">
        <button
          ref={ref}
          type="button"
          onClick={onOpen}
          title={words}
          aria-label={`Filters: ${words}. Change`}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-state={open ? 'open' : 'closed'}
          className="min-w-0 rounded-l-lg px-2.5 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent/60"
        >
          <span className="line-clamp-2 break-words md:line-clamp-1">
            <Sentence tree={tree} items={items} first />
          </span>
        </button>
        <button
          type="button"
          onClick={onClear}
          className="flex shrink-0 items-center rounded-r-lg border-l px-2 text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Clear filters"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {extra && <span className="ml-auto shrink-0">{extra}</span>}
    </div>
  )
}
