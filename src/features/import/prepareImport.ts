/**
 * What an import brings and the steps that save it, from what the app holds and what was read for the import. The
 * wizard (ImportPage.tsx) and the database test (tests/db/import-linear.test.ts) both go through here.
 */
import { ImportProblem, type ImportPlan } from '@/backend/importRows'
import type { DataState } from '@/data/store'
import { handleOf, isGuest } from '@/model/schema'
import type { LinearData } from './linearApi'
import { buildImport, existingFrom, type Existing, type ImportChoices, type ImportExtras, type ImportResult } from './linearMap'

export interface Prepared {
  existing: Existing
  result: ImportResult
  plan: ImportPlan
}

export interface PrepareOptions {
  /** the moment of the import, as ISO */
  now: string
  newId: () => string
  newGuestId: () => string
  /** the steps (backend.planImport in the app) */
  plan: (r: ImportResult, existing: Existing) => ImportPlan
}

type Store = Pick<DataState, 'me' | 'members' | 'people' | 'teams' | 'issues' | 'labels' | 'projects' | 'views' | 'comments'>

/** throws an ImportProblem, worded to show, when it can't go on */
export function prepareImport(store: Store, extras: ImportExtras, data: LinearData, choices: ImportChoices, o: PrepareOptions): Prepared {
  if (!store.me) throw new ImportProblem('Sign in first, then try again.')
  // someone picked on the people step who has left since
  for (const login of Object.values(choices.people)) {
    if (!login || isGuest(login)) continue
    const m = store.members[login]
    if (!m || m.removedAt) {
      throw new ImportProblem(`${store.people[login]?.name || handleOf(store.people[login] ?? { login })} isn't in this workspace any more. Go back to Who's who and pick someone else.`)
    }
  }
  const existing = existingFrom(store, extras, store.me.login)
  const result = buildImport(data, choices, existing, { newId: o.newId, newGuestId: o.newGuestId, now: o.now })
  return { existing, result, plan: o.plan(result, existing) }
}
