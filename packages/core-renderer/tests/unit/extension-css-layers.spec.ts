import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { join } from 'node:path'

// ESLint does not see CSS, so the stylesheet half of the layer contract is
// guarded here. Before this, extension CSS carried 14 distinct z-index values
// from 1 to 9999 and stacking was decided by whoever picked the larger number.

const CSS_FILES = globSync('extensions/*/src/**/*.css', { cwd: process.cwd() })

describe('extension stylesheets', () => {
  it('finds the stylesheets it is meant to be guarding', () => {
    expect(CSS_FILES.length).toBeGreaterThan(0)
  })

  it.each(CSS_FILES)('declares no raw stacking value in %s', (file) => {
    const css = readFileSync(join(process.cwd(), file), 'utf8')
    const raw = css.match(/z-index:\s*[0-9]/g) ?? []
    expect(raw).toEqual([])
  })

  it.each(CSS_FILES)('takes stacking from the published scale in %s', (file) => {
    const css = readFileSync(join(process.cwd(), file), 'utf8')
    for (const declaration of css.match(/z-index:[^;]+/g) ?? []) {
      expect(declaration).toMatch(/var\(--tm-layer-(panel|overlay|modal|toast)\)/)
    }
  })
})
