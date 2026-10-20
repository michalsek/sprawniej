/** The words Settings › GitHub uses for what the latest pull request did. Pure, so it's unit-tested (tests/githubRepos.test.ts). */
import type { LastPullRequest } from '@/backend/github'
import { statusOf } from '@/model/status'

/** "ENG-1", "ENG-1 and ENG-2", "ENG-1, ENG-2 and ENG-3" */
export function listRefs(refs: string[]): string {
  if (refs.length < 2) return refs[0] ?? ''
  return `${refs.slice(0, -1).join(', ')} and ${refs[refs.length - 1]}`
}

/** what follows "#12" on a connected repository's line */
export function lastText(last: LastPullRequest): string {
  if (last.skipped) {
    const who = last.login ? `@${last.login}` : 'its author'
    return `moved nothing: ${who} isn't in this workspace with GitHub as a way to sign in`
  }
  if (last.moved.length && last.to) return `moved ${listRefs(last.moved)} to ${statusOf(last.to).name}`
  if (!last.refs.length) return 'mentions no issue'
  return `moved nothing: ${listRefs(last.refs.slice(0, 3))}${last.refs.length > 3 ? ' and more' : ''} ${last.refs.length === 1 ? 'is' : 'are'} already further along, archived or not here`
}
