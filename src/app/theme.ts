/**
 * Keeps the look right while the app runs: System follows the device as it changes, other tabs follow a choice
 * made in one, and the account's choice comes in once we know who is signed in (src/lib/theme.ts, themeAfterSignIn).
 */
import { useAuth, type AuthUser } from '@/backend/auth'
import { sendUnsentTheme } from '@/data/actions'
import { clearUnsent, DARK_QUERY, DEVICE_KEY, parseTheme, readDevice, readUnsent, showTheme, themeAfterSignIn, useTheme, writeDevice } from '@/lib/theme'

function signedIn(user: AuthUser) {
  const next = themeAfterSignIn({ account: user.theme, device: readDevice(), unsentFor: readUnsent(), userId: user.id })
  if (next.choice !== useTheme.getState().choice) showTheme(next.choice)
  if (next.writeDevice) writeDevice(next.choice)
  if (next.send) sendUnsentTheme()
  else clearUnsent()
}

/** once at start, before the sign-in starts */
export function startTheme() {
  showTheme(readDevice() ?? 'system')
  window.matchMedia?.(DARK_QUERY).addEventListener('change', () => {
    if (useTheme.getState().choice === 'system') showTheme('system')
  })
  window.addEventListener('storage', (e) => {
    if (e.key === DEVICE_KEY) showTheme(parseTheme(e.newValue))
  })
  // a fresh copy of you (signing in, renewing the sign-in, a change saved): the account's choice may be new
  useAuth.subscribe((s, was) => {
    if (s.user && s.user !== was.user) signedIn(s.user)
  })
  window.addEventListener('online', sendUnsentTheme)
}
