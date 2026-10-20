/**
 * Light or dark is kept in the account's own metadata (src/lib/theme.ts). Saving it must keep everything else there:
 * the password mark that Settings › Ways to sign in reads, and the name. And the account's updated_at must move on,
 * since the app keeps an older copy of you from replacing a newer one by it (src/backend/auth.ts, older).
 */
import { describe, expect, test } from 'bun:test'
import { saveTheme } from '@/backend/auth'
import { enabled, signUpBare } from './support'

describe.skipIf(!enabled)('light or dark with the account', () => {
  test('saving it keeps password_set and full_name, and moves updated_at on', async () => {
    const { db } = await signUpBare('theme')
    const { data: before } = await db.auth.updateUser({ data: { password_set: true, full_name: 'Test theme' } })

    await saveTheme('light', db)

    const { data: fresh } = await db.auth.getUser()
    expect(fresh.user?.user_metadata).toMatchObject({ theme: 'light', password_set: true, full_name: 'Test theme' })
    expect(Date.parse(fresh.user!.updated_at!)).toBeGreaterThan(Date.parse(before.user!.updated_at!))
  }, 60_000)
})
