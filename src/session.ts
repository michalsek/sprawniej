/**
 * Who is signed in and which workspace is open, in this browser only. The sign-in itself is kept by the database
 * client (src/backend/auth.ts); this remembers the workspace you had open and the ones you opened before, so a reload
 * comes back to the same place. Your profile is looked up again on every start, never stored here.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Person } from '@/model/schema'

export interface RecentWorkspace {
  id: string
  name: string
}

export interface Session {
  /** your profile as a person (null: not known yet, or no name picked yet). Not stored */
  user: Person | null
  /** your profile's id. Not stored */
  profileId: string | null
  workspaceId: string | null
  /** workspaces opened before, newest first */
  recent: RecentWorkspace[]
  /** whose these are (the signed-in account): someone else signing in here starts with none of them */
  owner: string | null
  /** called for whoever is signed in; another account than before forgets the workspaces */
  signedInAs: (userId: string) => void
  setProfile: (profileId: string | null, user: Person | null) => void
  /** opens it, and moves it to the top of `recent` (with its name as it is now) */
  open: (ws: RecentWorkspace) => void
  close: () => void
  /** a workspace that was deleted or that you left: off the list, and closed if it was open */
  forget: (id: string) => void
  signOut: () => void
  set: (patch: Partial<Pick<Session, 'user'>>) => void
}

export const useSession = create<Session>()(
  persist(
    (set) => ({
      user: null,
      profileId: null,
      workspaceId: null,
      recent: [],
      owner: null,
      signedInAs: (userId) =>
        set((s) => (s.owner === userId ? s : s.owner === null ? { owner: userId } : { owner: userId, user: null, profileId: null, workspaceId: null, recent: [] })),
      setProfile: (profileId, user) => set({ profileId, user }),
      open: (ws) => set((s) => ({ workspaceId: ws.id, recent: [ws, ...s.recent.filter((r) => r.id !== ws.id)].slice(0, 10) })),
      close: () => set({ workspaceId: null }),
      forget: (id) => set((s) => ({ workspaceId: s.workspaceId === id ? null : s.workspaceId, recent: s.recent.filter((r) => r.id !== id) })),
      signOut: () => set({ user: null, profileId: null, workspaceId: null, recent: [] }),
      set: (patch) => set(patch),
    }),
    { name: 'sprawniej-session-v2', partialize: (s) => ({ workspaceId: s.workspaceId, recent: s.recent, owner: s.owner }) },
  ),
)
