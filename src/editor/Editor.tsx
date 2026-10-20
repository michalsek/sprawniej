/**
 * The rich text editor for descriptions and comments. It formats as you type (**bold**, "# " headings, "- " lists,
 * "[] " checklists, "> " quotes, ``` code), and "/" opens a list of what you can add (SlashMenu.tsx: headings, lists,
 * checklists, quotes, code, tables, a divider). It turns pasted links into links (paste a link onto selected words to
 * link them), and stores plain Markdown (content.ts says what it can hold).
 *
 * Saving: `onChange` gets the Markdown a moment after you stop typing, and at once when you leave the field. Only
 * your own edits are saved: clicking in and out again saves nothing. A teammate's change shows up here too (merged
 * into yours if you're writing here).
 *
 * Ticking a checklist box (checklist.ts) doesn't put the cursor in the text. With `onTick`, a tick made while
 * nothing else is waiting to be saved goes on its own (only that box), so it never undoes a teammate's tick or text;
 * otherwise it's saved with the rest of the text.
 */
import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extensions'
import { toast } from 'sonner'
import { addImage, type ChecklistTick } from '@/data/actions'
import { openable, setChecked, tickFrom } from '@/data/checklist'
import { cn } from '@/lib/utils'
import { MentionSuggest } from './MentionSuggest'
import { References } from './references'
import { SlashMenu } from './SlashMenu'
import { TICK, type TickMeta } from './checklist'
import { contentExtensions } from './content'
import { tidyMarkdown } from './tidy'
import { onBeforeHide } from '@/lib/beforeHide'
import { mergeText } from './mergeText'
import { hasPending, savedMarkdown, settlePicture } from './picture'

const SAVE_AFTER = 400

