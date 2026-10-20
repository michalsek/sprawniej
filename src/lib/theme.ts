/**
 * Light or dark: each person picks System, Light or Dark. System follows the device. The choice is kept in this
 * browser (so the first frame is right, see the script in index.html) and with your account (so it follows you to
 * every device you sign in on). Saving it with the account is src/data/actions.ts (setTheme); following the device,
 * other tabs and the account is src/app/theme.ts.
 */
import { create } from 'zustand'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Resolved = 'light' | 'dark'

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark']

/** the page colour of each, for the browser's bar (index.html's theme-color metas and src/index.css agree; tested) */
export const THEME_COLORS: Record<Resolved, string> = { light: '#fafafa', dark: '#18181b' }

/** this browser's copy. No colon, so signing out keeps it (src/app/signOut.ts) and the sign-in screen keeps the look. */
export const DEVICE_KEY = 'sprawniej-theme'
/** whose choice made here isn't with their account yet (gone at sign-out, like everything of yours) */
export const UNSENT_KEY = 'sprawniej:theme-unsent'

/** anything that isn't a choice (missing, from an older version, typed by hand) means System */
export const parseTheme = (v: unknown): ThemeChoice => (THEME_CHOICES.includes(v as ThemeChoice) ? (v as ThemeChoice) : 'system')

export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): Resolved => (choice === 'system' ? (systemDark ? 'dark' : 'light') : choice)

export interface AfterSignIn {
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
 * Sends choices one at a time. A choice made while one is on its way waits, and only the last of those is sent.
 * `saved` hears when the last choice made is with the account; an answer to an older one says nothing. A choice that
 * couldn't be sent is simply given again later (save it again).
 */
export function makeThemeSaver(send: (choice: ThemeChoice) => Promise<void>, saved: (choice: ThemeChoice) => void) {
  let busy = false
  let next: ThemeChoice | null = null
  async function run() {
    busy = true
    while (next !== null) {
      const choice = next
      next = null
      const ok = await send(choice).then(
        () => true,
        () => false,
      )
      if (ok && next === null) saved(choice)
    }
    busy = false
  }
  return {
    save(choice: ThemeChoice) {
      next = choice
      if (!busy) void run()
    },
  }
}

// ---------- this browser's copy (any of these can fail: storage switched off, private windows) ----------

export function readDevice(store: Pick<Storage, 'getItem'> = localStorage): ThemeChoice | null {
  try {
    const v = store.getItem(DEVICE_KEY)
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

export const systemDark = (): boolean => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches

/** what shows now: the choice, and the look it comes to on this device */
export const useTheme = create<{ choice: ThemeChoice; resolved: Resolved }>()(() => ({ choice: 'system', resolved: 'dark' }))

/**
 * Puts a look on the page: the class src/index.css reads, and the browser bar's colour. Both theme-color metas take
 * the chosen colour when it's forced, and their own when following the device. Nothing fades while it switches.
 */
export function applyTheme(doc: Document, choice: ThemeChoice, resolved: Resolved) {
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
