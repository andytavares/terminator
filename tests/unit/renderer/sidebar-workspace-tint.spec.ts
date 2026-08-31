import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WORKSPACE_PRESET_COLORS } from '../../../src/renderer/components/sidebar/workspace-colors'

// The sidebar's rows say which project and which branch they belong to, but a
// flat list of projects gave the workspace only one channel: the header's text
// colour. This reads the real CSS and asserts the workspace's colour also
// washes the surfaces — and that the wash stays a tint, so no text token it
// sits under drops out of WCAG AA for any preset, in either theme.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const GROUP_CSS = read('../../../src/renderer/components/sidebar/SessionGroup.css')
const WS_CSS = read('../../../src/renderer/components/sidebar/WorkspaceRow.css')
const ROW_CSS = read('../../../src/renderer/components/sidebar/SessionRow.css')
const ROW_TSX = read('../../../src/renderer/components/sidebar/SessionRow.tsx')
const SIDEBAR_TSX = read('../../../src/renderer/components/sidebar/UnifiedSidebar.tsx')
const TOKENS = read('../../../src/renderer/styles.css')

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

/** The workspace share of a `color-mix` wash, and what it is mixed into. */
function wash(css: string, selector: string): { percent: number; over: string } {
  const body = ruleBody(css, selector)
  const m =
    /background:\s*color-mix\(in srgb,\s*var\(--ws-color,\s*transparent\)\s*(\d+)%,\s*(.*)\)\s*;/.exec(
      body
    )
  if (!m) throw new Error(`no workspace wash on ${selector}: ${body}`)
  return { percent: Number(m[1]), over: m[2].trim() }
}

// ── Colour maths (same method as design-tokens-contrast.spec.ts) ──

type Rgb = [number, number, number]

function toRgb(hex: string): Rgb {
  const c = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) as Rgb
}

/** sRGB mix, which is what `color-mix(in srgb, …)` computes for opaque colours. */
function mix(color: string, percent: number, over: string): Rgb {
  const [a, b] = [toRgb(color), toRgb(over)]
  const w = percent / 100
  return a.map((v, i) => v * w + b[i] * (1 - w)) as Rgb
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function token(block: string, name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)
  if (!m) throw new Error(`token ${name} not found`)
  return m[1]
}

const THEMES = [
  ['dark', TOKENS.slice(TOKENS.indexOf(':root'), TOKENS.indexOf("[data-theme='light']"))],
  ['light', TOKENS.slice(TOKENS.indexOf("[data-theme='light']"))],
] as const

const AA_NORMAL = 4.5

/** The text token a rule sets, falling back to the row's resting colour. */
function textToken(css: string, selector: string): string {
  const m = /color:\s*var\((--[a-z-]+)\)/.exec(ruleBody(css, selector))
  return m ? m[1] : '--text-secondary'
}

/** What a wash's `over` term resolves to, per theme. */
function surface(block: string, over: string): string {
  if (over === 'transparent') return token(block, '--bg-surface')
  const m = /var\((--[a-z-]+)\)/.exec(over)
  if (!m) throw new Error(`cannot resolve wash base: ${over}`)
  return token(block, m[1])
}

