/** The words Settings › Notion uses for what the latest page did. Pure, so it's unit-tested (tests/notionSettings.test.ts). */
import type { LastPage } from '@/backend/notion'

/** the line under the team picker, before "· 5 min ago" */
export function notionText(last: LastPage | null): string {
  if (!last) return 'Waiting for the first page'
  if (last.problem === 'team') return 'Last page wasn’t added: pick a team'
  if (last.problem === 'busy') return 'Pages were coming too fast. Resume the automation in Notion in a few minutes.'
  if (!last.ref) return 'Waiting for the first page'
  if (!last.isNew) return `Last page was already ${last.ref}`
  return last.title ? `Last page: “${last.title}” became ${last.ref}` : `Last page became ${last.ref}`
}
