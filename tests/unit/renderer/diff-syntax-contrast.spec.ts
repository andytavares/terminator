import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// TAV-8: code/diff windows had too-low contrast, especially text rendered over
// red/green added/removed diff-line highlights. This asserts every text-bearing
// token (base text tokens, semantic danger/success, and the syntax-highlight
// tokens) clears WCAG AA (4.5:1) both on the plain code background and on the
// added/removed diff-line tinted backgrounds, in both themes.
const CSS = readFileSync(
  fileURLToPath(new URL('../../../src/renderer/styles.css', import.meta.url)),
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

const TEXT_TOKENS = ['--text-primary', '--text-secondary', '--text-muted', '--danger', '--success']

const SYNTAX_TOKENS = [
  '--syntax-comment',
  '--syntax-keyword',
  '--syntax-string',
  '--syntax-tag',
  '--syntax-literal',
  '--syntax-number',
  '--syntax-title',
  '--syntax-attribute',
]

describe('diff / syntax token contrast (WCAG AA)', () => {
  for (const [themeName, block] of [
    ['dark', rootBlock],
    ['light', lightBlock],
  ] as const) {
    const bg = hexToRgb(token(block, '--bg-base'))
    const added = rgbaToken(rootBlock, '--diff-added-bg')
    const removed = rgbaToken(rootBlock, '--diff-removed-bg')
    const addedBg = composite(bg, added.rgb, added.alpha)
    const removedBg = composite(bg, removed.rgb, removed.alpha)

    it(`${themeName}: text tokens meet AA over base, added, and removed diff backgrounds`, () => {
      for (const name of TEXT_TOKENS) {
        const value = hexToRgb(token(block, name))
        expect(contrast(value, bg), `${themeName} ${name} vs base`).toBeGreaterThanOrEqual(
          AA_NORMAL
        )
        expect(contrast(value, addedBg), `${themeName} ${name} vs added-bg`).toBeGreaterThanOrEqual(
          AA_NORMAL
        )
        expect(
          contrast(value, removedBg),
          `${themeName} ${name} vs removed-bg`
        ).toBeGreaterThanOrEqual(AA_NORMAL)
      }
    })

    it(`${themeName}: syntax-highlight tokens meet AA over base, added, and removed diff backgrounds`, () => {
      for (const name of SYNTAX_TOKENS) {
        const value = hexToRgb(token(block, name))
        expect(contrast(value, bg), `${themeName} ${name} vs base`).toBeGreaterThanOrEqual(
          AA_NORMAL
        )
        expect(contrast(value, addedBg), `${themeName} ${name} vs added-bg`).toBeGreaterThanOrEqual(
          AA_NORMAL
        )
        expect(
          contrast(value, removedBg),
          `${themeName} ${name} vs removed-bg`
        ).toBeGreaterThanOrEqual(AA_NORMAL)
      }
    })
  }
})