describe('the sidebar wears its workspace colour', () => {
  it('washes a project header in its workspace colour', () => {
    expect(wash(GROUP_CSS, '.session-group__header').percent).toBeGreaterThan(0)
  })

  it('marks the header edge with the workspace colour as well as the wash', () => {
    expect(ruleBody(GROUP_CSS, '.session-group__header')).toMatch(
      /box-shadow:\s*inset\s+2px 0 0 color-mix\(in srgb, var\(--ws-color, transparent\)/
    )
  })

  it('carries the colour down the rows, so a run of them reads as one workspace', () => {
    expect(ruleBody(ROW_CSS, '.session-row')).toMatch(
      /box-shadow:\s*inset\s+2px 0 0 color-mix\(in srgb, var\(--ws-color, transparent\)/
    )
  })

  it('keeps hover and selection in the workspace hue rather than the neutral card', () => {
    expect(wash(ROW_CSS, '.session-row:hover').percent).toBeGreaterThan(0)
    expect(wash(ROW_CSS, '.session-row--active').percent).toBeGreaterThan(
      wash(ROW_CSS, '.session-row:hover').percent
    )
  })

  it('degrades to the neutral surface where there is no workspace', () => {
    // Scratch terminals and status buckets set no --ws-color. The fallback has
    // to be spelled on every wash, or the whole declaration is dropped as
    // invalid at computed-value time and the surface loses its background.
    for (const css of [GROUP_CSS, ROW_CSS, WS_CSS]) {
      const mixes = [...css.matchAll(/color-mix\(in srgb,\s*var\(--ws-color[^)]*\)/g)]
      expect(mixes.length).toBeGreaterThan(0)
      for (const [text] of mixes) expect(text).toContain('var(--ws-color, transparent)')
    }
  })

  it('gives a row its own workspace colour, for groupings whose header cannot', () => {
    // Grouped by status or branch a group spans workspaces, so the header has
    // no colour to give and the row has to carry its own.
    expect(ROW_TSX).toMatch(/'--ws-color'[^)]*\]:\s*workspaceColor/)
    expect(SIDEBAR_TSX).toMatch(/workspaceColorForSession\(/)
  })
})

describe('the colour runs unbroken down the column', () => {
  // Every surface between a group's header and the row that closes its run has
  // to be painted. Where one was not, the workspace's territory showed a hole
  // straight through to the sidebar, which reads as the tint being broken
  // rather than as the column ending.

  it('washes a row at rest, not only under the cursor', () => {
    const rest = wash(ROW_CSS, '.session-row').percent
    expect(rest).toBeGreaterThan(0)
    expect(rest).toBeLessThan(wash(ROW_CSS, '.session-row:hover').percent)
  })

  it('separates one group from the next without a line or a hole', () => {
    // The margin sat outside the border box, so both the wash and the inset
    // rail stopped at it. The same space is padding now — and it stays a plain
    // step in colour: a rule drawn across the top of a header reads as the tint
    // being cut, which is the whole thing this file is guarding.
    const header = ruleBody(GROUP_CSS, '.session-group__header')
    expect(header).not.toMatch(/margin-top:/)
    expect(header).toMatch(/padding: 6px/)
    expect(header).not.toMatch(/inset 0 1px/)
    expect(header).not.toMatch(/border-(top|bottom):/)
    expect(ruleBody(GROUP_CSS, '.session-group--nested > .session-group__header')).not.toMatch(
      /margin-top:|inset 0 1px|border-(top|bottom):/
    )
  })

  it('runs the workspace row band the full height of its row', () => {
    const band = ruleBody(WS_CSS, '.ws-row__band')
    expect(band).toMatch(/top:\s*0;/)
    expect(band).toMatch(/bottom:\s*0;/)
  })

  it('washes the workspace row that closes the run', () => {
    expect(wash(WS_CSS, '.ws-row').percent).toBeGreaterThan(0)
  })
})

describe('the wash stays a tint (WCAG AA)', () => {
  const WASHED: { css: string; selector: string; textFrom?: string }[] = [
    { css: ROW_CSS, selector: '.session-row' },
    { css: ROW_CSS, selector: '.session-row:hover' },
    { css: ROW_CSS, selector: '.session-row--active' },
    // The workspace row's colour is on the button that fills it, not the row.
    { css: WS_CSS, selector: '.ws-row', textFrom: '.ws-row__add' },
  ]

  for (const [theme, block] of THEMES) {
    it(`${theme}: row text clears AA on every washed surface, for every preset`, () => {
      for (const { css, selector, textFrom } of WASHED) {
        const spec = wash(css, selector)
        const base = surface(block, spec.over)
        // The token the rule itself sets, so changing the row's text colour
        // moves this check with it instead of leaving it measuring a colour
        // that no longer renders there.
        const text = toRgb(token(block, textToken(css, textFrom ?? selector)))
        for (const preset of WORKSPACE_PRESET_COLORS) {
          expect(
            contrast(text, mix(preset, spec.percent, base)),
            `${theme} ${selector} over ${preset} at ${spec.percent}%`
          ).toBeGreaterThanOrEqual(AA_NORMAL)
        }
      }
    })

    it(`${theme}: the header wash costs its own text little of its contrast`, () => {
      // The header's text is the workspace colour, so washing the header in the
      // same hue closes the gap between them. AA cannot be the bar here: the
      // raw swatch as text already sits below it for the darker presets in dark
      // mode and for most presets in light mode, which is a property of
      // colouring the text at all and predates this wash. What this pins down
      // is that the wash stays a marginal cost on that ratio — at 10% it is
      // under 15%, where a fill-strength mix would be several times that.
      const { percent, over } = wash(GROUP_CSS, '.session-group__header')
      const base = surface(block, over)
      for (const preset of WORKSPACE_PRESET_COLORS) {
        const before = contrast(toRgb(preset), toRgb(base))
        const after = contrast(toRgb(preset), mix(preset, percent, base))
        expect(after / before, `${theme} header over ${preset}`).toBeGreaterThanOrEqual(0.85)
      }
    })
  }
})
