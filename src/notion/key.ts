/**
 * The secret in a Notion address (docs/notion.md): `?k=<64 hex digits>`, or the header `X-Sprawniej-Secret` for
 * whoever prefers a header in Notion's "Send webhook". Only its sha256 goes to the database.
 */

/** what notion_connect() makes: 32 random bytes as hex */
export const KEY = /^[0-9a-f]{64}$/

export async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** the key a request carries, from the address first; null when there is none or it isn't one */
export function keyFrom(req: Request): string | null {
  const k = (new URL(req.url).searchParams.get('k') ?? req.headers.get('x-sprawniej-secret') ?? '').trim().toLowerCase()
  return KEY.test(k) ? k : null
}
