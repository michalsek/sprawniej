/** Settings › Profile: System, Light or Dark. Shows at once and saves by itself (setTheme). */
import { Monitor, Moon, Sun } from 'lucide-react'
import { Segmented, type SegmentedOption } from '@/components/Segmented'
import { setTheme } from '@/data/actions'
import { useTheme, type ThemeChoice } from '@/lib/theme'

// the words show on phones too: three short ones fit, so each button is named by its words
const OPTIONS: SegmentedOption<ThemeChoice>[] = [
  { value: 'system', label: <><Monitor /> System</> },
  { value: 'light', label: <><Sun /> Light</> },
  { value: 'dark', label: <><Moon /> Dark</> },
]

export function Appearance() {
  const choice = useTheme((s) => s.choice)
  return (
    <div>
      <h2 className="mb-1.5 text-sm font-medium">Appearance</h2>
      <Segmented label="Appearance" value={choice} onChange={setTheme} options={OPTIONS} />
      <p className="mt-1.5 text-sm text-muted-foreground">System follows your device. Your choice follows you to every device you sign in on.</p>
    </div>
  )
}
