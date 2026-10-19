/**
 * The import that is saving (or just ended), kept outside the wizard: following a link while it saves and coming
 * back to Settings › Import shows it again, instead of a fresh start. Closing the tab while it saves asks first.
 */
import { create } from 'zustand'
import { ImportProblem } from '@/backend/importRows'
import { importFromLinear } from '@/data/actions'
import type { LinearData } from './linearApi'
import type { ImportChoices, ImportResult } from './linearMap'
import type { Prepared } from './prepareImport'

export type ImportRun =
  | { at: 'saving'; saved: number; total: number }
  | { at: 'done'; counts: ImportResult['counts']; keys: string[]; nothing: boolean }
  /** what it was importing, so Try again can work it out again */
  | { at: 'failed'; message: string; data: LinearData; choices: ImportChoices }

export const useImportRun = create<{ run: ImportRun | null }>(() => ({ run: null }))

const hold = (e: BeforeUnloadEvent) => e.preventDefault()

/** saves `prepared`; what happens shows in useImportRun */
export async function startImport(prepared: Prepared, data: LinearData, choices: ImportChoices): Promise<void> {
  const set = (run: ImportRun | null) => useImportRun.setState({ run })
  const keys = [...new Set(Object.values(choices.teamKeys))]
  set({ at: 'saving', saved: 0, total: prepared.plan.total })
  window.addEventListener('beforeunload', hold)
  try {
    const changed = await importFromLinear(prepared.plan, (saved, total) => set({ at: 'saving', saved, total }))
    set({ at: 'done', counts: prepared.result.counts, keys, nothing: changed === 0 })
  } catch (e) {
    if (!(e instanceof ImportProblem)) console.error('Sprawniej couldn’t finish the import', e)
    const message = e instanceof ImportProblem ? e.message : 'Something went wrong, so the import stopped partway.'
    set({ at: 'failed', message, data, choices })
  } finally {
    window.removeEventListener('beforeunload', hold)
  }
}

/** the wizard is left: an import that ended (and was shown) is forgotten; one still saving stays */
export function leaveImport() {
  if (useImportRun.getState().run?.at !== 'saving') useImportRun.setState({ run: null })
}
