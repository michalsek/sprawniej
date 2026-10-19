/**
 * The two live channels of an open workspace: ws:<workspace id> for everything shared, me:<profile id> for your
 * inbox and read marks (supabase/migrations/20261019000004_realtime.sql). Both are private: the database checks you
 * may listen when you join, with your sign-in, so it must be handed over first.
 *
 * A channel that drops comes back by itself (and says SUBSCRIBED again); what was sent meanwhile is lost, so track()
 * tells index.ts when to catch up.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import type { Message } from './tables'

type Db = SupabaseClient<Database>

export type Topic = 'ws' | 'me'
export type ChannelStatus = 'joining' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'

/** how long joining may take before the workspace opens without it (it keeps trying) */
const SLOW = 10_000

/** a refusal: the database rules said no (not "can't reach") */
const isDenied = (err: Error | undefined) => !!err && /permission|unauthori[sz]ed|not allowed|denied/i.test(err.message)

export class Channels {
  readonly status: Record<Topic, ChannelStatus> = { ws: 'joining', me: 'joining' }
  closing = false
  private db: Db
  private topics: Record<Topic, string>
  private on: { message(m: Message): void; status(t: Topic, s: ChannelStatus, err?: Error): void }
  private list: RealtimeChannel[] = []

  constructor(db: Db, workspaceId: string, profileId: string, on: Channels['on']) {
    this.db = db
    this.topics = { ws: `ws:${workspaceId}`, me: `me:${profileId}` }
    this.on = on
  }

  get up(): boolean {
    return this.status.ws === 'SUBSCRIBED' && this.status.me === 'SUBSCRIBED'
  }

  /** 'up' once both are joined; 'slow' after a while (they keep trying); 'denied' when ws: is refused */
  async join(): Promise<'up' | 'slow' | 'denied'> {
    await this.db.realtime.setAuth()
    if (this.closing) return 'slow'
    return new Promise((resolve) => {
      let done = false
      const finish = (r: 'up' | 'slow' | 'denied') => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(r)
      }
      const timer = setTimeout(() => finish('slow'), SLOW)
      for (const topic of ['ws', 'me'] as const) {
        const ch = this.db.channel(this.topics[topic], { config: { private: true } })
        ch.on('broadcast', { event: 'change' }, (m) => {
          if (!this.closing) this.on.message(m.payload as Message)
        })
        ch.subscribe((s, err) => {
          this.status[topic] = s
          this.on.status(topic, s, err)
          if (this.closing) return finish('slow')
          if (this.up) finish('up')
          else if (topic === 'ws' && s === 'CHANNEL_ERROR' && isDenied(err)) finish('denied')
        })
        this.list.push(ch)
      }
    })
  }

  /** leaves both; their CLOSED isn't a drop */
  async close(): Promise<void> {
    this.closing = true
    // the client keeps one channel per topic: opening the same workspace again must wait until these are gone
    await Promise.all(this.list.map((ch) => this.db.removeChannel(ch).catch(() => {})))
    this.list = []
    this.status.ws = 'CLOSED'
    this.status.me = 'CLOSED'
  }
}

export interface Tracked {
  up: boolean
  /** it dropped after being up (or never came up in time), so messages may have been missed */
  missed: boolean
}

/** one channel's new status: whether it just dropped, or came back after missing messages (then catch up) */
export function track(prev: Tracked, s: ChannelStatus, closing: boolean): { next: Tracked; dropped: boolean; back: boolean } {
  if (s === 'joining') return { next: prev, dropped: false, back: false }
  if (s === 'SUBSCRIBED') return { next: { up: true, missed: false }, dropped: false, back: prev.missed }
  if (closing) return { next: { up: false, missed: prev.missed }, dropped: false, back: false }
  return { next: { up: false, missed: prev.missed || prev.up }, dropped: prev.up, back: false }
}
