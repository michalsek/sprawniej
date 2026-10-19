/** timers that only move when the test says (for the copy's save debounce, src/backend/keep.ts) */
export function fakeTimers() {
  let at = 0
  let timers: { fn: () => void; due: number; id: number }[] = []
  let n = 0
  const settle = () => new Promise((r) => setTimeout(r, 0))
  return {
    now: () => at,
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, due: at + ms, id: ++n })
      return n
    },
    clearTimeout: (id: unknown) => {
      timers = timers.filter((t) => t.id !== id)
    },
    /** timers waiting */
    get waiting() {
      return timers.length
    },
    /** moves time on by `ms`, running each timer due on the way (and what it starts) */
    async tick(ms: number) {
      const end = at + ms
      for (;;) {
        const next = timers.filter((t) => t.due <= end).sort((a, b) => a.due - b.due)[0]
        if (!next) break
        at = next.due
        timers = timers.filter((t) => t !== next)
        next.fn()
        await settle()
      }
      at = end
      await settle()
    },
  }
}
