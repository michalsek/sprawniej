/**
 * @people in Markdown. They stay plain "@handle" text in descriptions and comments, so they read well anywhere.
 * Only the handles people in the workspace have now count, case aside: after someone changes theirs, text that says
 * their old one is plain text (and may mention whoever takes it next).
 */
import { handleOf, isGuest, TEAM_KEY, type Person } from '@/model/schema'

export const MENTION = /(^|[^\w@/.])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g
export const ISSUE_REF = new RegExp(`\\b(${TEAM_KEY}-\\d+)\\b`, 'g')

const indexes = new WeakMap<Record<string, Person>, Map<string, string>>()

/** each person's handle now (lower case) → their login; people from Linear who haven't joined have none */
function handleIndex(people: Record<string, Person>): Map<string, string> {
  let index = indexes.get(people)
  if (!index) {
    index = new Map()
    for (const p of Object.values(people)) if (!isGuest(p.login)) index.set(handleOf(p).toLowerCase(), p.login)
    indexes.set(people, index)
  }
  return index
}

/** whose @handle this is now (their login), case aside; undefined: nobody's */
export const resolveHandle = (handle: string, people: Record<string, Person>): string | undefined => handleIndex(people).get(handle.toLowerCase())

/** the people (logins) a piece of Markdown mentions, skipping code */
export function mentionedLogins(markdown: string, people: Record<string, Person>): string[] {
  const out = new Set<string>()
  for (const m of withoutCode(markdown).matchAll(MENTION)) {
    const login = resolveHandle(m[2], people)
    if (login) out.add(login)
  }
  return [...out]
}

/** logins mentioned in `after` but not in `before` */
export function newMentions(before: string, after: string, people: Record<string, Person>): string[] {
  const old = new Set(mentionedLogins(before, people))
  return mentionedLogins(after, people).filter((l) => !old.has(l))
}

/** blank out ``` blocks and `inline code`, keeping the length so positions still match */
export function withoutCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?(```|$)|`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

/**
 * For showing Markdown: turns @people into `[@bob](#@bob)` (the login after the #) and issue references into
 * `[ENG-12](#/issue/ENG-12)`, leaving code and existing links alone. Only real people and issues (`isIssue`) are linked.
 */
export function linkReferences(markdown: string, people: Record<string, Person>, isIssue: (ref: string) => boolean): string {
  const mask = withoutCode(markdown).replace(/\[[^\]\n]*\]\([^)\n]*\)|<[a-z]+:[^>\n]*>|\bhttps?:\/\/\S+/gi, (m) => ' '.repeat(m.length))
  const edits: { at: number; len: number; text: string }[] = []
  for (const m of mask.matchAll(MENTION)) {
    const login = resolveHandle(m[2], people)
    if (login) edits.push({ at: m.index + m[1].length, len: m[2].length + 1, text: `[@${m[2]}](#@${login})` })
  }
  for (const m of mask.matchAll(ISSUE_REF)) if (isIssue(m[1])) edits.push({ at: m.index, len: m[1].length, text: `[${m[1]}](#/issue/${m[1]})` })
  let out = markdown
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len)
  return out
}
