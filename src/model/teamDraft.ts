import { TEAM_KEY_PATTERN } from './schema'

export interface TeamDraft {
  name: string
  key: string
  emoji: string
}

export const teamDraftOk = (d: TeamDraft, takenKeys: string[] = []) => !!d.name.trim() && TEAM_KEY_PATTERN.test(d.key) && !takenKeys.includes(d.key)
