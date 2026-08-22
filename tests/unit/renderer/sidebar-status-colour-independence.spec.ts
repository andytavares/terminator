import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// SC-011 / FR-004: every status distinction in the sidebar must survive
// greyscale. Colour may reinforce a state; it may never be the only thing
// carrying it (WCAG 1.4.1). This reads the real CSS and the real component so
// the guarantee cannot quietly rot into hue-only styling.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const ROW_CSS = read('../../../src/renderer/components/sidebar/SessionRow.css')
const ROW_TSX = read('../../../src/renderer/components/sidebar/SessionRow.tsx')

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

describe('sidebar status vocabulary survives greyscale (SC-011)', () => {
  it('separates the three dot states by opacity, not only by hue', () => {
    const dim = ruleBody(ROW_CSS, '.session-row__dot--dim')
    const exited = ruleBody(ROW_CSS, '.session-row__dot--exited')
    expect(dim).toMatch(/opacity:\s*0?\.\d+/)
    expect(exited).toMatch(/opacity:\s*0?\.\d+/)
    // Different enough to tell apart with colour removed.
    const value = (body: string) => Number(/opacity:\s*([\d.]+)/.exec(body)![1])
    expect(Math.abs(value(dim) - value(exited))).toBeGreaterThanOrEqual(0.15)
  })

  it('marks awaiting-input with a shape cue — a left edge bar', () => {
    expect(ruleBody(ROW_CSS, '.session-row--needs-you')).toMatch(/box-shadow:\s*inset\s+3px/)
  })

  it('marks awaiting-input with a text cue as well as the bar', () => {
    expect(ROW_TSX).toContain('needs you')
    expect(ROW_TSX).toMatch(/needsYou && <span className="session-row__needs-you-pill">/)
  })

  it('gives the needs-you pill a border, so it reads as a pill without colour', () => {
    expect(ruleBody(ROW_CSS, '.session-row__needs-you-pill')).toMatch(/border:\s*1px solid/)
  })

  it('uses no unicode glyphs for status — they font-fallback at a different baseline', () => {
    // The specific codepoints the design research warned against.
    for (const glyph of ['◐', '◆', '○', '⊗', '●', '◯']) {
      expect(ROW_TSX).not.toContain(glyph)
    }
  })

  it('draws every icon with lucide, never an emoji (Principle XII)', () => {
    expect(ROW_TSX).toMatch(/from 'lucide-react'/)
    // eslint-disable-next-line no-control-regex
    expect(ROW_TSX).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })

  it('never sets an explicit colour on an icon', () => {
    expect(ROW_CSS).not.toMatch(/\.session-row__prefix\s*\{[^}]*color:/)
  })
})
