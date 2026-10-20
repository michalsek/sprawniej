/**
 * The formatter behind Markdown.tsx, loaded the first time it's needed. It shows checklists, tables, ~~struck~~ text
 * and bare links too (GitHub's Markdown), and a checklist's boxes can be ticked when `onTick` is given.
 */
import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface HastNode {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
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
  /** why a box can't be ticked, shown when you point at it */
  note?: string
}

const TicksContext = createContext<Ticks>({})

function Item({ node, className, children, ...rest }: ComponentProps<'li'> & { node?: HastNode }) {
  const line = node?.position?.start.line
  if (!className?.includes('task-list-item') || line === undefined) return <li className={className} {...rest}>{children}</li>
  return (
    <li className={className} {...rest}>
      <ItemContext.Provider value={{ line: line - 1, text: node ? itemText(node) : '' }}>{children}</ItemContext.Provider>
    </li>
  )
}

function Box({ checked, type, node: _node, ...rest }: ComponentProps<'input'> & { node?: unknown }) {
  const item = useContext(ItemContext)
  const { onTick, note } = useContext(TicksContext)
  if (type !== 'checkbox' || !item) return <input type={type} checked={checked} {...rest} />
  return (
    <label title={onTick ? undefined : note}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={!onTick}
        aria-label={item.text || 'Empty checklist item'}
        onChange={(e) => onTick?.(item.line, e.target.checked)}
      />
    </label>
  )
}

export default function MarkdownView({ children, components, ticks }: { children: string; components: Components; ticks: Ticks }): ReactNode {
  const all = useMemo(() => ({ ...components, li: Item, input: Box }), [components])
  return (
    <TicksContext.Provider value={ticks}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={all}>
        {children}
      </ReactMarkdown>
    </TicksContext.Provider>
  )
}
