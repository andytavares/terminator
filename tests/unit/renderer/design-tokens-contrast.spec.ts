import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Guards the design system against contrast regressions: the dark `--text-secondary`
// token previously sat at 4.20:1 (below WCAG AA) and was dimmer than `--text-muted`
// (an inverted hierarchy). This test reads the real token values from styles.css and
// asserts every text token clears AA for normal text on its theme background, and
// that the primary > secondary > muted prominence order holds.
const CSS = readFileSync(
  fileURLToPath(new URL('../../../src/renderer/styles.css', import.meta.url)),
  'utf8'
)

function relativeLuminance(hex: string): number {
  const c = hex.replace('#', '')
  const channel = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Extract a hex token value from a specific CSS block. */
function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`token ${name} not found`)
  return m[1]
}

const rootBlock = CSS.slice(CSS.indexOf(':root'), CSS.indexOf("[data-theme='light']"))
const lightBlock = CSS.slice(CSS.indexOf("[data-theme='light']"))

const AA_NORMAL = 4.5

describe('design token contrast (WCAG AA)', () => {
  for (const [themeName, block] of [
    ['dark', rootBlock],
    ['light', lightBlock],
  ] as const) {
    const bg = token(block, '--bg-base')
    const primary = token(block, '--text-primary')

    it(`${themeName}: all text tokens meet AA on --bg-base`, () => {
      for (const name of ['--text-primary', '--text-secondary', '--text-muted']) {
        const value = token(block, name)
        expect(
          contrast(value, bg),
          `${themeName} ${name} (${value}) on ${bg}`
        ).toBeGreaterThanOrEqual(AA_NORMAL)
      }
    })

    it(`${themeName}: prominence order is primary > secondary > muted`, () => {
      const secondary = token(block, '--text-secondary')
      const muted = token(block, '--text-muted')
      const cPrimary = contrast(primary, bg)
      const cSecondary = contrast(secondary, bg)
      const cMuted = contrast(muted, bg)
      expect(cPrimary).toBeGreaterThan(cSecondary)
      expect(cSecondary).toBeGreaterThan(cMuted)
    })
  }
})
