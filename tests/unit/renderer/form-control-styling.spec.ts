import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTENSION_BASE_CSS } from '../../../src/main/extensions/extension-view-host'

// Every checkbox AND radio in the app must be the themed control, not the OS
// widget. `accent-color` alone is not enough — it tints the fill and leaves a
// white box around it, which is what several of these files used to do.

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const STYLES = read('../../../src/renderer/styles.css')

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

describe('core checkbox styling', () => {
  it('replaces the native widget rather than tinting it', () => {
    const base = ruleBody(STYLES, "input[type='checkbox']")
    expect(base).toMatch(/appearance:\s*none/)
    expect(base).toMatch(/-webkit-appearance:\s*none/)
  })

  it('uses theme tokens for its surface and border, never a hard-coded colour', () => {
    const base = ruleBody(STYLES, "input[type='checkbox']")
    expect(base).toMatch(/background:\s*var\(--bg-input\)/)
    expect(base).toMatch(/border:\s*1px solid var\(--border-strong\)/)
  })

  it('fills with the accent when checked', () => {
    expect(STYLES).toMatch(
      /input\[type='checkbox'\]:checked,\s*\n?\s*input\[type='checkbox'\]:indeterminate \{[^}]*background:\s*var\(--accent\)/
    )
  })

  it('draws the tick in CSS, never as a unicode glyph', () => {
    const tick = ruleBody(STYLES, "input[type='checkbox']:checked::after")
    expect(tick).toMatch(/border:\s*solid var\(--on-accent\)/)
    expect(tick).toMatch(/transform:\s*rotate\(45deg\)/)
    for (const glyph of ['✓', '✔', '☑', '×']) {
      expect(STYLES).not.toContain(glyph)
    }
  })

  it('has a visible keyboard focus ring', () => {
    expect(ruleBody(STYLES, "input[type='checkbox']:focus-visible")).toMatch(/outline:\s*2px/)
  })

  it('renders an indeterminate state as a bar, not an empty box', () => {
    expect(ruleBody(STYLES, "input[type='checkbox']:indeterminate::after")).toMatch(
      /background:\s*var\(--on-accent\)/
    )
  })

  it('defines --on-accent in both themes, since the accent fill is the same colour in each', () => {
    const dark = STYLES.slice(STYLES.indexOf(':root'), STYLES.indexOf("[data-theme='light']"))
    const light = STYLES.slice(STYLES.indexOf("[data-theme='light']"))
    expect(dark).toMatch(/--on-accent:\s*#ffffff/)
    expect(light).toMatch(/--on-accent:\s*#ffffff/)
  })

  it('leaves no accent-color rule behind — it does nothing once appearance is none', () => {
    for (const file of [
      '../../../src/renderer/components/sidebar/Dialog.css',
      '../../../src/renderer/components/settings/SettingsPanel.css',
    ]) {
      expect(read(file)).not.toMatch(/accent-color/)
    }
  })
})

describe('extension checkbox styling', () => {
  // Extension UIs are isolated WebContentsViews and inherit none of the host's
  // CSS, so the same replacement has to travel with the injected base sheet.
  it('replaces the native widget inside extension views too', () => {
    expect(EXTENSION_BASE_CSS).toMatch(/input\[type='checkbox'\] \{[^}]*appearance:\s*none/)
  })

  it('uses the published --tm-* tokens, not the host variable names', () => {
    const rules = EXTENSION_BASE_CSS.slice(EXTENSION_BASE_CSS.indexOf("input[type='checkbox']"))
    expect(rules).toMatch(/var\(--tm-bg-input\)/)
    expect(rules).toMatch(/var\(--tm-accent\)/)
    expect(rules).not.toMatch(/var\(--(?!tm-)/)
  })

  it('publishes --tm-on-accent so the tick has a colour to use', () => {
    expect(EXTENSION_BASE_CSS).toMatch(/--tm-on-accent:\s*#ffffff/)
  })

  it('covers checked, indeterminate, focus and disabled, matching the host', () => {
    for (const state of [':checked', ':indeterminate', ':focus-visible', ':disabled']) {
      expect(EXTENSION_BASE_CSS).toContain(`input[type='checkbox']${state}`)
    }
  })
})

describe('core radio styling', () => {
  it('replaces the native widget rather than tinting it', () => {
    const base = ruleBody(STYLES, "input[type='radio']")
    expect(base).toMatch(/appearance:\s*none/)
    expect(base).toMatch(/-webkit-appearance:\s*none/)
  })

  it('is the same box as the checkbox, but circular', () => {
    const base = ruleBody(STYLES, "input[type='radio']")
    expect(base).toMatch(/background:\s*var\(--bg-input\)/)
    expect(base).toMatch(/border:\s*1px solid var\(--border-strong\)/)
    expect(base).toMatch(/border-radius:\s*50%/)
  })

  it('fills with the accent when checked', () => {
    expect(ruleBody(STYLES, "input[type='radio']:checked")).toMatch(/background:\s*var\(--accent\)/)
  })

  it('marks the checked state with a dot, not a glyph', () => {
    const dot = ruleBody(STYLES, "input[type='radio']:checked::after")
    expect(dot).toMatch(/content:\s*''/)
    expect(dot).toMatch(/border-radius:\s*50%/)
    expect(dot).toMatch(/background:\s*var\(--on-accent\)/)
  })

  it('centres the dot — asserted arithmetically, so resizing the box cannot break it silently', () => {
    const base = ruleBody(STYLES, "input[type='radio']")
    const dot = ruleBody(STYLES, "input[type='radio']:checked::after")
    const px = (body: string, prop: string) => {
      const m = new RegExp(`${prop}:\\s*(\\d+)px`).exec(body)
      if (!m) throw new Error(`${prop} not found`)
      return Number(m[1])
    }
    const boxW = px(base, 'width')
    const borderW = px(base, 'border')
    const dotW = px(dot, 'width')
    const left = px(dot, 'left')
    // The pseudo-element offsets from the padding box, which is inset by the border.
    expect(2 * left + dotW).toBe(boxW - 2 * borderW)
    expect(px(dot, 'top')).toBe(left)
  })

  it('has a visible keyboard focus ring and a disabled state', () => {
    expect(ruleBody(STYLES, "input[type='radio']:focus-visible")).toMatch(/outline:\s*2px/)
    expect(ruleBody(STYLES, "input[type='radio']:disabled")).toMatch(/opacity/)
  })

  it('immunises both controls against a container form reset', () => {
    for (const sel of ["input[type='checkbox']", "input[type='radio']"]) {
      expect(ruleBody(STYLES, sel)).toMatch(/padding:\s*0/)
    }
  })

  it('publishes --tm-on-accent, or an extension view resolves it to nothing', () => {
    expect(STYLES).toMatch(/--tm-on-accent:\s*var\(--on-accent\)/)
  })
})

describe('extension radio styling', () => {
  it('replaces the native widget inside extension views too', () => {
    expect(EXTENSION_BASE_CSS).toMatch(/input\[type='radio'\] \{[^}]*appearance:\s*none/)
    expect(EXTENSION_BASE_CSS).toMatch(/input\[type='radio'\] \{[^}]*border-radius:\s*50%/)
  })

  it('covers checked, focus and disabled, matching the host', () => {
    for (const state of [':checked', ':focus-visible', ':disabled']) {
      expect(EXTENSION_BASE_CSS).toContain(`input[type='radio']${state}`)
    }
  })
})

// ── Repo-wide guards ────────────────────────────────────────────────
//
// The audit that prompted this work found three competing ways of styling the
// same control: a real replacement, a glyph-tick replacement, and cosmetic
// `accent-color`. These guards are what stop that recurring. They report
// offenders as file:line so a failure is actionable.

const REPO = fileURLToPath(new URL('../../../', import.meta.url))

function sourceRoots(): string[] {
  const roots = [join(REPO, 'src')]
  for (const ext of readdirSync(join(REPO, 'extensions'), { withFileTypes: true })) {
    if (ext.isDirectory()) roots.push(join(REPO, 'extensions', ext.name, 'src'))
  }
  return roots.filter((r) => existsSync(r))
}

function filesUnder(roots: string[], exts: string[]): string[] {
  const out: string[] = []
  for (const root of roots) {
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!exts.some((e) => entry.name.endsWith(e))) continue
      const dir = entry.parentPath ?? entry.path
      if (/(^|\/)(dist|node_modules|coverage)(\/|$)/.test(dir)) continue
      out.push(join(dir, entry.name))
    }
  }
  return out
}

const rel = (p: string) => p.slice(REPO.length)
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function offenders(files: string[], test: (line: string) => boolean): string[] {
  const hits: string[] = []
  for (const file of files) {
    stripComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        if (test(line)) hits.push(`${rel(file)}:${i + 1}`)
      })
  }
  return hits
}

