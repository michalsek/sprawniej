/**
 * Where Supabase starts the Edge Function `notion-webhook` (Deno). `bun run deploy:notion` bundles this file into
 * supabase/functions/notion-webhook/index.js and deploys it (docs/supabase-setup.md, Notion). It needs no secret of
 * its own: each workspace's key is checked by the database.
 */
import { handle } from './handler'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): unknown
}

Deno.serve(async (req) => {
  try {
    return await handle(req, {
      url: Deno.env.get('SUPABASE_URL'),
      key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    })
  } catch (e) {
    // the error names the database call, never the address or the page; Notion pauses the automation until someone
    // resumes it
    console.error(e)
    return new Response(JSON.stringify({ error: 'Something went wrong. Resume the automation in Notion to try again.' }), { status: 500 })
  }
})
