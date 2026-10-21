/** An issue's project on a row or card: its emoji and name in a small chip. Nothing while the project isn't known. */
import { Box } from 'lucide-react'
import { useData } from '@/data/store'
import { cn } from '@/lib/utils'

export function ProjectChip({ id, className }: { id: string | null; className?: string }) {
  const project = useData((s) => (id ? s.projects[id] : undefined))
  if (!project) return null
  return (
    <span className={cn('inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md border px-1.5 text-xs text-muted-foreground', className)} title={project.name}>
      {project.emoji ? <span className="shrink-0 text-sm leading-none" aria-hidden>{project.emoji}</span> : <Box className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{project.name}</span>
    </span>
  )
}
