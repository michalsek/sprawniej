/**
 * Rows asked for by key (applyRows' `fetch`: an update for a row we don't have, a partial row, a missing person or
 * team): gathered for a moment so they go in few requests, and each asked for at most once in a while, so a row that
 * is gone or hidden from you can't make a loop.
 */
import { keyString } from './changes'
import type { Incoming } from './apply'
import type { LiveTable } from './tables'

export interface Asked {
  table: LiveTable
  key: Record<string, string>
}

const id = (r: Asked) => `${r.table}:${keyString(r.table, r.key)}`

export class RowFetcher {
  private requested = new Map<string, number>()
  private waiting: Asked[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private o: {
    fetch(reqs: Asked[]): Promise<Incoming[]>
    done(inputs: Incoming[]): void
    /** the guard is already lifted for these, so asking again works */
    failed(reqs: Asked[], e: unknown): void
    /** how long requests are gathered */
    wait: number
    /** a row isn't asked for again sooner than this */
    askAgain: number
    now?: () => number
  }

  constructor(o: RowFetcher['o']) {
    this.o = o
  }

  request(reqs: readonly Asked[]) {
    if (this.stopped) return
    const now = (this.o.now ?? Date.now)()
    for (const r of reqs) {
      const at = this.requested.get(id(r))
      if (at !== undefined && now - at < this.o.askAgain) continue
      this.requested.set(id(r), now)
      this.waiting.push(r)
    }
    if (this.waiting.length) this.timer ??= setTimeout(() => void this.run(), this.o.wait)
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
  }

  private async run() {
    this.timer = undefined
    const reqs = this.waiting
    this.waiting = []
    try {
      const inputs = await this.o.fetch(reqs)
      if (!this.stopped) this.o.done(inputs)
    } catch (e) {
      for (const r of reqs) this.requested.delete(id(r))
      if (!this.stopped) this.o.failed(reqs, e)
    }
  }
}
