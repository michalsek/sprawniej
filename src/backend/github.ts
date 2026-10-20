/**
 * The repositories whose pull requests move this workspace's issues (Settings › GitHub, admins only;
 * docs/github-app.md). Like invite links, these are awaited calls, read when Settings opens: they aren't live.
 */
import { ISSUE_CATEGORIES, type IssueCategory } from '@/model/status'
import { requireClient } from './client'
import { friendlyDbError } from './problem'
import { RULES } from './workspaces'

/** what happened with the latest pull request (github_apply writes it) */
export interface LastPullRequest {
  number: number | null
  url: string | null
  title: string
  /** the author's GitHub login */
  login: string | null
  to: IssueCategory | null
  /** the issues it named */
  refs: string[]
  /** the issues that moved */
  moved: string[]
  /** nothing moved: the author isn't in the workspace with GitHub */
  skipped: boolean
}

export interface GitHubRepo {
  id: string
  /** owner/name */
  repo: string
  addedBy: string | null
  createdAt: string
  lastAt: string | null
  last: LastPullRequest | null
}

const COLUMNS = 'id, repo, added_by, created_at, last_event_at, last_event'

const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** reads what github_apply wrote, whatever shape it has */
export function readLast(v: unknown): LastPullRequest | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  return {
    number: typeof e.number === 'number' ? e.number : null,
    url: typeof e.url === 'string' && e.url.startsWith('https://') ? e.url : null,
    title: typeof e.title === 'string' ? e.title : '',
    login: typeof e.login === 'string' ? e.login : null,
    to: ISSUE_CATEGORIES.find((s) => s === e.to) ?? null,
    refs: texts(e.refs),
    moved: texts(e.moved),
    skipped: e.skipped === 'author',
  }
}

/** GitHub's rules for an owner (up to 39 letters, digits and dashes) and a repository name */
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/

/**
 * "owner/name" from what someone typed or pasted: "acme/web", "github.com/acme/web" or
 * "https://github.com/acme/web.git". Null when it isn't one.
 */
export function repoFromInput(input: string): string | null {
  const s = input
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/(\.git)?\/*$/i, '')
  const [owner, name, ...rest] = s.split('/')
  if (rest.length && rest.some(Boolean)) {
    // a link to something inside the repository (…/acme/web/pull/3): the repository it's in
    return REPO.test(`${owner}/${name}`) ? `${owner}/${name}` : null
  }
  return REPO.test(s) ? s : null
}

/** newest first; empty for members (the rules show them to admins only) */
export async function listRepos(ws: string): Promise<GitHubRepo[]> {
  const { data, error } = await requireClient()
    .from('github_repos')
    .select(COLUMNS)
    .eq('workspace_id', ws)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    repo: r.repo,
    addedBy: r.added_by,
    createdAt: r.created_at,
    lastAt: r.last_event_at,
    last: readLast(r.last_event),
  }))
}

/** throws an Error whose message can be shown as it is */
export async function connectRepo(ws: string, repo: string): Promise<void> {
  const { error } = await requireClient().from('github_repos').insert({ workspace_id: ws, repo })
  if (error?.code === '42501') throw new Error(RULES.notGitHub)
  if (error?.code === '23505') throw new Error(`${repo} is already connected.`)
  if (error?.code === '23514') throw new Error('That isn’t a repository. Write it as owner/name, for example acme/website.')
  if (error) throw new Error(friendlyDbError(error, "We couldn't connect the repository. Try again in a moment."))
}

/** throws an Error whose message can be shown as it is */
export async function disconnectRepo(id: string): Promise<void> {
  const { data, error } = await requireClient().from('github_repos').delete().eq('id', id).select('id')
  if (error) throw new Error(friendlyDbError(error, "We couldn't remove the repository. Try again in a moment."))
  if (!data.length) throw new Error('That repository was already removed.')
}
