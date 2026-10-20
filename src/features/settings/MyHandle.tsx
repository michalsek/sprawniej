/**
 * Your @handle (Settings › Your account): teammates see it and @mention you by it. It saves when you leave the field
 * or press Enter, not on every pause in typing, so a half-typed handle never goes out; Escape puts it back. Mentions
 * of your old handle become plain text, and someone else may take it.
 *
 * What you type is never lost: a change from elsewhere (your other tab, or your own save coming back) shows only while
 * you haven't changed the field, and leaving the field while a save is on its way saves again afterwards.
 */
import { useEffect, useRef, useState } from 'react'
import { HandleInput } from '@/components/HandleInput'
import { changeHandle } from '@/data/actions'
import { cleanHandle, HANDLE_WORDS, handleProblem } from '@/data/handles'
import { useData } from '@/data/store'
import { handleOf, type Person } from '@/model/schema'
import { useSession } from '@/session'

export function MyHandle() {
  const user = useSession((s) => s.user)
  const mine = useData((s) => (user ? s.people[user.login] : undefined))
  const me = mine ?? user
  return me ? <HandleField me={me} /> : null
}

function HandleField({ me }: { me: Person }) {
  const people = useData((s) => s.people)
  const current = handleOf(me)
  const [draft, setDraftState] = useState(current)
  const [saving, setSaving] = useState(false)
  /** what the last try to save said */
  const [refused, setRefused] = useState<string>()
  // the latest of each, for a save that finishes after more typing
  const latest = useRef({ draft, current })
  useEffect(() => {
    latest.current = { draft, current }
  }, [draft, current])
  const sending = useRef(false)
  const again = useRef(false)

  const setDraft = (v: string) => {
    latest.current.draft = v
    setDraftState(v)
  }

  // it changed elsewhere: show it, unless you've changed the field
  const [seen, setSeen] = useState(current)
  if (seen !== current) {
    setSeen(current)
    if (cleanHandle(draft) === seen && !saving) setDraftState(current)
  }

  const typed = cleanHandle(draft)
  const local = typed ? handleProblem(typed, me, people) : null
  const problem = refused ?? (local === 'invalid' ? HANDLE_WORDS.invalid : local === 'taken' ? HANDLE_WORDS.taken(typed) : undefined)

  async function commit() {
    if (sending.current) {
      again.current = true
      return
    }
    const sent = cleanHandle(latest.current.draft)
    // left empty: as it was
    if (!sent) {
      setDraft(latest.current.current)
      setRefused(undefined)
      return
    }
    sending.current = true
    setSaving(true)
    try {
      await changeHandle(sent)
      if (cleanHandle(latest.current.draft) === sent) setDraft(sent)
    } catch (e) {
      if (cleanHandle(latest.current.draft) === sent) setRefused(e instanceof Error ? e.message : "We couldn't change your handle. Try again in a moment.")
    } finally {
      sending.current = false
      setSaving(false)
      // you left the field again while it was saving, with something else in it
      if (again.current) {
        again.current = false
        if (cleanHandle(latest.current.draft) !== sent) void commit()
      }
    }
  }

  return (
    <div>
      <label htmlFor="my-handle-here" className="mb-1.5 block text-sm font-medium">
        Your handle
      </label>
      <HandleInput
        id="my-handle-here"
        className="max-w-sm"
        autoComplete="off"
        value={draft}
        aria-invalid={!!problem}
        aria-describedby="my-handle-here-note"
        onChange={(e) => {
          setRefused(undefined)
          setDraft(e.target.value)
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(current)
            setRefused(undefined)
          }
        }}
      />
      {problem ? (
        <p id="my-handle-here-note" role="alert" className="mt-1.5 text-sm text-destructive">
          {problem}
        </p>
      ) : (
        <p id="my-handle-here-note" className="mt-1.5 text-sm text-muted-foreground">
          {saving ? 'Saving…' : 'Teammates @mention you by it. If you change it, mentions of your old handle become plain text, and someone else may take it.'}
        </p>
      )}
    </div>
  )
}
