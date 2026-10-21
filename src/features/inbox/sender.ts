/** Who a note in the Inbox is from, in words. */
import type { InboxItem, Person } from '@/model/schema'

/** a Notion page whose author isn't a member: Notion did it */
export const fromNotion = (n: Pick<InboxItem, 'actor' | 'from'>): boolean => !n.actor && n.from === 'notion'

/** their name; their @handle when they have no name; "Someone" when their profile is gone */
export function senderName(n: Pick<InboxItem, 'actor' | 'from'>, actor: Pick<Person, 'name'> | undefined): string {
  if (actor?.name) return actor.name
  if (fromNotion(n)) return 'Notion'
  return n.actor || 'Someone'
}
