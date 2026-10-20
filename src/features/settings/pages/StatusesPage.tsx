/**
 * Settings › Statuses: the workspace's own statuses, group by group (StatusesSettings). Everyone in the workspace may
 * change them, as with labels. Project statuses will get a section of their own here.
 */
import { Section } from '../Section'
import { StatusesSettings } from '../StatusesSettings'

export function StatusesPage() {
  return (
    <Section
      title="Issue statuses"
      description="Rename, recolour and reorder them, or add your own steps to a group. A hidden status isn't offered when picking one; issues that have it keep it."
    >
      <StatusesSettings kind="issue" />
    </Section>
  )
}
