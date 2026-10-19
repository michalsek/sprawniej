import { describe, expect, spyOn, test } from 'bun:test'
// importing must not connect to anything
import { backendConfig } from '@/backend/client'

describe('database settings', () => {
  test('missing settings mean "not set up"', () => {
    expect(backendConfig({})).toBeNull()
    expect(backendConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBeNull()
  })

  test('both settings give the address and key', () => {
    expect(backendConfig({ VITE_SUPABASE_URL: ' https://x.supabase.co ', VITE_SUPABASE_KEY: 'sb_publishable_1' })).toEqual({ url: 'https://x.supabase.co', key: 'sb_publishable_1' })
  })

  test('an address that is not one is "not set up", with one warning', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    expect(backendConfig({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_KEY: 'k' })).toBeNull()
    expect(backendConfig({ VITE_SUPABASE_URL: 'ftp://x', VITE_SUPABASE_KEY: 'k' })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
