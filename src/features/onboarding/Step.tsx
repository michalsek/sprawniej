/** The frame for every onboarding screen: logo, progress dots, a title, the content, and the buttons. */
import type { ReactNode } from 'react'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/utils'

export function Step({ step, of, title, children, footer, wide }: { step?: number; of?: number; title: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-sidebar px-4 py-12">
      <div className={cn('w-full min-w-0 rounded-2xl border bg-background p-6 shadow-xl [overflow-wrap:anywhere] sm:p-10', wide ? 'max-w-2xl' : 'max-w-lg')}>
        <div className="mb-8 flex items-center gap-3">
          <Logo className="size-8" />
          <span className="text-title font-semibold tracking-tight">Sprawniej</span>
          {step !== undefined && of !== undefined && (
            <ol className="ml-auto flex gap-1.5" aria-label={`Step ${step} of ${of}`}>
              {Array.from({ length: of }, (_, i) => (
                <li key={i} className={cn('size-2 rounded-full bg-muted', i < step && 'bg-foreground')} />
              ))}
            </ol>
          )}
        </div>
        <h1 className="text-page-title font-semibold leading-tight">{title}</h1>
        <div className="mt-4 text-ui leading-relaxed text-foreground/85">{children}</div>
        {footer && <div className="mt-8 flex flex-wrap items-center gap-3">{footer}</div>}
      </div>
    </div>
  )
}

/** a short line of red text under a field, in plain words */
export function Problem({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  )
}
