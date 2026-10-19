/**
 * Run `fn` when the tab is about to close or be hidden, before anything else hears of it (this listens first, on the
 * way down from the window). Fields that wait a moment before handing over what you typed use it, so closing the tab
 * right after typing keeps the last words, and the "not saved yet" question when closing (src/backend/writes.ts)
 * knows about them.
 */
export function onBeforeHide(fn: () => void): () => void {
  const hidden = () => document.visibilityState === 'hidden' && fn()
  window.addEventListener('beforeunload', fn, true)
  window.addEventListener('visibilitychange', hidden, true)
  window.addEventListener('pagehide', fn, true)
  return () => {
    window.removeEventListener('beforeunload', fn, true)
    window.removeEventListener('visibilitychange', hidden, true)
    window.removeEventListener('pagehide', fn, true)
  }
}
