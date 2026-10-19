/**
 * What the browser tells an open workspace about its connection: online and offline, the tab hidden and shown
 * again, and the sign-in ending or coming back (a sign-in that runs out ends the live channels' access).
 */
import { useAuth } from './auth'

export interface ConnectionEvents {
  online(): void
  offline(): void
  hidden(): void
  /** shown again after `away` ms hidden */
  visible(away: number): void
  signedIn(on: boolean): void
}

/** starts listening; returns the function that stops */
export function watchConnection(on: ConnectionEvents): () => void {
  let hiddenAt: number | null = null
  const onOnline = () => on.online()
  const onOffline = () => on.offline()
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      on.hidden()
      return
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt
    hiddenAt = null
    on.visible(away)
  }
  let signedIn = !!useAuth.getState().user
  const stopAuth = useAuth.subscribe((a) => {
    if (!!a.user === signedIn) return
    signedIn = !!a.user
    on.signedIn(signedIn)
  })
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    stopAuth()
  }
}
