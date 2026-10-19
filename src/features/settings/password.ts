/** what's wrong with a new password, before it's sent; undefined: nothing (tests/signInWays.test.ts) */
export function passwordProblem(password: string, again: string): string | undefined {
  if (password.length < 8) return 'Pick a longer password: at least 8 characters.'
  if (password !== again) return "The two passwords don't match."
  return undefined
}
