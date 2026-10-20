/**
 * Your contact emails (Settings › Profile). They aren't live: they're read when the page opens, when the email you
 * show changes (your other tab picked another one), when the window gets focus, and after each change made here.
 */
import { useCallback, useEffect, useState } from 'react'
import { myContactEmails } from '@/data/actions'
import type { ContactEmail } from '@/model/contactEmail'

export interface ContactEmailList {
  emails: ContactEmail[]
  state: 'loading' | 'ready' | 'failed'
  reload: () => void
  /** shows a change made here at once, before the list is read again */
  patch: (change: (list: ContactEmail[]) => ContactEmail[]) => void
}

/** `shown` is the email your profile shows teammates now: a change to it reads the list again */
export function useContactEmails(shown: string | undefined): ContactEmailList {
  const [emails, setEmails] = useState<ContactEmail[]>([])
  const [state, setState] = useState<ContactEmailList['state']>('loading')
  const [asked, setAsked] = useState(0)
  const reload = useCallback(() => setAsked((n) => n + 1), [])

  useEffect(() => {
    let stop = false
    myContactEmails().then(
      (list) => {
        if (stop) return
        setEmails(list)
        setState('ready')
      },
      (e: unknown) => {
        console.warn('Sprawniej couldn’t read your contact emails', e)
        if (!stop) setState((s) => (s === 'ready' ? s : 'failed'))
      },
    )
    return () => {
      stop = true
    }
  }, [shown, asked])

  useEffect(() => {
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [reload])

  return { emails, state, reload, patch: setEmails }
}
