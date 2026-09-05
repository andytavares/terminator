import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// SC-011 / FR-004: every status distinction in the sidebar must survive
// greyscale. Colour may reinforce a state; it may never be the only thing
// carrying it (WCAG 1.4.1). This reads the real CSS and the real component so
// the guarantee cannot quietly rot into hue-only styling.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const ROW_CSS = read('../../../src/renderer/components/sidebar/BranchRow.css')
const ROW_TSX = read('../../../src/renderer/components/sidebar/BranchRow.tsx')

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

describe('sidebar status vocabulary survives greyscale (SC-011)', () => {
  it('separates the four states by glyph shape, which survives greyscale outright', () => {
    // The dot-at-three-opacities scheme this replaced could not distinguish
    // running from idle from waiting at all — one shape, one channel, and that
    // channel was spent on selection (audit SESS-1).
    const STATUS = read('../../../src/renderer/sidebar/session-status.ts')
    const icons = [...STATUS.matchAll(/icon:\s*'([a-z-]+)'/g)].map((m) => m[1])
    expect(icons).toHaveLength(4)
    expect(new Set(icons).size).toBe(4)
  })

  it('separates the four states on one opacity scale, defined once', () => {
    // The scale is a set of tokens rather than four literals, so the sidebar
    // gutter, the terminal tabs and the board lanes read the same values and
    // cannot drift apart.
    const TOKENS = read('../../../src/renderer/styles.css')
    const scale = ['awaiting', 'working', 'idle', 'exited'].map((state) => {
      const m = new RegExp(`--state-op-${state}:\\s*([\\d.]+);`).exec(TOKENS)
      if (!m) throw new Error(`missing --state-op-${state}`)
      return Number(m[1])
    })
    expect(scale).toEqual([...scale].sort((a, b) => b - a))
    expect(scale[0]).toBe(1)
    // Idle and exited must be told apart, not merely both dim.
    expect(Math.abs(scale[2] - scale[3])).toBeGreaterThanOrEqual(0.05)
  })

  it('puts no colour on the status glyph — shape is the only state channel', () => {
    const statusRules = [...ROW_CSS.matchAll(/\.branch-row__(gutter|state)[^{]*\{([^}]*)\}/g)]
    expect(statusRules.length).toBeGreaterThan(0)
    for (const [, , body] of statusRules) {
      expect(body).not.toMatch(/(^|\s)fill:/)
      // The gutter sets a text colour so the glyph inherits currentColor; what
      // it must never do is vary that colour by state.
      expect(body).not.toMatch(/color:\s*var\(--(danger|success|warning|accent)\)/)
    }
  })

  it('marks awaiting-input by emphasis in the gutter, not by an edge of its own', () => {
    // The needs-you bar used to be a left edge, which meant it overwrote the
    // repo's rail — two signals fighting for the same three pixels. The
    // emphasis moved into the status gutter, and the edge belongs to the repo.
    expect(ruleBody(ROW_CSS, '.branch-row__state--awaiting-input')).toMatch(
      /opacity:\s*var\(--state-op-awaiting\)/
    )
    expect(ROW_CSS).not.toMatch(/\.branch-row--needs-you/)
  })

  it('names the state in words, since a shape says nothing aloud', () => {
    expect(ROW_TSX).toMatch(/STATE_LABEL/)
    expect(ROW_TSX).toContain('Waiting on you')
  })

  it('uses no unicode glyphs for status — they font-fallback at a different baseline', () => {
    // The specific codepoints the design research warned against.
    for (const glyph of ['◐', '◆', '○', '⊗', '●', '◯']) {
      expect(ROW_TSX).not.toContain(glyph)
    }
  })

  it('uses no emoji anywhere in the row (Principle XII)', () => {
    expect(ROW_TSX).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })

  it('draws its status glyphs from lucide, sized by CSS rather than the size prop', () => {
    expect(ROW_TSX).toMatch(/from 'lucide-react'/)
    expect(ROW_TSX).not.toMatch(/size=\{/)
    expect(ROW_CSS).toMatch(/\.branch-row__gutter svg\s*\{[^}]*width:/)
  })

  it('never sets an explicit colour on an icon', () => {
    expect(ROW_CSS).not.toMatch(/\.branch-row__kind\s*svg\s*\{[^}]*color:/)
  })
})
