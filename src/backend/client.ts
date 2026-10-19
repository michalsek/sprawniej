/**
 * The one connection to the database (docs/supabase-setup.md). Made the first time something asks for it, never on
 * import. Without VITE_SUPABASE_URL and VITE_SUPABASE_KEY the app is "not set up" and there is no client.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

let warned = false

/** where the database is and its publishable key (public: it only works within the database rules) */
export function backendConfig(env: Record<string, string | undefined> = import.meta.env): { url: string; key: string } | null {
  const url = env.VITE_SUPABASE_URL?.trim()
  const key = env.VITE_SUPABASE_KEY?.trim()
  if (!url || !key) return null
  try {
    const { protocol } = new URL(url)
    if (protocol !== 'https:' && protocol !== 'http:') throw new Error(protocol)
  } catch {
    if (!warned) console.warn(`VITE_SUPABASE_URL is not a web address: ${url}`)
    warned = true
    return null
  }
  return { url, key }
}

export const isSetUp = (): boolean => backendConfig() !== null

let client: SupabaseClient<Database> | null | undefined

/** null when the app isn't set up */
export function getClient(): SupabaseClient<Database> | null {
  if (client !== undefined) return client
  const config = backendConfig()
  client = config && createClient<Database>(config.url, config.key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } })
  return client
}
