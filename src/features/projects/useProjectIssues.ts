/** Issues for project progress: active and archived ones both count (the archive is read when a project page opens). */
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { loadArchive } from '@/backend'
import { useData } from '@/data/store'
import type { Issue } from '@/model/schema'

export function useProgressIssues(project?: string): Issue[] {
  useEffect(() => loadArchive(), [])
  return useData(
    useShallow((s) => {
      const fits = (i: Issue) => !project || i.project === project
      return [...Object.values(s.issues).filter(fits), ...Object.values(s.archive).filter((a) => fits(a) && !s.issues[a.id])]
    }),
  )
}
