/** Type @ to pick a person, by name or @handle. Inserts plain "@handle " text, with the handle they have now (see references.ts). */
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { PersonAvatar } from '@/components/Avatar'
import { useData } from '@/data/store'
import { plain } from '@/lib/plain'
import { handleOf, isGuest, type Person } from '@/model/schema'
import { popup } from './popup'

const key = new PluginKey('mention-suggest')

export const MentionSuggest = Extension.create({
  name: 'mentionSuggest',
  addProseMirrorPlugins() {
    return [
      Suggestion<Person, Person>({
        editor: this.editor,
        pluginKey: key,
        char: '@',
        items: ({ query }) => {
          const q = plain(query)
          // people from Linear who haven't joined can't be mentioned (nobody would hear it)
          return Object.values(useData.getState().people)
            .filter((p) => !isGuest(p.login) && (plain(handleOf(p)).includes(q) || plain(p.name).includes(q)))
            .slice(0, 6)
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, `@${handleOf(props)} `).run()
        },
        render: popup<Person>(key, {
          label: 'People',
          width: 'w-64',
          keyOf: (p) => p.login,
          row: (p) => (
            <>
              <PersonAvatar person={p} />
              <span className="truncate">{p.name}</span>
              <span className="ml-auto truncate text-muted-foreground">@{handleOf(p)}</span>
            </>
          ),
        }),
      }),
    ]
  },
})
