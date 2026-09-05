import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `src/renderer/sidebar/` is the pure layer: it decides *what is shown* as a
 * function of its arguments and nothing else. That is what makes the whole
 * sidebar exhaustively testable without a DOM, and it is the property that
 * quietly rots the first time someone reaches for a store or the clock inside
 * it (ADR-027, Constitution XI).
 *
 * This guards the directory rather than any one module, so a new file added
 * here inherits the rule without anyone remembering to write this test again.
 */
const DIR = join(__dirname, '../../../../src/renderer/sidebar')

const modules = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))

const sourceOf = (file: string): string => readFileSync(join(DIR, file), 'utf8')

/** Strip comments so prose about React or `Date.now()` cannot fail the test. */
function code(file: string): string {
  return sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the sidebar pure layer imports nothing but types', () => {
  it('has modules to check', () => {
    expect(modules.length).toBeGreaterThan(0)
  })

  it.each(modules)('%s imports no runtime module outside the type graph', (file) => {
    const imports = [...code(file).matchAll(/^\s*import\s+([\s\S]*?)from\s+'([^']+)'/gm)]
    for (const [, clause, specifier] of imports) {
      const isTypeOnly = /^\s*type\b/.test(clause)
      if (isTypeOnly) continue
      // A value import is allowed only from another module in this directory.
      expect(
        specifier.startsWith('./'),
        `${file} value-imports '${specifier}' from outside the pure layer`
      ).toBe(true)
    }
  })

  it.each(modules)('%s does not import React', (file) => {
    expect(code(file)).not.toMatch(/from\s+'react'/)
  })

  it.each(modules)('%s does not reach for a store', (file) => {
    expect(code(file)).not.toMatch(/stores\//)
    expect(code(file)).not.toMatch(/\buse[A-Z]\w*Store\b/)
  })

  it.each(modules)('%s does not read the clock — `now` is always a parameter', (file) => {
    expect(code(file)).not.toMatch(/Date\.now\s*\(/)
    expect(code(file)).not.toMatch(/new\s+Date\s*\(\s*\)/)
  })
})
