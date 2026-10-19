/**
 * The rich text editor for descriptions and comments. It formats as you type (**bold**, "- " lists, "[] " checklists,
 * ``` code), turns pasted links into links (paste a link onto selected words to link them), and stores plain Markdown.
 *
 * Saving: `onChange` gets the Markdown a moment after you stop typing, and at once when you leave the field. Only
 * your own edits are saved: clicking in and out again saves nothing. A teammate's change shows up here too (merged
 * into yours if you're writing here).
 */
import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight } from 'lowlight'
import { toast } from 'sonner'
import { addImage } from '@/data/actions'
import { cn } from '@/lib/utils'
import { MentionSuggest } from './MentionSuggest'
import { References } from './references'
import { LANGUAGES } from './languages'
import { tidyMarkdown } from './tidy'
import { onBeforeHide } from '@/lib/beforeHide'
import { mergeText } from './mergeText'
import { hasPending, Picture, savedMarkdown, settlePicture } from './picture'

const lowlight = createLowlight(LANGUAGES)

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
}

export function Editor({ value, onChange, placeholder = 'Add a description…', autoFocus, className, onSubmit, label = 'Description' }: Props) {
  const lastSent = useRef(value)
  /** you changed something since the last save */
  const dirty = useRef(false)
  /** a teammate's change came while a picture was still being added: it's taken in once the picture is */
  const waiting = useRef(false)
  const latestValue = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const changeRef = useRef(onChange)
  const submitRef = useRef(onSubmit)
  useEffect(() => {
    changeRef.current = onChange
    submitRef.current = onSubmit
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' },
      }),
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Markdown,
      References,
      MentionSuggest,
      Picture,
    ],
    content: value,
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
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && submitRef.current) {
          flush()
          submitRef.current(lastSent.current)
          return true
        }
        return false
      },
    },
    onUpdate: () => {
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
    return editor.commands.insertContent(text, { contentType: 'markdown' })
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

  function saveLater() {
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_AFTER)
  }

  function flush() {
    clearTimeout(timer.current)
    // a teammate's change still waits to be merged in: saving now would undo it
    if (!editor || editor.isDestroyed || !dirty.current || waiting.current) return
    dirty.current = false
    const md = tidyMarkdown(savedMarkdown(editor))
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
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
      return
    }
    const mine = dirty.current ? tidyMarkdown(savedMarkdown(editor)) : base
    const merged = mine === base ? value : mergeText(base, mine, value)
    if (merged === mine) return
    replaceChanged(editor, merged)
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

/** headings, lists, checklists, quotes, code fences, bold or links at the start of a line or inline */
const looksLikeMarkdown = (text: string) => /^(#{1,6} |[-*+] |\d+\. |> |```|[-*] \[[ xX]\] )/m.test(text) || /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)/.test(text)

/**
 * Show new text in an editor you're typing in by replacing only the part that differs, so your cursor moves along
 * with your own words (a teammate's line above them pushes it down instead of leaving it behind).
 */
function replaceChanged(editor: NonNullable<ReturnType<typeof useEditor>>, markdown: string) {
  const json = editor.markdown?.parse(markdown)
  if (!json) {
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })
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
