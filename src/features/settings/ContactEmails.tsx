/**
 * Your contact emails (Settings › Profile): a few emails teammates may write to, and the one they see next to your
 * name in Settings › Members (or none). Signing in doesn't change. Every change saves by itself: an email saves when
 * you leave its field or press Enter, and Escape puts the saved text back.
 *
 * One thing at a time: while a change is on its way, the buttons and the choice wait (they stay focusable, so the
 * keyboard keeps its place), and an email you leave saves once it's done. What you type is never lost: a refused or
 * failed change keeps it, with the problem under it until you change that field again, put it back, save it or
 * remove it. Each email has its own note, and the part has one for adding and the choice, so several can show.
 */
import { useLayoutEffect, useRef, useState, type MouseEvent, type SubmitEvent } from 'react'
import { Loader2, Mail, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/backend/auth'
import { EmptyState } from '@/components/EmptyState'
import { addContactEmail, changeContactEmail, removeContactEmail, showContactEmail } from '@/data/actions'
import { contactEmailOf } from '@/data/select'
import { useData } from '@/data/store'
import { Problem } from '@/features/onboarding/Step'
import { changeProblem, emailProblem, MAX_CONTACT_EMAILS, signInEmailToOffer, type ContactEmail } from '@/model/contactEmail'
import { useSession } from '@/session'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { useContactEmails } from './useContactEmails'

/** the "Teammates see" choice for none (an email's id otherwise) */
const NONE = 'none'
const NEW_FIELD_ID = 'contact-email-new'
const fieldId = (id: string) => `contact-email-${id}`
const PART_PROBLEM_ID = 'contact-email-problem'
/** waiting controls look it, but keep their place for the keyboard */
const WAITS = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

const said = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

/** what is on its way: adding, the sign-in email, the choice, or one email being changed or removed */
type Busy = 'add' | 'sign-in' | 'show' | `change:${string}` | `remove:${string}`

export function ContactEmails() {
  const login = useSession((s) => s.user?.login)
  const shown = useData((s) => (login ? contactEmailOf(s, login) : undefined))
  const signIn = useAuth((s) => s.user?.email)
  const { emails, state, reload, patch } = useContactEmails(shown)
  const [busy, setBusy] = useState<Busy | null>(null)
  // what is on its way, for code that runs between renders (a blur right after another action started), and when
  // it's done, so an email you leave can wait for it
  const running = useRef<{ what: Busy; done: Promise<void> } | null>(null)
  // the list as it is now, for a save that waited: set at once by `apply`, and after a reload
  const emailsNow = useRef(emails)
  useLayoutEffect(() => {
    emailsNow.current = emails
  }, [emails])
  const apply = (fn: (list: ContactEmail[]) => ContactEmail[]) => {
    emailsNow.current = fn(emailsNow.current)
    patch(fn)
  }
  /** a problem with the whole part: adding (typed or the sign-in email) or the choice */
  const [partProblem, setPartProblem] = useState<{ from: 'add' | 'sign-in' | 'show'; text: string }>()
  /** each email's own problem, cleared only through that email */
  const [rowProblems, setRowProblems] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')

  const offer = signInEmailToOffer(signIn, emails)
  const picked = emails.find((e) => e.visible)

  /** marks `what` as on its way; returns what to call when it's done */
  const start = (what: Busy) => {
    let finish = () => {}
    running.current = { what, done: new Promise<void>((resolve) => (finish = resolve)) }
    setBusy(what)
    return () => {
      running.current = null
      setBusy(null)
      finish()
    }
  }
  /** an email's problem; none clears it */
  const setRowProblem = (id: string, text?: string) =>
    setRowProblems((all) => {
      const { [id]: _, ...rest } = all
      return text ? { ...rest, [id]: text } : rest
    })

  /** a later change went through, so a problem from the choice or the sign-in email is old news (one about what you typed stays) */
  const clearOldPartProblem = () => setPartProblem((p) => (p?.from === 'add' ? p : undefined))

  async function add(typed: string, from: 'add' | 'sign-in') {
    if (running.current) return
    const email = typed.trim()
    // refused here: nothing was sent, so the list stays as it is
    const why = emailProblem(email, emails)
    if (why) return setPartProblem({ from, text: why })
    const done = start(from)
    setPartProblem(undefined)
    try {
      const id = await addContactEmail(email, emails)
      apply((list) => [...list, { id, email, visible: false, createdAt: new Date().toISOString() }])
      if (from === 'add') setDraft('')
      toast('Email added. Pick it under Teammates see to show it.')
    } catch (e) {
      // what you typed stays, so you can fix it
      setPartProblem({ from, text: said(e, "We couldn't add the email. Try again in a moment.") })
    } finally {
      done()
      reload()
    }
  }

  async function show(value: string) {
    const id = value === NONE ? null : value
    if (running.current || id === (picked?.id ?? null)) return
    const done = start('show')
    setPartProblem(undefined)
    try {
      await showContactEmail(id)
      apply((list) => list.map((e) => ({ ...e, visible: e.id === id })))
      const email = emails.find((e) => e.id === id)?.email
      toast(email ? `Teammates now see ${email}.` : "Teammates don't see an email now.")
    } catch (e) {
      setPartProblem({ from: 'show', text: said(e, "We couldn't change which email teammates see. Try again in a moment.") })
    } finally {
      done()
      reload()
    }
  }

  /**
   * True when it saved; otherwise the problem shows under the email and what was typed stays. Waits for anything
   * already on its way first (you left the field while another change was being made).
   */
  async function change(e: ContactEmail, typed: string): Promise<boolean> {
    while (running.current) await running.current.done
    const list = emailsNow.current
    // removed while it waited
    if (!list.some((x) => x.id === e.id)) return false
    const text = typed.trim()
    const why = changeProblem(e.id, text, list)
    if (why) {
      setRowProblem(e.id, why)
      return false
    }
    const done = start(`change:${e.id}`)
    setRowProblem(e.id)
    try {
      await changeContactEmail(e.id, text, list)
      apply((list) => list.map((x) => (x.id === e.id ? { ...x, email: text } : x)))
      if (e.visible) toast(`Teammates now see ${text}.`)
      clearOldPartProblem()
      return true
    } catch (err) {
      setRowProblem(e.id, said(err, "We couldn't change the email. Try again in a moment."))
      return false
    } finally {
      done()
      reload()
    }
  }

  async function remove(e: ContactEmail, withKeyboard: boolean) {
    if (running.current) return
    const done = start(`remove:${e.id}`)
    try {
      await removeContactEmail(e.id, emails)
      // pressed with the keyboard: on to the next email's field, the one before, or the add field
      if (withKeyboard) {
        const at = emails.findIndex((x) => x.id === e.id)
        const next = emails[at + 1] ?? emails[at - 1]
        document.getElementById(next ? fieldId(next.id) : NEW_FIELD_ID)?.focus()
      }
      apply((list) => list.filter((x) => x.id !== e.id))
      setRowProblem(e.id)
      clearOldPartProblem()
      toast(e.visible ? `${e.email} removed. Teammates don't see an email now.` : `${e.email} removed.`)
    } catch (err) {
      setRowProblem(e.id, said(err, "We couldn't remove the email. Try again in a moment."))
    } finally {
      done()
      reload()
    }
  }

  const submit = (ev: SubmitEvent<HTMLFormElement>) => {
    ev.preventDefault()
    if (draft.trim()) void add(draft, 'add')
  }

  return (
    <section aria-labelledby="contact-email-title" className="max-w-xl">
      <h2 id="contact-email-title" className="text-sm font-medium">
        Contact email
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Teammates see the email you pick next to your name in the members list. It doesn't change how you sign in. Sprawniej doesn't check these
        addresses or send anything to them.
      </p>

      {state === 'loading' && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {state === 'failed' && (
        <>
          <Problem>We couldn't load your contact emails.</Problem>
          <Button variant="outline" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </>
      )}

      {state === 'ready' && (
        <div className="mt-4 flex flex-col gap-4">
          {emails.length > 0 && (
            <div>
              <label htmlFor="teammates-see" className="mb-1.5 block text-sm font-medium">
                Teammates see
              </label>
              {/* waits like the buttons (show() refuses while busy, and the choice snaps back), keeping its focus */}
              <Select value={picked?.id ?? NONE} onValueChange={(v) => void show(v)}>
                <SelectTrigger id="teammates-see" className={`h-10 w-full max-w-sm ${WAITS}`} aria-disabled={!!busy || undefined}>
                  {busy === 'show' && <Loader2 className="animate-spin" />}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Don't show an email</SelectItem>
                  {emails.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {emails.length === 0 ? (
            <EmptyState
              compact
              icon={<Mail />}
              title="No contact emails yet"
              action={
                offer ? (
                  <Button variant="outline" className={`mt-1 max-w-full ${WAITS}`} aria-disabled={!!busy || undefined} onClick={() => void add(offer, 'sign-in')}>
                    {busy === 'sign-in' ? <Loader2 className="animate-spin" /> : <Plus />}
                    <span className="min-w-0 truncate">Add my sign-in email ({offer})</span>
                  </Button>
                ) : (
                  <Button variant="outline" className="mt-1" onClick={() => document.getElementById(NEW_FIELD_ID)?.focus()}>
                    <Plus /> Add an email
                  </Button>
                )
              }
            >
              Add one so teammates know where to write to you.
            </EmptyState>
          ) : (
            <div>
              <span id="your-emails" className="mb-1.5 block text-sm font-medium">
                Your emails
              </span>
              <ul aria-labelledby="your-emails" className="flex flex-col gap-2">
                {emails.map((e) => (
                  <EmailRow
                    key={e.id}
                    email={e}
                    removing={busy === `remove:${e.id}`}
                    waiting={!!busy}
                    problem={rowProblems[e.id]}
                    onTyping={() => setRowProblem(e.id)}
                    onChange={(text) => change(e, text)}
                    onRemove={(withKeyboard) => void remove(e, withKeyboard)}
                  />
                ))}
              </ul>
            </div>
          )}

          {emails.length < MAX_CONTACT_EMAILS ? (
            <form className="flex max-w-sm gap-2" noValidate onSubmit={submit}>
              <Input
                id={NEW_FIELD_ID}
                type="email"
                autoComplete="email"
                aria-label="A new contact email"
                className="h-10 min-w-0 flex-1"
                placeholder="name@example.com"
                value={draft}
                aria-invalid={partProblem?.from === 'add'}
                aria-describedby={partProblem?.from === 'add' ? PART_PROBLEM_ID : undefined}
                onChange={(ev) => {
                  setDraft(ev.target.value)
                  setPartProblem((p) => (p?.from === 'add' ? undefined : p))
                }}
              />
              <Button type="submit" variant="outline" size="lg" className={`px-4 ${WAITS}`} aria-disabled={!draft.trim() || !!busy || undefined}>
                {busy === 'add' ? <Loader2 className="animate-spin" /> : <Plus />} Add
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">You can keep up to {MAX_CONTACT_EMAILS} emails. Remove one to add another.</p>
          )}

          {emails.length > 0 && offer && (
            <Button
              variant="link"
              size="sm"
              className={`h-auto max-w-full self-start px-0 text-muted-foreground hover:text-foreground ${WAITS}`}
              aria-disabled={!!busy || undefined}
              onClick={() => void add(offer, 'sign-in')}
            >
              {busy === 'sign-in' && <Loader2 className="animate-spin" />}
              <span className="min-w-0 truncate">Add my sign-in email ({offer})</span>
            </Button>
          )}
          <Problem id={PART_PROBLEM_ID}>{partProblem?.text}</Problem>
        </div>
      )}
    </section>
  )
}

/**
 * One email: change it in place (it saves when you leave the field or press Enter), or remove it. A newer saved text
 * (your other tab) shows only while you haven't changed the field and it isn't saving. "Saving…" shows from the
 * moment you leave the field, also while it waits its turn.
 */
function EmailRow({
  email,
  removing,
  waiting,
  problem,
  onTyping,
  onChange,
  onRemove,
}: {
  email: ContactEmail
  removing: boolean
  /** something is on its way (this one or another): the field and Remove wait */
  waiting: boolean
  problem?: string
  onTyping: () => void
  /** true when it saved */
  onChange: (text: string) => Promise<boolean>
  onRemove: (withKeyboard: boolean) => void
}) {
  const [draft, setDraft] = useState(email.email)
  const note = `${fieldId(email.id)}-note`
  // left with a change: it saves once anything already on its way is done
  const [sending, setSending] = useState(false)

  // it changed elsewhere: show it, unless you've changed the field
  const [seen, setSeen] = useState(email.email)
  if (seen !== email.email) {
    setSeen(email.email)
    if (draft.trim() === seen && !sending) setDraft(email.email)
  }

  async function commit() {
    const text = draft.trim()
    // left empty: as it was; the same text: nothing to save (onChange waits for anything already on its way)
    if (!text) return setDraft(email.email)
    if (text === email.email) return
    setSending(true)
    try {
      if (await onChange(text)) setDraft(text)
    } finally {
      setSending(false)
    }
  }

  const press = (e: MouseEvent<HTMLButtonElement>) => {
    // a mouse press doesn't take focus (below), so a focused button was pressed with the keyboard
    if (!waiting) onRemove(document.activeElement === e.currentTarget)
  }

  return (
    <li>
      <div className="flex items-center gap-2">
        <Input
          id={fieldId(email.id)}
          type="email"
          aria-label={`Contact email ${email.email}`}
          className="h-10 min-w-0 flex-1"
          value={draft}
          readOnly={waiting}
          aria-invalid={!!problem}
          aria-describedby={problem ? note : undefined}
          onChange={(e) => {
            setDraft(e.target.value)
            onTyping()
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(email.email)
              onTyping()
            }
          }}
        />
        <Button
          variant="ghost"
          size="lg"
          className={`px-3 ${WAITS}`}
          aria-label={`Remove ${email.email}`}
          // stays focusable while something is on its way, so Tab doesn't lose its place
          aria-disabled={waiting || undefined}
          // a press here doesn't leave the field first, so an unsaved change isn't sent along with the removal
          onMouseDown={(e) => e.preventDefault()}
          onClick={press}
        >
          {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}
          <span className="hidden sm:inline">Remove</span>
        </Button>
      </div>
      {problem ? (
        <p id={note} role="alert" className="mt-1.5 text-sm text-destructive">
          {problem}
        </p>
      ) : (
        sending && <p className="mt-1.5 text-sm text-muted-foreground">Saving…</p>
      )}
    </li>
  )
}
