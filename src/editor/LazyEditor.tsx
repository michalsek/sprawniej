/**
 * The editor is the biggest part of the app, so it loads on its own the first time it's needed (or a moment after
 * the workspace opens, see load.ts). Until then the field shows the text as-is.
 */
import { lazy, Suspense, type ComponentProps } from 'react'
import type { Editor as RealEditor } from './Editor'
import { cn } from '@/lib/utils'
import { loadEditor } from './load'

const Real = lazy(() => loadEditor().then((m) => ({ default: m.Editor })))

export function Editor(props: ComponentProps<typeof RealEditor>) {
  return (
    <Suspense fallback={<div className={cn('prose-sprawniej editor-fallback min-h-6 whitespace-pre-wrap text-muted-foreground', props.className)}>{props.value}</div>}>
      <Real {...props} />
    </Suspense>
  )
}
