/**
 * Where Supabase starts the Edge Function `github-webhook` (Deno). `bun run deploy:github` bundles this file into
 * supabase/functions/github-webhook/index.js and deploys it (docs/supabase-setup.md, GitHub).
 */
import { handle } from './handler'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): unknown
}

Deno.serve(async (req) => {
  try {
    return await handle(req, {
      secret: Deno.env.get('GITHUB_WEBHOOK_SECRET'),
      url: Deno.env.get('SUPABASE_URL'),
      key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    })
  } catch (e) {
    // GitHub shows the answer under Recent Deliveries, and "Redeliver" tries again
    console.error(e)
    return new Response(JSON.stringify({ error: 'Something went wrong. Redeliver to try again.' }), { status: 500 })
  }
})
