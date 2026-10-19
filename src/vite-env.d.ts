/// <reference types="vite/client" />

/** the settings the app reads when it is built (.env.local, or the build's environment) */
interface ImportMetaEnv {
  /** where the database is (docs/supabase-setup.md) */
  readonly VITE_SUPABASE_URL?: string
  /** the database's publishable key: public, it only works within the database rules */
  readonly VITE_SUPABASE_KEY?: string
  /** where Sprawniej is published (src/config.ts) */
  readonly VITE_PUBLIC_URL?: string
}
