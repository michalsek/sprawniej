/** The first-visit tour's state: which tip is showing. Once finished or skipped it stays away (Help can replay it). */
import { create } from 'zustand'
import { localStore } from '@/lib/storage'

const DONE = 'sprawniej:tour-done'

export const useTour = create<{ step: number | null }>()(() => ({ step: null }))

export const tourDone = () => localStore.getItem(DONE) === '1'

export function endTour() {
  localStore.setItem(DONE, '1')
  useTour.setState({ step: null })
}

export function replayTour() {
  localStore.removeItem(DONE)
  useTour.setState({ step: 0 })
}
