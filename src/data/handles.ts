/**
 * Changing your @handle (Settings › Profile). Your login, the hidden key everything points at, never changes;
 * the handle is what people see and mention. These checks run as you type, before anything is sent; the database
 * checks again (set_handle), also against people in other workspaces.
 */
import { handleOf, LOGIN_PATTERN, type Person } from '@/model/schema'

export const HANDLE_WORDS = {
  invalid: 'Use up to 39 letters, digits and dashes, starting with a letter or a digit.',
  taken: (handle: string) => `Someone already uses @${handle}. Pick another one.`,
}

/** what was typed, without spaces or the @ in front: " @ania " → "ania" */
export const cleanHandle = (typed: string): string => typed.trim().replace(/^@+/, '').trim()

/**
 * What's wrong with changing `me`'s handle to `handle` (already cleaned): 'invalid', 'taken' (someone here has it
 * now, case aside), 'same' (nothing to change), or null when it can be sent. A change of case only is fine.
 */
export function handleProblem(handle: string, me: Pick<Person, 'login' | 'handle'>, people: Record<string, Person>): 'invalid' | 'taken' | 'same' | null {
  if (!LOGIN_PATTERN.test(handle)) return 'invalid'
  if (handle === handleOf(me)) return 'same'
  const wanted = handle.toLowerCase()
  const holder = Object.values(people).find((p) => p.login !== me.login && handleOf(p).toLowerCase() === wanted)
  return holder ? 'taken' : null
}
