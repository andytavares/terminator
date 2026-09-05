import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WORKSPACE_PRESET_COLORS } from '../../../src/renderer/components/sidebar/workspace-colors'

/**
 * The repo's colour used to wash every surface in the sidebar — 10% on a group
 * header, 5% on a row at rest, 14% on hover, 22% on selection — and it painted
 * the header's text as well. This asserts that it now appears in exactly two
 * places, a 2px rail and a small swatch, and that what it left behind is
 * neutral (FR-040 to FR-045).
 *
 * The contrast guarantee the wash version carried is kept rather than deleted
 * with the washes. It is simpler to check now: with no `color-mix` left there
 * is nothing a browser would resolve differently from this arithmetic, and the
 * text sits on flat theme tokens rather than on a tinted composite.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const ROW_CSS = read('../../../src/renderer/components/sidebar/BranchRow.css')
const HEAD_CSS = read('../../../src/renderer/components/sidebar/RepoHeader.css')
const HEAD_TSX = read('../../../src/renderer/components/sidebar/RepoHeader.tsx')
const TOKENS = read('../../../src/renderer/styles.css')

const SIDEBAR_CSS = ROW_CSS + '\n' + HEAD_CSS

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

// ── Colour maths ─────────────────────────────────────────────

type Rgb = [number, number, number]

function hex(value: string): Rgb {
  const h = value.trim().replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const f = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Reads a token out of a `:root` or `[data-theme='light']` block. */
function token(name: string, theme: 'dark' | 'light'): string {
  const block =
    theme === 'dark'
      ? TOKENS.slice(TOKENS.indexOf(':root {'), TOKENS.indexOf("[data-theme='light']"))
      : TOKENS.slice(TOKENS.indexOf("[data-theme='light']"))
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(block)
  if (!m) throw new Error(`token not found: ${name} (${theme})`)
  return m[1].trim()
}

describe('the repo colour is one rail, not a wash (FR-040, FR-041)', () => {
  it('washes nothing: no colour-mix of the repo colour survives anywhere', () => {
    expect(SIDEBAR_CSS).not.toMatch(/color-mix\([^)]*--ws-color/)
  })

  it('uses the repo colour only as a rail and a swatch', () => {
    const uses = [...SIDEBAR_CSS.matchAll(/^\s*([a-z-]+):\s*[^;]*var\(--ws-color[^;]*;/gm)].map(
      (m) => m[1]
    )
    expect(new Set(uses)).toEqual(new Set(['box-shadow', 'background']))
  })

  it('draws the rail as a 2px inset edge on the row', () => {
    expect(ruleBody(ROW_CSS, '.branch-row')).toMatch(
      /box-shadow:\s*inset 2px 0 0 var\(--ws-color, transparent\)/
    )
  })

  it('spells the fallback, so a row with no repo is not left unpainted', () => {
    // An unresolved custom property invalidates the whole declaration at
    // computed-value time, not just that term — without the fallback the
    // surface would lose its background entirely.
    for (const use of SIDEBAR_CSS.matchAll(/var\(--ws-color([^)]*)\)/g)) {
      expect(use[1]).toMatch(/,\s*transparent/)
    }
  })
})

describe('hover and selection are neutral (FR-042)', () => {
  it.each([
    ['.branch-row:hover', ROW_CSS],
    ['.branch-row--selected', ROW_CSS],
    ['.repo-header:hover', HEAD_CSS],
  ])('%s uses a theme surface rather than the repo colour', (selector, css) => {
    const body = ruleBody(css, selector)
    expect(body).toMatch(/background:\s*var\(--bg-[a-z-]+\)/)
    expect(body).not.toMatch(/--ws-color/)
  })
})

describe('the repo name is text, not colour (FR-043)', () => {
  it('never paints the name in the repo colour', () => {
    expect(ruleBody(HEAD_CSS, '.repo-header__name')).not.toMatch(/color:/)
    expect(ruleBody(HEAD_CSS, '.repo-header')).toMatch(/color:\s*var\(--text-primary\)/)
  })

  it('gives the colour a swatch of its own instead', () => {
    expect(HEAD_TSX).toContain('repo-header__swatch')
    expect(ruleBody(HEAD_CSS, '.repo-header__swatch')).toMatch(
      /background:\s*var\(--ws-color, transparent\)/
    )
  })

  /**
   * The defect this fixes. Painting a repo name in its own swatch put the text
   * between 1.08:1 and 1.52:1 against the surface behind it in the light theme,
   * measured in a browser — against the 4.5:1 AA asks for. Every preset failed;
   * the fix is to stop using the swatch as a text colour at all.
   */
  it.each(['dark', 'light'] as const)(
    'every preset repo colour would have failed AA as text in the %s theme',
    (theme) => {
      const surface = hex(token('--bg-base', theme))
      const failing = WORKSPACE_PRESET_COLORS.filter((c) => contrast(hex(c), surface) < 4.5)
      expect(failing.length).toBeGreaterThan(0)
    }
  )

  it.each(['dark', 'light'] as const)('the name token clears AA in the %s theme', (theme) => {
    const surface = hex(token('--bg-base', theme))
    expect(contrast(hex(token('--text-primary', theme)), surface)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['dark', 'light'] as const)(
    'the name still clears AA on the selected surface in the %s theme',
    (theme) => {
      const surface = hex(token('--bg-card-hover', theme))
      expect(contrast(hex(token('--text-primary', theme)), surface)).toBeGreaterThanOrEqual(4.5)
    }
  )

  it.each(['dark', 'light'] as const)(
    'the muted meta text clears AA on the hover surface in the %s theme',
    (theme) => {
      const surface = hex(token('--bg-elevated', theme))
      expect(contrast(hex(token('--text-muted', theme)), surface)).toBeGreaterThanOrEqual(4.5)
    }
  )
})
