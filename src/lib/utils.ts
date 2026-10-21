import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The text sizes of our own in src/index.css (`@theme`, the type scale). Without them `cn` would read `text-ui` as
 * a colour and drop a `text-muted-foreground` next to it. tests/typeScale.test.ts checks the two lists match.
 */
export const TEXT_SIZES = ['label', 'ui', 'row-title', 'ref', 'prose', 'heading', 'title', 'issue-title', 'page-title', 'initials-sm', 'initials', 'initials-md'] as const

const twMerge = extendTailwindMerge({ extend: { theme: { text: [...TEXT_SIZES] } } })

/** join class names; later Tailwind classes win over earlier ones */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
