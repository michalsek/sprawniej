import { describe, expect, spyOn, test } from 'bun:test'
// importing must not connect to anything
import { backendConfig, getClient } from '@/backend/client'

describe('database settings', () => {
  test('missing settings mean "not set up"', () => {
    expect(backendConfig({})).toBeNull()
    expect(backendConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBeNull()
  })

  test('both settings give the address and key', () => {
    expect(backendConfig({ VITE_SUPABASE_URL: ' https://x.supabase.co ', VITE_SUPABASE_KEY: 'sb_publishable_1' })).toEqual({ url: 'https://x.supabase.co', key: 'sb_publishable_1' })
  })

  test('an address that is not one is "not set up"', () => {
    expect(backendConfig({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_KEY: 'k' })).toBeNull()
    expect(backendConfig({ VITE_SUPABASE_URL: 'ftp://x', VITE_SUPABASE_KEY: 'k' })).toBeNull()
  })

  test('the app asking for a client with a wrong address hears about it once', () => {
    const env = import.meta.env
    const was = { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_KEY }
    Object.assign(env, { VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_KEY: 'k' })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(getClient()).toBeNull()
      expect(getClient()).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
      // the environment turns undefined into "undefined", so a setting that wasn't there is taken away again
      for (const [k, v] of [['VITE_SUPABASE_URL', was.url], ['VITE_SUPABASE_KEY', was.key]] as const) {
        if (v === undefined) delete (env as Record<string, unknown>)[k]
        else Object.assign(env, { [k]: v })
      }
    }
  })
})
