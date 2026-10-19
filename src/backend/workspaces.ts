/** The workspaces you are in, and making a new one. */
import type { TeamDraft } from '@/model/teamDraft'
import { requireClient, type Db } from './client'

export interface WorkspaceInfo {
  id: string
  name: string
  createdAt: string
}

/** the database rules show only the workspaces you are in */
export async function myWorkspaces(): Promise<WorkspaceInfo[]> {
  const { data, error } = await requireClient().from('workspaces').select('id,name,created_at').order('name')
  if (error) throw error
  return data.map((w) => ({ id: w.id, name: w.name, createdAt: w.created_at }))
}

/** a new workspace with you as its owner and its first team; returns its id (`db`: the database tests' own) */
export async function createWorkspace(name: string, team: TeamDraft, db: Db = requireClient()): Promise<string> {
  const { data, error } = await db.rpc('create_workspace', {
    p_name: name.trim(),
    p_team_key: team.key,
    p_team_name: team.name.trim(),
    p_team_emoji: team.emoji,
  })
  if (error) throw error
  return data
}
