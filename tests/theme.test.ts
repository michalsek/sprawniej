import { describe, expect, test } from 'bun:test'
import { makeThemeSaver, parseTheme, themeAfterSignIn, type ThemeChoice } from '@/lib/theme'

describe('which choice shows after signing in', () => {
  const me = 'u1'
  test.each([
    // account, device, unsent for, what shows, send, write device
    ['light', 'dark', null, 'light', false, true],
    ['light', null, null, 'light', false, true],
    ['dark', 'dark', null, 'dark', false, false],
    // the account has none: this browser's stays
    [undefined, 'light', null, 'light', false, false],
    [undefined, null, null, 'system', false, false],
    // a choice of yours made here that couldn't be sent is newer than the account's
    ['light', 'dark', me, 'dark', true, false],
    [undefined, 'dark', me, 'dark', true, false],
    ['dark', 'dark', me, 'dark', false, false],
    // someone else's unsent choice doesn't count
    ['light', 'dark', 'u2', 'light', false, true],
  ] as const)('account %p, device %p, unsent for %p → %p', (account, device, unsentFor, choice, send, writeDevice) => {
    expect(themeAfterSignIn({ account, device, unsentFor, userId: me })).toEqual({ choice, send, writeDevice })
  })

  test('a value that is not a choice means System', () => {
    expect(parseTheme(42)).toBe('system')
    expect(parseTheme('blue')).toBe('system')
    expect(parseTheme('light')).toBe('light')
  })
})

/** a pretend account: each send waits until the test answers it */
function pretendAccount() {
  const sent: ThemeChoice[] = []
  const answers: ((ok: boolean) => void)[] = []
  const saved: ThemeChoice[] = []
  const saver = makeThemeSaver(
    (choice) =>
      new Promise<void>((resolve, reject) => {
        sent.push(choice)
        answers.push((ok) => (ok ? resolve() : reject(new Error('offline'))))
      }),
    (choice) => saved.push(choice),
  )
  const answer = async (ok: boolean) => {
    answers.shift()!(ok)
    // let the saver hear the answer and send what waits
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  return { saver, sent, saved, answer }
}

describe('saving the choice', () => {
  test('one at a time: choices made meanwhile wait, and only the last is sent', async () => {
    const a = pretendAccount()
    a.saver.save('light')
    a.saver.save('dark')
    a.saver.save('system')
    expect(a.sent).toEqual(['light'])
    await a.answer(true)
    expect(a.sent).toEqual(['light', 'system'])
    await a.answer(true)
    expect(a.saved).toEqual(['system'])
  })

  test('an answer to an older choice says nothing while a newer one is still to send', async () => {
    const a = pretendAccount()
    a.saver.save('light')
    a.saver.save('dark')
    await a.answer(true)
    expect(a.saved).toEqual([])
    await a.answer(true)
    expect(a.saved).toEqual(['dark'])
  })

  test('a choice that could not be sent stays unsaved until it is given again', async () => {
    const a = pretendAccount()
    a.saver.save('light')
    await a.answer(false)
    expect(a.saved).toEqual([])
    a.saver.save('light')
    expect(a.sent).toEqual(['light', 'light'])
    await a.answer(true)
    expect(a.saved).toEqual(['light'])
  })

  test('a failed send goes straight on to the newer choice', async () => {
    const a = pretendAccount()
    a.saver.save('light')
    a.saver.save('dark')
    await a.answer(false)
    expect(a.sent).toEqual(['light', 'dark'])
    await a.answer(true)
    expect(a.saved).toEqual(['dark'])
  })
})
