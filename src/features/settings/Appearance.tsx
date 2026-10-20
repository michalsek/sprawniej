/** Settings › Profile: System, Light or Dark. Shows at once and saves by itself (setTheme). */
import type { ReactNode } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Segmented } from '@/components/Segmented'
import { setTheme } from '@/data/actions'
import { useTheme, type ThemeChoice } from '@/lib/theme'

// the words show on phones too: three short ones fit
const OPTIONS = [
  { value: 'system', name: 'System', label: <><Monitor /> System</> },
  { value: 'light', name: 'Light', label: <><Sun /> Light</> },
  { value: 'dark', name: 'Dark', label: <><Moon /> Dark</> },
] satisfies { value: ThemeChoice; name: string; label: ReactNode }[]

export function Appearance() {
  const choice = useTheme((s) => s.choice)
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium">Appearance</h2>
      <Segmented label="Appearance" value={choice} onChange={setTheme} options={OPTIONS} />
      <p className="mt-2 text-sm text-muted-foreground">System follows your device. Your choice follows you to every device you sign in on.</p>
    </div>
  )
}
