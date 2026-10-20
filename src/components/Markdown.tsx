/**
 * Shows Markdown as formatted text: checklists, tables, struck text and bare links too. The formatter loads the first
 * time it's needed (MarkdownView.tsx); until then the text shows as-is.
 */
import { lazy, Suspense, type ComponentProps } from 'react'
import type { Ticks } from './MarkdownView'
import { usePictureUrl } from '@/data/assets'
import { linkReferences } from '@/data/mentions'
import { findArchivedByRef, findByRef, useData } from '@/data/store'

const MarkdownView = lazy(() => import('./MarkdownView'))

/** @people and ENG-12 references look the same as in the editor; other links open in a new tab */
function A({ href = '', children, node: _node, ...rest }: ComponentProps<'a'> & { node?: unknown }) {
  if (href.startsWith('#@')) return <span className="mention">{children}</span>
  if (href.startsWith('#/issue/')) return <a href={href} className="issue-ref no-underline" title={(findByRef(useData.getState().issues, href.slice(8)) ?? findArchivedByRef(useData.getState(), href.slice(8)))?.title}>{children}</a>
  return <a href={href} target="_blank" rel="noreferrer" {...rest}>{children}</a>
}

/** workspace pictures show once their address is here, with a grey space until then */
function Img({ src, alt }: ComponentProps<'img'> & { node?: unknown }) {
  const { url, missing } = usePictureUrl(typeof src === 'string' ? src : undefined)
  if (url) return <img src={url} alt={alt ?? ''} loading="lazy" />
  if (missing) return <span className="text-xs text-muted-foreground">This picture can’t be shown.</span>
  // a grey space until it arrives; named like the picture, or left out for screen readers when it has no name
  const named = alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true }
  return <span className="inline-block h-24 w-40 rounded-md bg-muted" {...named} />
}

const COMPONENTS = { a: A, img: Img }
const NO_TICKS: Ticks = {}

/**
 * `references`: highlight @people and issue references (comments, descriptions). `ticks`: checklist boxes can be
 * ticked (`onTick`, with the line from 0), or why not (`note`).
 */
export function Markdown({ children, references, ticks = NO_TICKS }: { children: string; references?: boolean; ticks?: Ticks }) {
  // a string, so this only redraws when the result changes
  const text = useData((s) => (references ? linkReferences(children, s.people, (ref) => !!findByRef(s.issues, ref) || !!findArchivedByRef(s, ref)) : children))
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{children}</p>}>
      <MarkdownView components={COMPONENTS} ticks={ticks}>
        {text}
      </MarkdownView>
    </Suspense>
  )
}
