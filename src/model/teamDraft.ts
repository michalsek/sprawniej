import { TEAM_KEY_PATTERN } from './schema'

export interface TeamDraft {
  name: string
  key: string
  emoji: string
}

/** team keys: 1 to 7 capital letters or digits, starting with a letter (ENG, DES, MOBILE2) */
export const KEY_PATTERN = TEAM_KEY_PATTERN

export const teamDraftOk = (d: TeamDraft, takenKeys: string[] = []) => !!d.name.trim() && KEY_PATTERN.test(d.key) && !takenKeys.includes(d.key)
