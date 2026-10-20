/**
 * Contact emails: a person keeps a few emails teammates may write to and picks the one teammates see, or none. How
 * they sign in doesn't change. The database keeps the list (profile_emails, only its owner reads it) and copies the
 * chosen one onto the profile (`Person.contactEmail`). The rules here are the database's
 * (supabase/migrations/20261021190000_contact_emails.sql); tests/contactEmail.test.ts compares them.
 */

/** something@domain.tld with no spaces; the same rule as private.valid_email */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
export const MAX_EMAIL_LENGTH = 254
/** how many one person keeps (private.limit_emails) */
export const MAX_CONTACT_EMAILS = 5

/** one of your emails, as only you see it */
export interface ContactEmail {
  id: string
  email: string
  /** the one teammates see */
  visible: boolean
  createdAt: string
}

export const EMAIL_PROBLEMS = {
  shape: "That doesn't look like an email address.",
  long: `That email is too long. It can have up to ${MAX_EMAIL_LENGTH} characters.`,
  taken: 'You already have that email.',
  full: `You can keep up to ${MAX_CONTACT_EMAILS} emails. Remove one first.`,
} as const

/** Why an email can't be added to your list (`existing`), or null when it can. Spaces around it don't count. */
export function emailProblem(typed: string, existing: readonly Pick<ContactEmail, 'email'>[], changing = false): string | null {
  const email = typed.trim()
  if (email.length > MAX_EMAIL_LENGTH) return EMAIL_PROBLEMS.long
  if (!EMAIL_PATTERN.test(email)) return EMAIL_PROBLEMS.shape
  const lower = email.toLowerCase()
  if (existing.some((e) => e.email.toLowerCase() === lower)) return EMAIL_PROBLEMS.taken
  if (!changing && existing.length >= MAX_CONTACT_EMAILS) return EMAIL_PROBLEMS.full
  return null
}

/**
 * Why the email `id` can't be changed to `typed`, or null when it can: the others in the list count (itself doesn't,
 * so a change of case only is fine), and the limit doesn't, as nothing is added.
 */
export function changeProblem(id: string, typed: string, list: readonly Pick<ContactEmail, 'id' | 'email'>[]): string | null {
  return emailProblem(typed, list.filter((e) => e.id !== id), true)
}

/**
 * The sign-in email to offer as a one-tap add, or null: only when there is one and it could be added as it is (it
 * looks like an email, isn't in the list yet, case aside, and the list has room). It is copied as an ordinary email.
 */
export function signInEmailToOffer(signIn: string | null | undefined, existing: readonly Pick<ContactEmail, 'email'>[]): string | null {
  const email = signIn?.trim()
  return email && !emailProblem(email, existing) ? email : null
}
