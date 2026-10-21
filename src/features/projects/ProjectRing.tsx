/** A project's progress ring, from its counts (useProjectCounts); its tooltip says it in words (progressWords). */
import { useMemo } from 'react'
import { ProgressRing } from '@/components/ProgressRing'
import type { RingTip } from '@/components/ringTip'
import { progressOf, type ProjectCounts } from '@/data/select'
import { progressWords } from './progressText'

interface Props {
  counts: Readonly<ProjectCounts>
  tip?: RingTip
  still?: boolean
  focusable?: boolean
}

export function ProjectRing({ counts, ...rest }: Props) {
  const { done, total } = progressOf(counts)
  const lines = useMemo(() => progressWords(counts), [counts])
  return <ProgressRing done={done} total={total} lines={lines} {...rest} />
}
