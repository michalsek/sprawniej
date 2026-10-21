/** Whether the "Join your teams" popup is up (the first-visit tour waits for it), and who skipped it where. */
import { create } from 'zustand'
import { localStore } from '@/lib/storage'

export const useJoinTeams = create<{ open: boolean }>()(() => ({ open: false }))

const key = (workspace: string, login: string) => `sprawniej:teams-skipped:${workspace}:${login}`
export const skippedJoining = (workspace: string, login: string) => localStore.getItem(key(workspace, login)) === '1'
export const skipJoining = (workspace: string, login: string) => localStore.setItem(key(workspace, login), '1')
