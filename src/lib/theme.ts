/**
 * Light or dark: each person picks System, Light or Dark. System follows the device. The choice is kept in this
 * browser (so the first frame is right, see the script in index.html) and with your account (so it follows you to
 * every device you sign in on). Saving it with the account is src/data/actions.ts (setTheme); following the device,
 * other tabs and the account is src/app/theme.ts.
 */
import { create } from 'zustand'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Resolved = 'light' | 'dark'

const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark']

/**
 * The browser bar's colour (theme-color) in each look: Light's is the page colour, Dark's the near-black the installed
 * app also uses (the page itself is a little lighter). index.html's metas and script copy these, and Light's is
 * src/index.css's page colour; tests/themeScript.test.ts checks all three.
 */
export const THEME_COLORS: Record<Resolved, string> = { light: '#fafafa', dark: '#18181b' }

/** this browser's copy. No colon, so signing out keeps it (src/app/signOut.ts) and the sign-in screen keeps the look. */
export const DEVICE_KEY = 'sprawniej-theme'
/** whose choice made here isn't with their account yet (gone at sign-out, like everything of yours) */
const UNSENT_KEY = 'sprawniej:theme-unsent'

/** anything that isn't a choice (missing, from an older version, typed by hand) means System */
export const parseTheme = (v: unknown): ThemeChoice => (THEME_CHOICES.includes(v as ThemeChoice) ? (v as ThemeChoice) : 'system')

export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): Resolved => (choice === 'system' ? (systemDark ? 'dark' : 'light') : choice)

interface AfterSignIn {
  choice: ThemeChoice
  /** this browser's choice goes to the account */
  send: boolean
  /** the account's choice becomes this browser's copy */
  writeDevice: boolean
}

/**
 * Which choice shows once we know who is signed in. The account's wins, except when this browser has a choice of
 * yours it couldn't send yet (it's newer); an account without one keeps this browser's.
 */
export function themeAfterSignIn(o: { account: ThemeChoice | undefined; device: ThemeChoice | null; unsentFor: string | null; userId: string }): AfterSignIn {
  const device = o.device ?? 'system'
  if (o.unsentFor === o.userId) return { choice: device, send: o.account !== device, writeDevice: false }
  if (o.account === undefined) return { choice: device, send: false, writeDevice: false }
  return { choice: o.account, send: false, writeDevice: o.account !== o.device }
}

/**
 * Sends the choice one request at a time, reading it (`current`) as it goes, so it's always the latest. Saving again
 * while one is on its way sends once more after it, however many times it was asked. `saved` hears when the latest
 * choice is with the account; an answer to an older one says nothing. What couldn't be sent waits until `save` is
 * called again.
 */
export function makeThemeSaver(send: (choice: ThemeChoice) => Promise<void>, current: () => ThemeChoice, saved: (choice: ThemeChoice) => void) {
  let busy = false
  let again = false
  async function run() {
    busy = true
    try {
      while (again) {
        again = false
        const choice = current()
        let ok = true
        try {
          await send(choice)
        } catch {
          ok = false
        }
        if (ok && !again) saved(choice)
      }
    } finally {
      busy = false
    }
  }
  return {
    save() {
      again = true
      if (!busy) void run()
    },
  }
}

// ---------- this browser's copy (any of these can fail: storage switched off, private windows) ----------

export function readDevice(): ThemeChoice | null {
  try {
    const v = localStorage.getItem(DEVICE_KEY)
    return v === null ? null : parseTheme(v)
  } catch {
    return null
  }
}

export function writeDevice(choice: ThemeChoice) {
  try {
    localStorage.setItem(DEVICE_KEY, choice)
  } catch {
    // only this browser forgets it
  }
}

export function readUnsent(): string | null {
  try {
    return localStorage.getItem(UNSENT_KEY)
  } catch {
    return null
  }
}

export function markUnsent(userId: string) {
  try {
    localStorage.setItem(UNSENT_KEY, userId)
  } catch {
    // sent now or never: nothing to remember it in
  }
}

export function clearUnsent() {
  try {
    localStorage.removeItem(UNSENT_KEY)
  } catch {
    // nothing was kept
  }
}

// ---------- on screen ----------

export const DARK_QUERY = '(prefers-color-scheme: dark)'

const systemDark = (): boolean => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches

/** what shows now: the choice, and the look it comes to on this device */
export const useTheme = create<{ choice: ThemeChoice; resolved: Resolved }>()(() => ({ choice: 'system', resolved: 'dark' }))

/**
 * Puts a look on the page: the class src/index.css reads, and the browser bar's colour. Both theme-color metas take
 * the chosen colour when it's forced, and their own when following the device. Nothing fades while it switches.
 */
function applyTheme(doc: Document, choice: ThemeChoice, resolved: Resolved) {
  const root = doc.documentElement
  if (root.classList.contains('dark') !== (resolved === 'dark')) {
    root.classList.add('theme-switching')
    root.classList.toggle('dark', resolved === 'dark')
    const frame = doc.defaultView?.requestAnimationFrame ?? ((f: () => void) => setTimeout(f, 16))
    // two frames: the first paints the new colours with nothing moving, then hovers and menus may fade again
    frame(() => frame(() => root.classList.remove('theme-switching')))
  }
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own: Resolved = meta.media.includes('dark') ? 'dark' : 'light'
    meta.content = THEME_COLORS[choice === 'system' ? own : resolved]
  }
}

/** shows a choice on this page */
export function showTheme(choice: ThemeChoice) {
  const resolved = resolveTheme(choice, systemDark())
  useTheme.setState({ choice, resolved })
  if (typeof document !== 'undefined') applyTheme(document, choice, resolved)
}
