import { describe, expect, test } from 'bun:test'
import { notionAddress, readLast, type LastPage } from '@/backend/notion'
import { notionText } from '@/features/settings/notionText'

describe('the Notion address', () => {
  test('the function’s, with the connection and its key', () => {
    expect(notionAddress('https://abc.supabase.co/', '11111111-2222-4333-8444-555555555555', 'f'.repeat(64))).toBe(
      `https://abc.supabase.co/functions/v1/notion-webhook?c=11111111-2222-4333-8444-555555555555&k=${'f'.repeat(64)}`,
    )
  })
})

describe('the latest page', () => {
  const made: LastPage = { title: 'Fix login', ref: 'ENG-12', isNew: true, author: 'ana', problem: null }

  test('read from whatever was saved', () => {
    expect(readLast(null)).toBeNull()
    expect(readLast([1])).toBeNull()
    expect(readLast({ title: 'Fix login', ref: 'ENG-12', new: true, author: 'ana' })).toEqual(made)
    expect(readLast({ title: 3, ref: null, new: 'yes', author: 7, problem: 'other' })).toEqual({ title: '', ref: null, isNew: false, author: null, problem: null })
    expect(readLast({ problem: 'busy' })?.problem).toBe('busy')
  })

  test('in words', () => {
    expect(notionText(null)).toBe('Waiting for the first page')
    expect(notionText(made)).toBe('Last page: “Fix login” became ENG-12')
    expect(notionText({ ...made, title: '' })).toBe('Last page became ENG-12')
    expect(notionText({ ...made, isNew: false })).toBe('Last page was already ENG-12')
    expect(notionText({ ...made, ref: null, problem: 'team' })).toBe('Last page wasn’t added: pick a team')
    expect(notionText({ ...made, ref: null, problem: 'busy' })).toBe('Pages were coming too fast. Resume the automation in Notion in a few minutes.')
    expect(notionText(readLast({}))).toBe('Waiting for the first page')
  })
})
