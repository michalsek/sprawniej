import { describe, expect, test } from 'bun:test'
import { chipState } from '@/backend/status'
import { categoryOf, type IssueCategory } from '@/model/status'

const up = { online: true, channelsUp: true, signedIn: true, failing: false }

describe('the save chip', () => {
  test('your changes first: waiting to try again, then on their way (with nothing waiting, tests/live.test.ts)', () => {
    expect(chipState(up, { pending: 2, waiting: false })).toBe('saving')
    expect(chipState(up, { pending: 2, waiting: true })).toBe('error')
    // saving goes over its own requests: a dropped live channel doesn't make it "Not saved yet"
    expect(chipState({ ...up, channelsUp: false }, { pending: 1, waiting: false })).toBe('saving')
  })

  test('offline, and signed out, win', () => {
    expect(chipState({ ...up, online: false }, { pending: 1, waiting: true })).toBe('offline')
    expect(chipState({ ...up, online: false }, { pending: 1, waiting: false })).toBe('offline')
    expect(chipState({ ...up, signedIn: false }, { pending: 3, waiting: true })).toBe('signed-out')
  })
})

describe('categories', () => {
  test('a category this app does not know reads as Backlog instead of breaking the screen', () => {
    expect(categoryOf('blocked' as IssueCategory)).toMatchObject({ id: 'backlog', group: 'backlog' })
  })
})
