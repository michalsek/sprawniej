/**
 * A project's issue counts, for its progress ring and its issue count. Active and archived issues both count; the
 * archive is read once a page that shows progress opens (useArchiveForProgress), so the numbers can grow a moment
 * after the page shows. Every card reads its own counts from one shared table (projectCountsIndex), so a change to
 * one issue redraws only the cards whose numbers changed.
 */
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { loadArchive } from '@/backend'
import { NO_ISSUES, projectCountsIndex, type ProjectCounts } from '@/data/select'
import { useData } from '@/data/store'

export function useProjectCounts(project: string): Readonly<ProjectCounts> {
  return useData(useShallow((s) => projectCountsIndex(s.issues, s.archive).get(project) ?? NO_ISSUES))
}

/** read the archive, so archived issues count too: once on each page that shows progress */
export function useArchiveForProgress() {
  useEffect(() => loadArchive(), [])
}
