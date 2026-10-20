/** Keyboard shortcuts that work anywhere in the app (not while typing in a field). The Help page lists them. */
import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { openComposer } from '@/features/issues/composer'
import { clearSelection, toggleSelected, useSelection } from '@/features/issues/selection'
import { openPalette, targetIssue, usePalette, type QuickField } from './palette'

/** typing in a field, or a dialog/menu is open: leave the key alone */
export function isBusy(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (t?.closest('input, textarea, select, [contenteditable="true"]')) return true
  return !!document.querySelector('[role=dialog], [role=menu], [role=listbox], [data-slot=popover-content]')
}

const QUICK: Record<string, QuickField> = { s: 'status', p: 'priority', a: 'assignee', l: 'labels', e: 'estimate' }

/** move keyboard focus to the next or previous issue in the list or board */
function step(by: 1 | -1) {
  const all = [...document.querySelectorAll<HTMLElement>('main [data-issue-id]')]
  if (!all.length) return
  const at = all.findIndex((el) => el === document.activeElement || el.contains(document.activeElement))
  const next = all[at === -1 ? (by === 1 ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, at + by))]
  next.focus()
  next.scrollIntoView({ block: 'nearest' })
}

export function useShortcuts() {
  const [location, navigate] = useLocation()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K works everywhere, even while typing
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!usePalette.getState().open) usePalette.setState({ quick: null })
        usePalette.setState((s) => ({ open: !s.open }))
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isBusy(e)) return
      const key = e.key.toLowerCase()
      // during a keyboard drag the arrows move the issue (or the favourite, in the sidebar)
      const dragging = !!document.querySelector('[aria-pressed="true"][data-issue-id], [aria-pressed="true"][data-favourite-id]')
      // Esc during a keyboard drag only puts the issue or favourite back (the drag may have ended just before this)
      if (key === 'escape' && (dragging || e.defaultPrevented)) return
      if (key === 'c') {
        e.preventDefault()
        openComposer()
      } else if (QUICK[key]) {
        // picked issues first; otherwise the one under the mouse, focused, or open
        const picked = useSelection.getState().ids
        const issue = targetIssue()
        const issues = picked.length && (!issue || picked.includes(issue)) ? picked : issue ? [issue] : []
        if (!issues.length) return
        e.preventDefault()
        usePalette.setState({ quick: { issues, field: QUICK[key] } })
      } else if (key === 'x') {
        const issue = targetIssue()
        if (!issue || !document.querySelector(`main [data-issue-id="${issue}"]`)) return
        e.preventDefault()
        toggleSelected(issue)
      } else if (key === 'escape' && useSelection.getState().ids.length) {
        e.preventDefault()
        clearSelection()
      } else if (key === 'j' || (key === 'arrowdown' && !dragging)) {
        e.preventDefault()
        step(1)
      } else if (key === 'k' || (key === 'arrowup' && !dragging)) {
        e.preventDefault()
        step(-1)
      } else if (key === 'escape' && location.startsWith('/issue/')) {
        e.preventDefault()
        if (history.length > 1) history.back()
        else navigate('/')
      } else if (key === '/') {
        e.preventDefault()
        openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [location, navigate])
}
