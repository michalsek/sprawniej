import { toast } from 'sonner'

/** copies to the clipboard and says so */
export function copy(text: string, what: 'Link' | 'Message') {
  navigator.clipboard.writeText(text).then(
    () => toast(`${what} copied`),
    () => toast("Couldn't copy. Select the text and copy it yourself."),
  )
}
