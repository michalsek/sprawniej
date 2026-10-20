/**
 * The GitHub pull requests that mention an issue, under its title (docs/github-app.md). The GitHub webhook keeps
 * them; they change here as soon as a pull request opens, turns into a draft, is merged or closed. Nothing to edit.
 */
import { useData } from '@/data/store'
import { pullStateName } from './format'
import { PullRequestIcon } from './icons'

export function PullRequests({ issueId }: { issueId: string }) {
  const pulls = useData((s) => s.pullRequests[issueId])
  if (!pulls?.length) return null
  // the repository's name only says something when they come from more than one
  const repos = new Set(pulls.map((p) => p.repo)).size > 1
  return (
    <ul className="mt-2 flex flex-col gap-0.5" aria-label="Pull requests">
      {pulls.map((p) => (
        <li key={`${p.repo}#${p.number}`} className="min-w-0">
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            title={`${p.repo}#${p.number}`}
            className="group -mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <PullRequestIcon state={p.state} />
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {repos && `${p.repo.split('/')[1]} `}#{p.number}
            </span>
            <span className="min-w-0 truncate">{p.title || 'Pull request'}</span>
            <span className="shrink-0 text-muted-foreground">· {pullStateName(p.state)}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