/** Split a stylesheet into `[selector, body]` pairs. */
function rules(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripComments(css)))) out.push([m[1].trim(), m[2]])
  return out
}

describe('no form control may drift back to a native or half-styled widget', () => {
  const cssFiles = filesUnder(sourceRoots(), ['.css'])
  const tsFiles = filesUnder(sourceRoots(), ['.ts', '.tsx'])

  it('finds stylesheets to check, so a broken glob cannot make these vacuous', () => {
    expect(cssFiles.length).toBeGreaterThan(10)
    expect(tsFiles.length).toBeGreaterThan(50)
  })

  it('uses accent-color nowhere — it tints the fill and leaves the chrome native', () => {
    expect(offenders(cssFiles, (l) => /(^|[^-\w])accent-color\s*:/.test(l))).toEqual([])
  })

  it('draws no tick or cross as a glyph on a form control (Principle XII)', () => {
    const bad: string[] = []
    for (const file of cssFiles) {
      for (const [selector, body] of rules(readFileSync(file, 'utf8'))) {
        if (!/checkbox|radio|input\[type=/i.test(selector)) continue
        if (/content:\s*['"][^'"]*[✓✔☑✗×][^'"]*['"]/.test(body))
          bad.push(`${rel(file)} — ${selector}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('declares no box property on a control rule too weak to win', () => {
    // A bare `.thing-checkbox { width: … }` loses to the (0,1,1) base rule, so
    // it is a lie in the source. Raise the selector or drop the declaration.
    //
    // Classes named "checkbox" that are not inputs at all — icon buttons that
    // merely look like one — are exempt, listed so each is a conscious call.
    const notAnInput = ['.daily-log__task-checkbox']
    const bad: string[] = []
    for (const file of cssFiles) {
      for (const [selector, body] of rules(readFileSync(file, 'utf8'))) {
        if (!/checkbox|radio/i.test(selector)) continue
        // A rule that names the type — or explicitly excludes it — is strong
        // enough (or is not a control rule at all).
        if (/input\[type=/.test(selector) || /:not\(\[type=/.test(selector)) continue
        if (notAnInput.some((c) => selector.includes(c))) continue
        const props = ['width', 'height', 'margin', 'border-radius', 'background']
        const found = props.filter((p) => new RegExp(`(^|;|\\s)${p}\\s*:`).test(body))
        if (found.length > 0) bad.push(`${rel(file)} — ${selector} sets ${found.join(', ')}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('sets accentColor inline only where it is not a form control', () => {
    // Equality, not absence: a new occurrence fails, and removing one forces a
    // conscious edit here. Both allowed uses pass a colour as data, not style.
    const withInline = tsFiles.filter((f) => /accentColor/.test(readFileSync(f, 'utf8'))).map(rel)
    expect(withInline.sort()).toEqual([
      // passes the workspace colour to a pop-out window as a URL param
      'extensions/git-integration/src/index.ts',
      // reads that param and paints a 3px accent bar
      'src/renderer/ExtensionWindowView.tsx',
    ])
  })
})
