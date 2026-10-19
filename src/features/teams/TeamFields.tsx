/** Name, key and emoji of a team. The key (ENG in ENG-12) follows the name until you change it yourself. */
import { useState } from 'react'
import { EmojiPicker } from '@/components/EmojiPicker'
import { suggestKey } from '@/data/actions'
import { Input } from '@/ui/input'
import { KEY_PATTERN, type TeamDraft } from '@/model/teamDraft'


export function TeamFields({ value, onChange, takenKeys = [] }: { value: TeamDraft; onChange: (v: TeamDraft) => void; takenKeys?: string[] }) {
  const [keyTouched, setKeyTouched] = useState(false)
  const keyProblem = !value.key ? undefined : !KEY_PATTERN.test(value.key) ? 'Use 1 to 7 capital letters or digits, starting with a letter.' : takenKeys.includes(value.key) ? 'Another team already uses this key.' : undefined
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="team-name">
          Team name
        </label>
        <div className="flex gap-2">
          <EmojiPicker value={value.emoji} onChange={(emoji) => onChange({ ...value, emoji })} label="Team emoji" />
          <Input
            id="team-name"
            className="h-10"
            value={value.name}
            placeholder="Engineering"
            onChange={(e) => onChange({ ...value, name: e.target.value, key: keyTouched ? value.key : suggestKey(e.target.value) })}
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="team-key">
          Short key
        </label>
        <Input
          id="team-key"
          className="h-10 w-32 font-mono uppercase"
          value={value.key}
          maxLength={7}
          onChange={(e) => {
            setKeyTouched(true)
            onChange({ ...value, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })
          }}
        />
        <p className="mt-1.5 text-sm text-muted-foreground">{keyProblem ?? `Issues will be numbered ${value.key || 'KEY'}-1, ${value.key || 'KEY'}-2…`}</p>
      </div>
    </div>
  )
}
