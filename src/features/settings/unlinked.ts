/** People the Linear import brought who haven't joined yet (not linked to a member), and what they have here. */
import { useShallow } from 'zustand/react/shallow'
import { useData, type DataState } from '@/data/store'
import { isGuest, type Person } from '@/model/schema'

/** "12 issues and 30 comments": what a person from Linear has here (issues they're assigned to or made); '' for none */
export function workOf(s: Pick<DataState, 'issues' | 'comments'>, login: string): string {
  const issues = Object.values(s.issues).filter((i) => i.assignee === login || i.createdBy === login).length
  const comments = Object.values(s.comments).reduce((n, list) => n + list.filter((c) => c.author === login).length, 0)
  const n = (count: number, one: string) => (count ? [`${count} ${one}${count === 1 ? '' : 's'}`] : [])
  return [...n(issues, 'issue'), ...n(comments, 'comment')].join(' and ')
}

const unlinked = (p: Person) => isGuest(p.login)

/** whether anyone from Linear hasn't joined yet (Settings lists People from Linear only then) */
export const hasUnlinked = (s: Pick<DataState, 'people'>): boolean => Object.values(s.people).some(unlinked)

/** the people from Linear who haven't joined yet */
export function useUnlinked(): Person[] {
  return useData(useShallow((s) => Object.values(s.people).filter(unlinked).sort((a, b) => a.name.localeCompare(b.name))))
}
