/** The issue title on its page: edited in place, saved a moment after you pause (one change, not one per key). */
import { InlineText } from '@/components/InlineText'
import { updateIssue } from '@/data/actions'

export function TitleField({ id, value }: { id: string; value: string }) {
  return (
    <InlineText
      value={value}
      onSave={(title) => updateIssue(id, { title })}
      placeholder="Issue title"
      label="Title"
      required
      lines="wrap"
      className="text-issue-title font-semibold"
    />
  )
}
