/** One part of a settings page: a title, a line about it, and what it holds. */
import type { ReactNode } from 'react'

export function Section({ title, children, description }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b py-8 first:pt-0 last:border-0">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-[15px] text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}
