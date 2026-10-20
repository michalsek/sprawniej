/**
 * Notion's ids and addresses as Sprawniej checks them (docs/notion.md): the webhook (src/notion), the history's link
 * back to a page (src/data/history.ts). The migration copies the patterns (`-- @regex notion-…` markers), and
 * tests/statusLists.test.ts compares them.
 */

/** a uuid (a connection's id, a team's, a person's), in either case */
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
export const UUID = new RegExp(UUID_PATTERN, 'i')

/** a Notion page id as it is kept: 32 lower-case hex digits, no dashes */
export const PAGE_ID_PATTERN = '^[0-9a-f]{32}$'
export const PAGE_ID = new RegExp(PAGE_ID_PATTERN)

/**
 * Notion's own addresses (notion.so and www.notion.so, a team's *.notion.site), with nothing after the host that
 * Markdown or HTML would read: no spaces, parentheses, double quotes or angle brackets. Anything else is replaced
 * by an address made from the page's id.
 */
export const NOTION_URL_PATTERN = "^https://([a-z0-9-]+\\.)*notion\\.(so|site)/[A-Za-z0-9._~/?#@!$&'*+,;=%-]*$"
export const NOTION_URL = new RegExp(NOTION_URL_PATTERN)

/** the longest page address kept */
export const MAX_URL = 2000

/** the page's address when it is one of Notion's, otherwise one made from its id (`id`: a checked page id) */
export function pageUrl(url: unknown, id: string): string {
  return typeof url === 'string' && url.length <= MAX_URL && NOTION_URL.test(url) ? url : `https://www.notion.so/${id}`
}
