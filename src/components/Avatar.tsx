/** A person's picture, or their initials on a stable colour when there is none (or it can't be loaded). */
import { useState } from 'react'
import type { Person } from '@/model/schema'
import { cn } from '@/lib/utils'
import { initials, personColor } from '@/lib/person'

export function PersonAvatar({ person, login, className }: { person?: Person; login?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false)
  const box = cn('inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-semibold text-white', className)
  const key = person?.login ?? login
  if (!key) {
    return (
      <span className={cn(box, 'border border-dashed border-muted-foreground/60')} aria-label="No assignee" />
    )
  }
  if (person?.avatarUrl && !broken) {
    return <img src={person.avatarUrl} alt={person.name} className={box} onError={() => setBroken(true)} />
  }
  return (
    <span className={box} style={{ background: personColor(key) }} aria-label={person?.name ?? key}>
      {initials(person?.name || key)}
    </span>
  )
}
