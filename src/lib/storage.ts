/**
 * This browser's localStorage and sessionStorage, for small things to remember. Either can be switched off (blocked
 * site data, some private windows), and then even looking at it throws: here a read gives null and a write does
 * nothing, so Sprawniej still starts and only forgets.
 */

export interface SafeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  keys(): string[]
}

export function guarded(get: () => Storage): SafeStorage {
  const run = <T>(fn: (s: Storage) => T, fallback: T): T => {
    try {
      return fn(get())
    } catch {
      return fallback
    }
  }
  return {
    getItem: (key) => run((s) => s.getItem(key), null),
    setItem: (key, value) => run((s) => s.setItem(key, value), undefined),
    removeItem: (key) => run((s) => s.removeItem(key), undefined),
    keys: () => run((s) => Object.keys(s), []),
  }
}

export const localStore = guarded(() => localStorage)
export const sessionStore = guarded(() => sessionStorage)
