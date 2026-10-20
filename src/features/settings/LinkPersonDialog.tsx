/**
 * "Who is Jan Kowalski here?" Linking moves everything that pointed at someone the Linear import brought (issues,
 * comments, projects, views) to a member who already joined (linkPerson in actions.ts). It can't be undone.
 */
import { useMemo, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { PersonAvatar } from '@/components/Avatar'
import { linkPerson } from '@/data/actions'
import { sameName } from '@/lib/person'
import { useData } from '@/data/store'
import { handleOf, isGuest, type Person } from '@/model/schema'
import { Button } from '@/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog'
import { plainFilter } from '@/lib/fuzzy'
import { cn } from '@/lib/utils'
import { workOf } from './unlinked'

interface Choice {
  key: string
  person: Person
  hint: string
}

export function LinkPersonDialog({ guest, onClose }: { guest: Person; onClose: () => void }) {
  const s = useData(useShallow((st) => ({ people: st.people, members: st.members, issues: st.issues, comments: st.comments })))
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // the members who joined (not people from Linear, not someone who left)
  const choices: Choice[] = useMemo(
    () =>
      Object.entries(s.members)
        .filter(([login, m]) => !m.removedAt && !isGuest(login))
        .map(([login]) => {
          const person = s.people[login] ?? { login, githubId: 0, name: login, avatarUrl: '' }
          return { key: login, person, hint: `@${handleOf(person)}` }
        })
        .sort((a, b) => a.person.name.localeCompare(b.person.name)),
    [s.members, s.people],
  )

  // the likely match is picked to start with (same name), until you pick someone yourself
  const guess = useMemo(() => choices.find((c) => sameName(guest.name, c.person))?.key ?? null, [choices, guest.name])
  const chosen = picked ?? guess
  /** the row the keyboard is on; it starts on the likely match, so Enter picks them */
  const [active, setActive] = useState<string>()
  const choice = choices.find((c) => c.key === chosen)

  async function link() {
    if (!choice) return
    setBusy(true)
    try {
      await linkPerson(guest.login, choice.key)
      toast(`${guest.name} is now @${handleOf(choice.person)}`, { description: 'Their issues, comments and views are theirs.' })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : "We couldn't link them. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  const moved = workOf(s, guest.login)

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="[overflow-wrap:anywhere] sm:max-w-lg">
        <DialogTitle>Who is {guest.name} here?</DialogTitle>
        <DialogDescription>
          Pick the member they are. Their issues, comments and views move to them. Not here yet? Send them an invite instead: they become {guest.name}{' '}
          when they join.
        </DialogDescription>
        <Command className="rounded-lg border" value={active ?? chosen ?? ''} onValueChange={setActive} filter={(_login, search, words) => plainFilter('', search, words)}>
          <CommandInput placeholder="Search people…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Nobody by that name.</CommandEmpty>
            {choices.map((c) => (
              <CommandItem key={c.key} value={c.key} keywords={[c.person.name, handleOf(c.person)]} onSelect={() => setPicked(c.key)} className="gap-3 py-2">
                <PersonAvatar person={c.person} className="size-7 text-[10px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.person.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.hint}</span>
                </span>
                <Check className={cn('size-4', c.key === chosen ? 'opacity-100' : 'opacity-0')} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        {choice && (
          <p className="text-sm text-muted-foreground">
            {moved ? `${moved} ${/^1 \w+$/.test(moved) ? 'moves' : 'move'} to @${handleOf(choice.person)}.` : `${guest.name} becomes @${handleOf(choice.person)}.`} This can't be
            undone.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!choice || busy} onClick={() => void link()}>
            {busy && <Loader2 className="animate-spin" />} {choice ? `Link to @${handleOf(choice.person)}` : 'Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