interface Props {
  value: string
  onChange: (markdown: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** ⌘/Ctrl + Enter, with the text as it is right now */
  onSubmit?: (markdown: string) => void
  /** the field's accessible name */
  label?: string
  /** a checklist box ticked (or unticked) on its own: true when it was saved that way */
  onTick?: (tick: ChecklistTick) => boolean
}

export function Editor({ value, onChange, placeholder = 'Add a description…', autoFocus, className, onSubmit, label = 'Description', onTick }: Props) {
  const lastSent = useRef(value)
  /** you changed something since the last save */
  const dirty = useRef(false)
  /**
   * The editor's own Markdown for what it last showed or saved. A change that leaves it the same is no change: the
   * empty line the editor adds after a list or table when you click in, for one.
   */
  const shown = useRef<string | null>(null)
  /** a teammate's change came while a picture was still being added: it's taken in once the picture is */
  const waiting = useRef(false)
  const latestValue = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const changeRef = useRef(onChange)
  const submitRef = useRef(onSubmit)
  const tickRef = useRef(onTick)
  useEffect(() => {
    changeRef.current = onChange
    submitRef.current = onSubmit
    tickRef.current = onTick
  })

  const editor = useEditor({
    extensions: [...contentExtensions(), Placeholder.configure({ placeholder }), Markdown, References, MentionSuggest, SlashMenu],
    content: openable(value),
    contentType: 'markdown',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'prose-sprawniej tiptap-editor outline-none', 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' },
      handlePaste: (_view, event) => addPictures(event.clipboardData?.files) || pasteMarkdown(event),
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        return addPictures(event.dataTransfer?.files, at)
      },
      handleKeyDown: (_view, event) => {
        // ⌘ Shift Enter ticks a checklist item (checklist.ts)
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey && submitRef.current) {
          flush()
          submitRef.current(lastSent.current)
          return true
        }
        return false
      },
    },
    onCreate: ({ editor }) => {
      shown.current = markdownOf(editor)
    },
    onUpdate: ({ editor, transaction }) => {
      const tick = transaction.getMeta(TICK) as TickMeta | undefined
      if (tick && saveTick(editor, tick)) return
      if (!dirty.current && markdownOf(editor) === shown.current) return
      dirty.current = true
      saveLater()
    },
    onBlur: () => flush(),
  })

  // the paste handler is set up once; it finds the editor here
  const editorRef = useRef(editor)
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  /**
   * Plain text that's written in Markdown (from a README, a note, a chat) comes in formatted, the way it will look
   * once saved. Text copied from a web page (it brings its own formatting) and text pasted into code is left alone.
   */
  function pasteMarkdown(event: ClipboardEvent): boolean {
    const editor = editorRef.current
    const data = event.clipboardData
    if (!editor || !data || data.types.includes('text/html') || editor.isActive('codeBlock')) return false
    const text = data.getData('text/plain')
    if (!looksLikeMarkdown(text)) return false
    return editor.commands.insertContent(openable(text), { contentType: 'markdown' })
  }

  /**
   * Pasted or dropped pictures go in at once, where they landed, and never in place of anything: after what's
   * selected, or where they were dropped, with the cursor after them. Each is saved once it's kept with the
   * workspace, and taken out again (with a note why) if it can't be.
   */
  function addPictures(files: FileList | undefined, at?: number): boolean {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/'))
    const editor = editorRef.current
    if (!list.length || !editor || editor.isDestroyed) return false
    const added = list.map((file) => ({ file, token: crypto.randomUUID() }))
    const nodes = added.map(({ file, token }) => ({ type: 'image', attrs: { src: null, alt: file.name.replace(/\.[^.]+$/, ''), pending: token } }))
    editor
      .chain()
      .focus()
      .insertContentAt(at ?? editor.state.selection.to, nodes)
      .run()
    for (const { file, token } of added) {
      addImage(file, (src) => settlePicture(editor, token, { src })).then(
        () => {
          settlePicture(editor, token, { pending: null })
          pictureDone()
        },
        (e: Error) => {
          settlePicture(editor, token, null)
          pictureDone()
          toast(e.message)
        },
      )
    }
    return true
  }

  /** a picture is in (or out): a teammate's change that waited for it shows now */
  function pictureDone() {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed || !waiting.current || hasPending(editor.state.doc)) return
    waiting.current = false
    takeTheirs(latestValue.current)
  }

  /**
   * A box ticked while nothing else waits to be saved: just that box is saved (`onTick`), when the text here is the
   * saved text with only this box changed (tickFrom, src/data/checklist.ts).
   */
  function saveTick(editor: TiptapEditor, tick: TickMeta): boolean {
    const save = tickRef.current
    if (!save || waiting.current) return false
    const before = lastSent.current
    const now = markdownOf(editor)
    const t = tickFrom(before, now, tick, dirty.current)
    if (!t) return false
    // first: the saved tick comes back here as the new text, and must read as ours, not as a teammate's change
    lastSent.current = setChecked(before, t.index, t.checked)
    if (!save({ ...t, before })) {
      lastSent.current = before
      return false
    }
    shown.current = now
    // nothing else was waiting after all
    if (now === lastSent.current) {
      dirty.current = false
      clearTimeout(timer.current)
    }
    return true
  }

  function saveLater() {
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_AFTER)
  }

  function flush() {
    clearTimeout(timer.current)
    // a teammate's change still waits to be merged in: saving now would undo it
    if (!editor || editor.isDestroyed || !dirty.current || waiting.current) return
    dirty.current = false
    const md = markdownOf(editor)
    shown.current = md
    if (md === lastSent.current) return
    lastSent.current = md
    changeRef.current(md)
  }

  // leaving the page while a save is waiting: send it now
  useEffect(() => () => flush(), [editor]) // oxlint-disable-line react-hooks/exhaustive-deps
  // closing or hiding the tab right after typing: the same
  useEffect(() => onBeforeHide(() => flush()), [editor]) // oxlint-disable-line react-hooks/exhaustive-deps

  /**
   * Someone else changed it: show the new text. If you're writing here, their change is merged into yours line by
   * line (yours wins where you both changed the same lines), so saving your text never undoes theirs.
   */
  function takeTheirs(value: string) {
    if (!editor || editor.isDestroyed || value === lastSent.current) return
    // a picture is still being added: replacing the text now would take it out
    if (hasPending(editor.state.doc)) {
      waiting.current = true
      return
    }
    const base = lastSent.current
    lastSent.current = value
    if (!dirty.current && !editor.isFocused) {
      editor.commands.setContent(openable(value), { contentType: 'markdown', emitUpdate: false })
      shown.current = markdownOf(editor)
      return
    }
    const mine = dirty.current ? markdownOf(editor) : base
    const merged = mine === base ? value : mergeText(base, mine, value)
    if (merged === mine) return
    replaceChanged(editor, merged)
    if (!dirty.current) shown.current = markdownOf(editor)
    // what you added is still to be saved: `lastSent` is their text, the editor has both
    if (merged !== value) {
      dirty.current = true
      saveLater()
    }
  }
  useEffect(() => {
    latestValue.current = value
    takeTheirs(value)
  }, [value, editor]) // oxlint-disable-line react-hooks/exhaustive-deps

  return <EditorContent editor={editor} className={cn('min-h-24 cursor-text', className)} />
}

/** the Markdown the editor would save now */
const markdownOf = (editor: TiptapEditor) => tidyMarkdown(savedMarkdown(editor))

/** headings, lists, checklists, quotes, code fences, bold or links at the start of a line or inline */
const looksLikeMarkdown = (text: string) => /^(#{1,6} |[-*+] |\d+\. |> |```|[-*] \[[ xX]\] )/m.test(text) || /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)/.test(text)

/**
 * Show new text in an editor you're typing in by replacing only the part that differs, so your cursor moves along
 * with your own words (a teammate's line above them pushes it down instead of leaving it behind).
 */
function replaceChanged(editor: NonNullable<ReturnType<typeof useEditor>>, markdown: string) {
  const json = editor.markdown?.parse(openable(markdown))
  if (!json) {
    editor.commands.setContent(openable(markdown), { contentType: 'markdown', emitUpdate: false })
    return
  }
  const next = editor.schema.nodeFromJSON(json)
  const { doc, tr } = editor.state
  const start = doc.content.findDiffStart(next.content)
  if (start === null) return
  let { a: endA, b: endB } = doc.content.findDiffEnd(next.content)!
  // the same characters on both sides of the change: keep the ends from crossing the start
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  tr.replace(start, endA, next.slice(start, endB))
  tr.setMeta('preventUpdate', true)
  editor.view.dispatch(tr)
}
