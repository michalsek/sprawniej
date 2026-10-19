/** People by their database id, for the few screens that get ids (invite links, people from Linear). */
import { registry } from '@/backend/registry'
import type { Person } from '@/model/schema'
import type { DataState } from './store'

/** the person a profile id stands for here, if we know them */
export function personById(s: Pick<DataState, 'people'>, id: string | null): Person | undefined {
  const login = id ? registry.login(id) : undefined
  return login ? s.people[login] : undefined
}

/** a person's profile id here, if we know them */
export const profileIdOf = (login: string): string | undefined => registry.profileId(login)
