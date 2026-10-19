import { describe, expect, test } from 'bun:test'
import { isMessage, track, type ChannelStatus, type Tracked } from '@/backend/live'
import { connectionState } from '@/backend/status'

/** runs statuses through track(), gathering drops and comebacks */
function run(statuses: ChannelStatus[], closing = false, start: Tracked = { up: false, missed: false }) {
  let state = start
  const events: string[] = []
  for (const s of statuses) {
    const r = track(state, s, closing)
    state = r.next
    if (r.dropped) events.push('dropped')
    if (r.back) events.push('back')
  }
  return { state, events }
}

describe('a live channel', () => {
  test('the first join is not a comeback', () => {
    expect(run(['joining', 'SUBSCRIBED'])).toEqual({ state: { up: true, missed: false }, events: [] })
  })

  test('dropping and joining again means catching up', () => {
    expect(run(['SUBSCRIBED', 'CHANNEL_ERROR', 'SUBSCRIBED']).events).toEqual(['dropped', 'back'])
  })

  test('two errors in a row are one drop', () => {
    expect(run(['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CHANNEL_ERROR', 'SUBSCRIBED']).events).toEqual(['dropped', 'back'])
  })

  test('slow to join the first time is not a drop', () => {
    expect(run(['TIMED_OUT', 'SUBSCRIBED'])).toEqual({ state: { up: true, missed: false }, events: [] })
  })

  test('one that missed its first join (opened without it) catches up once it is in', () => {
    expect(run(['SUBSCRIBED'], false, { up: false, missed: true }).events).toEqual(['back'])
  })

  test('closing on purpose is not a drop', () => {
    expect(run(['CLOSED'], true, { up: true, missed: false })).toEqual({ state: { up: false, missed: false }, events: [] })
  })
})

describe('the save chip', () => {
  test('from the facts', () => {
    expect(connectionState(true, true, true, false)).toBe('saved')
    expect(connectionState(true, true, true, false, 2)).toBe('saving')
    expect(connectionState(false, true, true, false)).toBe('offline')
    expect(connectionState(false, true, false, false)).toBe('signed-out')
  })

  test('not reaching Sprawniej is calm with nothing waiting, a warning with something waiting', () => {
    expect(connectionState(true, false, true, false)).toBe('reconnecting')
    expect(connectionState(true, true, true, true)).toBe('reconnecting')
    expect(connectionState(true, false, true, false, 1)).toBe('error')
  })
})

describe('what arrives on a channel', () => {
  test('messages pass, anything else is skipped', () => {
    expect(isMessage({ table: 'issues', op: 'UPDATE', row: { id: 'x' } })).toBe(true)
    expect(isMessage({ op: 'catch_up' })).toBe(true)
    expect(isMessage({ table: 'issues', op: 'UPDATE' })).toBe(false)
    expect(isMessage({ table: 'issues', op: 'TRUNCATE', row: {} })).toBe(false)
    expect(isMessage({ table: 'issues', op: 'INSERT', row: [] })).toBe(false)
    expect(isMessage('hello')).toBe(false)
    expect(isMessage(null)).toBe(false)
  })
})
