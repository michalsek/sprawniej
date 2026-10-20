/**
 * Your @handle (Settings › Your account): teammates see it and @mention you by it. It saves when you leave the field
 * or press Enter, not on every pause in typing, so a half-typed handle never goes out; Escape puts it back. Mentions
 * of your old handle become plain text, and someone else may take it.
 */
import { useState } from 'react'
import { changeHandle } from '@/data/actions'
import { cleanHandle, HANDLE_WORDS, handleProblem } from '@/data/handles'
import { useData } from '@/data/store'
import { handleOf, type Person } from '@/model/schema'
import { useSession } from '@/session'

export function MyHandle() {
  const user = useSession((s) => s.user)
  const mine = useData((s) => (user ? s.people[user.login] : undefined))
  const me = mine ?? user
  // starts again when it changes elsewhere (another tab)
  return me ? <HandleField key={handleOf(me)} me={me} /> : null
}

function HandleField({ me }: { me: Person }) {
  const people = useData((s) => s.people)
  const [draft, setDraft] = useState(handleOf(me))
  const [saving, setSaving] = useState(false)
  /** what the last try to save said */
  const [refused, setRefused] = useState<string>()
  const typed = cleanHandle(draft)
  const local = typed ? handleProblem(typed, me, people) : null
  const problem = refused ?? (local === 'invalid' ? HANDLE_WORDS.invalid : local === 'taken' ? HANDLE_WORDS.taken(typed) : undefined)

  async function commit() {
    if (saving) return
    // left empty, or nothing changed: as it was
    if (!typed || local === 'same') {
      setDraft(handleOf(me))
      setRefused(undefined)
      return
    }
    if (local) return
    setSaving(true)
    try {
      await changeHandle(typed)
      setDraft(typed)
    } catch (e) {
      setRefused(e instanceof Error ? e.message : "We couldn't change your handle. Try again in a moment.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <label htmlFor="my-handle-here" className="mb-1.5 block text-sm font-medium">
        Your handle
      </label>
      <div className="flex h-10 max-w-sm overflow-hidden rounded-md border bg-input/30 text-[15px] focus-within:ring-2 focus-within:ring-ring/50">
        <span className="flex items-center border-r bg-muted px-3 text-muted-foreground select-none">@</span>
        <input
          id="my-handle-here"
          className="min-w-0 flex-1 bg-transparent px-3 outline-none"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          aria-invalid={!!problem}
          onChange={(e) => {
            setRefused(undefined)
            setDraft(e.target.value)
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setDraft(handleOf(me))
              setRefused(undefined)
            }
          }}
        />
      </div>
      {problem ? (
        <p role="alert" className="mt-1.5 text-sm text-destructive">
          {problem}
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {saving ? 'Saving…' : 'Teammates @mention you by it. If you change it, mentions of your old handle become plain text, and someone else may take it.'}
        </p>
      )}
    </div>
  )
}
