import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Guards the design system against contrast regressions: the dark `--tm-text-secondary`
// token previously sat at 4.20:1 (below WCAG AA) and was dimmer than `--tm-text-muted`
// (an inverted hierarchy). This test reads the real token values from styles.css and
// asserts every text token clears AA for normal text on its theme background, and
// that the primary > secondary > muted prominence order holds.
const CSS = readFileSync(
  fileURLToPath(new URL('../../../../extension-ui/src/tokens.css', import.meta.url)),
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
    const bg = token(block, '--tm-bg-base')
    const primary = token(block, '--tm-text-primary')

    it(`${themeName}: prominence order is primary > secondary > muted`, () => {
      const secondary = token(block, '--tm-text-secondary')
      const muted = token(block, '--tm-text-muted')
      const cPrimary = contrast(primary, bg)
      const cSecondary = contrast(secondary, bg)
      const cMuted = contrast(muted, bg)
      expect(cPrimary).toBeGreaterThan(cSecondary)
      expect(cSecondary).toBeGreaterThan(cMuted)
    })
  }
})

// The dark backgrounds sat 1.04 to 1.16:1 apart, so no region stood apart from its neighbour.
// Each one now differs from the canvas (--tm-bg-base) by a step the eye separates.
const canvas = token(rootBlock, '--tm-bg-base')
const againstCanvas = (name: string) => contrast(token(rootBlock, name), canvas)
const lighterThanCanvas = (name: string) =>
  relativeLuminance(token(rootBlock, name)) > relativeLuminance(canvas)

describe('dark background ladder', () => {
  it('recesses the side panels below the canvas', () => {
    expect(lighterThanCanvas('--tm-bg-surface')).toBe(false)
    expect(againstCanvas('--tm-bg-surface')).toBeGreaterThanOrEqual(1.1)
  })

  it('raises card, float and hover above the canvas in that order', () => {
    const raised = ['--tm-bg-card', '--tm-bg-elevated', '--tm-bg-card-hover']
    expect(raised.filter(lighterThanCanvas)).toEqual(raised)
    const [card, float, hover] = raised.map(againstCanvas)
    expect(card).toBeGreaterThanOrEqual(1.1)
    expect(float).toBeGreaterThan(card)
    expect(hover).toBeGreaterThan(float)
  })
})

describe('dark text tiers', () => {
  it('keeps every text tier at AA on the lightest background it sits on', () => {
    const hover = token(rootBlock, '--tm-bg-card-hover')
    const tiers = ['--tm-text-primary', '--tm-text-secondary', '--tm-text-muted', '--tm-danger']
    const belowAa = tiers.filter((name) => contrast(token(rootBlock, name), hover) < AA_NORMAL)
    expect(belowAa).toEqual([])
  })

  it('keeps secondary and muted text far enough apart to read as two tiers', () => {
    const secondary = token(rootBlock, '--tm-text-secondary')
    expect(contrast(secondary, token(rootBlock, '--tm-text-muted'))).toBeGreaterThanOrEqual(1.5)
  })
})
