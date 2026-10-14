import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// TAV-8: code/diff windows had too-low contrast, especially text rendered over
// red/green added/removed diff-line highlights. This asserts every text-bearing
// token (base text tokens, semantic danger/success, and the syntax-highlight
// tokens) clears WCAG AA (4.5:1) both on the plain code background and on the
// added/removed diff-line tinted backgrounds, in both themes.
const CSS = readFileSync(
  fileURLToPath(new URL('../../../packages/extension-ui/src/tokens.css', import.meta.url)),
  'utf8'
)

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '')
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
}

function composite(
  bg: [number, number, number],
  fg: [number, number, number],
  alpha: number
): [number, number, number] {
  return [
    bg[0] * (1 - alpha) + fg[0] * alpha,
    bg[1] * (1 - alpha) + fg[1] * alpha,
    bg[2] * (1 - alpha) + fg[2] * alpha,
  ]
}

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`token ${name} not found`)
  return m[1]
}

function rgbaToken(block: string, name: string): { rgb: [number, number, number]; alpha: number } {
  const m = block.match(
    new RegExp(`${name}:\\s*rgba\\(\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\s*\\)`)
  )
  if (!m) throw new Error(`rgba token ${name} not found`)
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) }
}

const rootBlock = CSS.slice(CSS.indexOf(':root'), CSS.indexOf("[data-theme='light']"))
const lightBlock = CSS.slice(CSS.indexOf("[data-theme='light']"))

const AA_NORMAL = 4.5

const TEXT_TOKENS = [
  '--tm-text-primary',
  '--tm-text-secondary',
  '--tm-text-muted',
  '--tm-danger',
  '--tm-success',
]

const SYNTAX_TOKENS = [
  '--tm-syntax-comment',
  '--tm-syntax-keyword',
  '--tm-syntax-string',
  '--tm-syntax-tag',
  '--tm-syntax-literal',
  '--tm-syntax-number',
  '--tm-syntax-title',
  '--tm-syntax-attribute',
]

/** A theme's base background, and its added and removed diff tints laid over it. */
function diffBackgrounds(block: string) {
  const bg = hexToRgb(token(block, '--tm-bg-base'))
  // Each theme's own tints: the light theme defines darker ones than the dark theme.
  const added = rgbaToken(block, '--tm-diff-added-bg')
  const removed = rgbaToken(block, '--tm-diff-removed-bg')
  return {
    base: bg,
    'added-bg': composite(bg, added.rgb, added.alpha),
    'removed-bg': composite(bg, removed.rgb, removed.alpha),
  }
}

/** Every token in `names` reads at AA over each of the theme's diff backgrounds. */
function expectAAOverDiffs(themeName: string, block: string, names: readonly string[]): void {
  const backgrounds = Object.entries(diffBackgrounds(block))
  for (const name of names) {
    const value = hexToRgb(token(block, name))
    for (const [label, background] of backgrounds) {
      expect(
        contrast(value, background),
        `${themeName} ${name} vs ${label}`
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  }
}

describe('diff / syntax token contrast (WCAG AA)', () => {
  for (const [themeName, block] of [
    ['dark', rootBlock],
    ['light', lightBlock],
  ] as const) {
    it(`${themeName}: text tokens meet AA over base, added, and removed diff backgrounds`, () => {
      expectAAOverDiffs(themeName, block, TEXT_TOKENS)
    })

    it(`${themeName}: syntax-highlight tokens meet AA over base, added, and removed diff backgrounds`, () => {
      expectAAOverDiffs(themeName, block, SYNTAX_TOKENS)
    })
  }
})
