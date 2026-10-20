/**
 * What Settings › Statuses says for each kind of status: its groups (names, what they decide, an idea for splitting
 * one), how many things have each status, and what Default means. Project statuses add their entry here.
 */
import type { DataState } from '@/data/store'
import { PROJECT_STATUS_NAMES } from '@/features/projects/status'
import { CATEGORIES, PROJECT_CATEGORIES, type StatusKind } from '@/model/status'

/** a group as the page shows it: its name, what it decides, and an idea for splitting it */
export interface GroupInfo {
  id: string
  name: string
  description: string
  /** "like Testing or Design review", for a group with one status ('' says nothing) */
  example: string
}

/** what the page says for each kind of status */
export interface KindText {
  groups: GroupInfo[]
  /** how many things of this kind have each status, by status id (none yet: no count shows) */
  uses?: (s: Pick<DataState, 'issues' | 'projects'>) => ReadonlyMap<string, number>
  /** "1 issue", "3 issues" */
  count: (n: number) => string
  /** what Default means, in a tooltip */
  defaultHint: string
}

const ISSUE_EXAMPLES: Record<string, string> = {
  backlog: 'like Ideas or Later',
  todo: 'like Ready or Next up',
  in_progress: 'like Testing or Design review',
  in_review: 'like Code review or QA',
  done: 'like Released',
  canceled: 'like Won’t do or Not now',
  duplicate: 'like Already reported',
}

const tally = (ids: Iterable<string>) => {
  const out = new Map<string, number>()
  for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1)
  return out
}

export const KIND_TEXT: Record<StatusKind, KindText> = {
  issue: {
    groups: CATEGORIES.map((c) => ({ id: c.id, name: c.name, description: c.description, example: ISSUE_EXAMPLES[c.id] ?? '' })),
    // open issues (the archive isn't read until something needs it)
    uses: (s) => tally(Object.values(s.issues).map((i) => i.statusId)),
    count: (n) => (n === 1 ? '1 issue' : `${n} issues`),
    defaultHint: 'Issues that come into this group without a status of their own (from GitHub or the import) get this one',
  },
  // project statuses: their descriptions, examples and count come with them
  project: {
    groups: PROJECT_CATEGORIES.map((id) => ({ id, name: PROJECT_STATUS_NAMES[id], description: '', example: '' })),
    count: (n) => (n === 1 ? '1 project' : `${n} projects`),
    defaultHint: 'Projects that come into this group without a status of their own get this one',
  },
}
