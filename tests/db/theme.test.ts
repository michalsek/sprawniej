/**
 * Light or dark is kept in the account's own metadata (src/lib/theme.ts). Saving it must keep everything else there:
 * the password mark that Settings › Ways to sign in reads, and the name.
 */
import { describe, expect, test } from 'bun:test'
import { saveTheme } from '@/backend/auth'
import { requireClient } from '@/backend/client'
import { enabled, signUpBare } from './support'

describe.skipIf(!enabled)('light or dark with the account', () => {
  test('saving it keeps password_set and full_name', async () => {
    const { db } = await signUpBare('theme')
    await db.auth.updateUser({ data: { password_set: true, full_name: 'Test theme' } })
    // the app's own client, signed in as the test account
    const { data } = await db.auth.getSession()
    await requireClient().auth.setSession(data.session!)

    await saveTheme('dark')
    await saveTheme('light')

    const { data: fresh } = await db.auth.getUser()
    expect(fresh.user?.user_metadata).toMatchObject({ theme: 'light', password_set: true, full_name: 'Test theme' })
  }, 60_000)
})
