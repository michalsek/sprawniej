/** Settings › Labels: rename, recolour or delete labels, and add new ones. Changes apply to every issue at once. */
import { useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { ColorPicker } from '@/components/ColorPicker'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { InlineText } from '@/components/InlineText'
import { LabelDot } from '@/components/LabelChip'
import { PagedList } from '@/components/PagedList'
import { createLabel, deleteLabel, updateLabel } from '@/data/actions'
import { LABEL_COLORS } from '@/model/colors'
import { useData } from '@/data/store'
import type { Label } from '@/model/schema'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { fuzzy } from '@/lib/fuzzy'

function ColorButton({ label }: { label: Label }) {
  return (
    <ColorPicker
      value={label.color}
      colors={LABEL_COLORS}
      onPick={(color) => updateLabel(label.id, { color })}
      label={`Colour of ${label.name}`}
      swatch={(c, where) => <LabelDot color={c} className={where === 'button' ? 'size-3' : 'size-3.5'} />}
    />
  )
}

export function LabelsSettings() {
  const labels = useData(useShallow((s) => Object.values(s.labels).sort((a, b) => a.name.localeCompare(b.name))))
  const issues = useData((s) => s.issues)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<Label | null>(null)
  const [query, setQuery] = useState('')
  /** while you edit a label, the order stays as it was: a renamed label would jump to another page mid-word */
  const [frozen, setFrozen] = useState<string[] | null>(null)
  /** the label just added, so its page shows */
  const [added, setAdded] = useState<{ name: string; at: number } | null>(null)
  const uses = (id: string) => Object.values(issues).filter((i) => i.labels.includes(id)).length
  const taken = labels.some((l) => l.name.toLowerCase() === name.trim().toLowerCase())
  const ordered = frozen ? [...frozen.flatMap((id) => labels.filter((l) => l.id === id)), ...labels.filter((l) => !frozen.includes(l.id))] : labels
  const shown = fuzzy(ordered, query, (l) => [l.name])
  const addedAt = added ? shown.findIndex((l) => l.name === added.name) : -1

  return (
    <div className="flex flex-col gap-1">
      {labels.length === 0 && <p className="pb-2 text-ui text-muted-foreground">No labels yet. Labels like “Bug” or “Design” help you sort and filter issues.</p>}
      {labels.length > 10 && (
        <div className="relative mb-2 max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="Search labels…"
            aria-label="Search labels"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setAdded(null)
            }}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
        </div>
      )}
      {query.trim() && !shown.length && <p className="pb-2 text-ui text-muted-foreground">No label matches “{query.trim()}”.</p>}
      <PagedList
        key={query.trim()}
        items={shown}
        noun="labels"
        show={added && { index: addedAt, at: added.at }}
        className="flex flex-col gap-1"
        row={(l) => {
          const n = uses(l.id)
          return (
            <li
              key={l.id}
              className="group flex h-11 items-center gap-2 rounded-md px-1 hover:bg-accent/40"
              onFocus={() => setFrozen((f) => f ?? labels.map((x) => x.id))}
              onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFrozen(null)}
            >
              <ColorButton label={l} />
              <InlineText
                value={l.name}
                onSave={(v) => updateLabel(l.id, { name: v })}
                allowed={(v) => !labels.some((o) => o.id !== l.id && o.name.toLowerCase() === v.toLowerCase())}
                label={`Name of ${l.name}`}
                required
                className="h-8 text-ui"
              />
              <span className="w-24 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{n === 1 ? '1 issue' : `${n} issues`}</span>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete ${l.name}`} onClick={() => setDeleting(l)}>
                <Trash2 />
              </Button>
            </li>
          )
        }}
      />
      <form
        className="mt-3 flex max-w-sm gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim() || taken) return
          createLabel(name)
          setAdded({ name: name.trim(), at: Date.now() })
          setQuery('')
          setName('')
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New label name" aria-label="New label name" className="h-9" />
        <Button type="submit" variant="outline" disabled={!name.trim() || taken}>
          <Plus /> Add
        </Button>
      </form>
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete the label “${deleting.name}”?`}
          confirm="Delete label"
          onConfirm={() => deleteLabel(deleting.id)}
        >
          {uses(deleting.id) ? `It comes off ${uses(deleting.id) === 1 ? 'the 1 issue' : `all ${uses(deleting.id)} issues`} that have it. The issues stay.` : 'No issue uses it.'}
        </ConfirmDialog>
      )}
    </div>
  )
}
