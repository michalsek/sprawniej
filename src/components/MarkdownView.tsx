/**
 * The formatter behind Markdown.tsx, loaded the first time it's needed. It shows checklists, tables, ~~struck~~ text
 * and bare links too (GitHub's Markdown), and a checklist's boxes can be ticked when `onTick` is given (Ticks).
 */
import { Children, createContext, isValidElement, useContext, useId, useMemo, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface HastNode {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
  properties?: Record<string, unknown>
  position?: { start: { line: number } }
}

const textOf = (n: HastNode): string => (n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(textOf).join(''))
/** what an item says, for its box's name (not the items nested in it) */
const itemText = (li: HastNode) =>
  (li.children ?? [])
    .filter((c) => c.tagName !== 'ul' && c.tagName !== 'ol')
    .map(textOf)
    .join('')
    .trim()

const PLUGINS = [remarkGfm]

/** the item a box belongs to: its line in the text (from 0) and what it says */
const ItemContext = createContext<{ line: number; text: string } | null>(null)

export interface Ticks {
  /** a box was ticked (or unticked) on this line of the text, from 0; without it, boxes can't be ticked */
  onTick?: (line: number, checked: boolean) => void
  /** the lines whose boxes can be ticked (all, when not given) */
  lines?: readonly number[]
  /** why the other boxes can't be ticked: read out with the box, shown when you point at it or tap it */
  note?: string
}

const TicksContext = createContext<Ticks & { noteId?: string }>({})

const isList = (n: ReactNode) => isValidElement(n) && (n.type === 'ul' || n.type === 'ol')
/** the item's own box, not one of the items under it */
const ownBox = (n: HastNode): HastNode | undefined =>
  n.tagName === 'input' ? n : (n.children ?? []).filter((c) => c.tagName !== 'ul' && c.tagName !== 'ol').map(ownBox).find(Boolean)

function Item({ node, className, children, ...rest }: ComponentProps<'li'> & { node?: HastNode }) {
  const line = node?.position?.start.line
  if (!node || !className?.includes('task-list-item') || line === undefined) return <li className={className} {...rest}>{children}</li>
  const all = Children.toArray(children)
  const done = !!ownBox(node)?.properties?.checked
  return (
    <li className={cn(className, done && 'done')} {...rest}>
      <ItemContext.Provider value={{ line: line - 1, text: itemText(node) }}>
        <div className="task-text">{all.filter((c) => !isList(c))}</div>
        {all.filter(isList)}
      </ItemContext.Provider>
    </li>
  )
}

function Box({ checked, type, node: _node, ...rest }: ComponentProps<'input'> & { node?: unknown }) {
  const item = useContext(ItemContext)
  const { onTick, lines, note, noteId } = useContext(TicksContext)
  if (type !== 'checkbox' || !item) return <input type={type} checked={checked} {...rest} />
  const tickable = !!onTick && (!lines || lines.includes(item.line))
  return (
    <label className="task-box" title={tickable ? undefined : note}>
      <input
        type="checkbox"
        checked={!!checked}
        aria-disabled={tickable ? undefined : true}
        aria-label={item.text || 'Empty checklist item'}
        aria-describedby={tickable ? undefined : noteId}
        onChange={(e) => tickable && onTick(item.line, e.target.checked)}
        onClick={(e) => {
          if (tickable) return
          // it stays as it is; a tap says why (on a phone there's nothing to point at)
          e.preventDefault()
          if (note) toast(note)
        }}
      />
    </label>
  )
}

export default function MarkdownView({ children, components, ticks }: { children: string; components: Components; ticks: Ticks }): ReactNode {
  const all = useMemo(() => ({ ...components, li: Item, input: Box, table: Table }), [components])
  const noteId = useId()
  const context = useMemo(() => ({ ...ticks, noteId: ticks.note ? noteId : undefined }), [ticks, noteId])
  return (
    <TicksContext.Provider value={context}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={all}>
        {children}
      </ReactMarkdown>
      {ticks.note && (
        <span id={noteId} className="sr-only">
          {ticks.note}
        </span>
      )}
    </TicksContext.Provider>
  )
}

/** a wide table scrolls sideways on its own, and stays a table for screen readers */
function Table({ node: _node, ...rest }: ComponentProps<'table'> & { node?: unknown }) {
  return (
    <div className="table-scroll">
      <table {...rest} />
    </div>
  )
}
