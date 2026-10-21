/** Shows a suggestion's PickList under the cursor, for @ (MentionSuggest.tsx) and / (SlashMenu.tsx). Esc closes it. */
import type { Editor } from '@tiptap/core'
import type { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import { exitSuggestion, type SuggestionKeyDownProps, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { PickList, type ListLook, type PickListHandle } from './PickList'

/** what's on screen, for a suggestion that handles a key itself */
export interface Shown<T> {
  editor: Editor
  items: T[]
  current: T | undefined
}

/** under the cursor, inside the screen (above the line when there's no room below) */
function place(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return
  const view = window.visualViewport
  const width = view?.width ?? window.innerWidth
  const height = view?.height ?? window.innerHeight
  el.style.position = 'fixed'
  el.style.zIndex = '60'
  const box = { width: el.offsetWidth || 240, height: el.offsetHeight || 288 }
  el.style.left = `${Math.max(8, Math.min(rect.left, width - box.width - 8))}px`
  const below = rect.bottom + 4
  el.style.top = `${below + box.height > height - 8 && rect.top - box.height - 4 > 8 ? rect.top - box.height - 4 : below}px`
}

/**
 * The suggestion's `render`. `keyDown` sees a key before the list does: true or false says it was handled or not,
 * nothing passes it on to the list.
 */
export function popup<T>(
  key: PluginKey,
  look: ListLook<T>,
  keyDown?: (props: SuggestionKeyDownProps, shown: Shown<T>) => boolean | undefined,
): NonNullable<SuggestionOptions<T, T>['render']> {
  return () => {
    let renderer: ReactRenderer<PickListHandle<T>> | null = null
    let editor: Editor | null = null
    let items: T[] = []
    const close = () => {
      renderer?.destroy()
      renderer?.element.remove()
      renderer = null
    }
    return {
      onStart: (props: SuggestionProps<T, T>) => {
        editor = props.editor
        items = props.items
        renderer = new ReactRenderer(PickList<T>, { props: { ...props, ...look }, editor: props.editor })
        document.body.appendChild(renderer.element)
        place(renderer.element, props.clientRect?.())
      },
      onUpdate: (props: SuggestionProps<T, T>) => {
        // the list for what was just typed is still being worked out: keep showing the last one
        if (props.loading) return
        items = props.items
        renderer?.updateProps(props)
        if (renderer) place(renderer.element, props.clientRect?.())
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === 'Escape' && renderer) {
          close()
          exitSuggestion(props.view, key)
          return true
        }
        const handled = editor ? keyDown?.(props, { editor, items, current: renderer?.ref?.current() }) : undefined
        if (handled !== undefined) return handled
        return renderer?.ref?.onKeyDown(props.event) ?? false
      },
      onExit: close,
    }
  }
}
