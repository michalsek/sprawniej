/** Contrast between two CSS colours (#hex or oklch(…)), as WCAG measures it. */

export const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
/** an oklch colour's linear sRGB, clipped to what a screen shows (as browsers do) */
function oklchLinear(color: string): number[] {
  const [l, c, h] = (/oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/.exec(color) ?? []).slice(1).map(Number)
  const [L, a, b] = [l / 100, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
  const [lc, mc, sc] = [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.291485548 * b].map((x) => x ** 3)
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ].map((x) => Math.min(1, Math.max(0, x)))
}
const luminance = (color: string) => {
  const [r, g, b] = color.startsWith('oklch')
    ? oklchLinear(color)
    : channels(color).map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
