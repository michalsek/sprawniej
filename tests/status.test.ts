import { describe, expect, test } from 'bun:test'
import { chipState } from '@/backend/status'

const up = { online: true, channelsUp: true, signedIn: true, failing: false }
const none = { pending: 0, waiting: false }

describe('the save chip', () => {
  test('your changes first: waiting to try again, on their way, then the connection', () => {
    expect(chipState(up, none)).toBe('saved')
    expect(chipState(up, { pending: 2, waiting: false })).toBe('saving')
    expect(chipState(up, { pending: 2, waiting: true })).toBe('error')
    // saving goes over its own requests: a dropped live channel doesn't make it "Not saved yet"
    expect(chipState({ ...up, channelsUp: false }, { pending: 1, waiting: false })).toBe('saving')
    expect(chipState({ ...up, channelsUp: false }, none)).toBe('reconnecting')
  })

  test('offline, and signed out, win', () => {
    expect(chipState({ ...up, online: false }, { pending: 1, waiting: true })).toBe('offline')
    expect(chipState({ ...up, online: false }, { pending: 1, waiting: false })).toBe('offline')
    expect(chipState({ ...up, online: false }, none)).toBe('offline')
    expect(chipState({ ...up, signedIn: false }, { pending: 3, waiting: true })).toBe('signed-out')
  })
})
