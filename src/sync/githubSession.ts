/**
 * The GitHub version's session (a GitHub key and a workspace repository), kept only so its code still compiles.
 * Nothing sets it any more and it isn't stored, so it is always empty: the screens that read it (the join wizard,
 * Settings › People, linking people) show nothing of it. Phase 10 deletes it with the rest of src/sync.
 */
import { create } from 'zustand'
import type { RepoRef } from '@/github/api'
import type { Person } from '@/model/schema'

export interface GitHubSession {
  token: string
  /** you, as GitHub knows you */
  user: Person | null
  workspace: RepoRef | null
  /** workspaces opened before, newest first */
  recent: RepoRef[]
  signIn: (token: string, user: Person) => void
  open: (ws: RepoRef) => void
  close: () => void
  signOut: () => void
}

export const useGitHubSession = create<GitHubSession>()((set) => ({
  token: '',
  user: null,
  workspace: null,
  recent: [],
  signIn: (token, user) => set({ token, user }),
  open: (ws) =>
    set((s) => ({
      workspace: ws,
      recent: [ws, ...s.recent.filter((r) => `${r.owner}/${r.repo}`.toLowerCase() !== `${ws.owner}/${ws.repo}`.toLowerCase())].slice(0, 10),
    })),
  close: () => set({ workspace: null }),
  signOut: () => set({ token: '', user: null, workspace: null, recent: [] }),
}))
