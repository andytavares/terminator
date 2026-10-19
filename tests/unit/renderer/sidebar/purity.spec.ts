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

const sourceOf = (file: string, dir = DIR): string => readFileSync(join(dir, file), 'utf8')

/** Strip comments so prose about React or `Date.now()` cannot fail the test. */
function code(file: string, dir = DIR): string {
  return sourceOf(file, dir)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the sidebar pure layer imports nothing but types', () => {
  it('has modules to check', () => {
    expect(modules.length).toBeGreaterThan(0)
  })

  /**
   * A value import is allowed from a sibling in this directory, or from the
   * shared type module — which is the type graph itself, and holds frozen
   * identifiers like SCRATCH_PROJECT_ID alongside the types. Neither can make
   * a function non-deterministic. Everything else is banned, and the React,
   * store and clock rules below are asserted separately so this relaxation
   * cannot quietly widen them.
   */
  const TYPE_GRAPH = '../../shared/types/index'

  it.each(modules)('%s imports no runtime module outside the type graph', (file) => {
    const imports = [...code(file).matchAll(/^\s*import\s+([\s\S]*?)from\s+'([^']+)'/gm)]
    for (const [, clause, specifier] of imports) {
      const isTypeOnly = /^\s*type\b/.test(clause)
      if (isTypeOnly) continue
      expect(
        specifier.startsWith('./') || specifier === TYPE_GRAPH,
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

// The Desk's pure layer; its stores hold what the operator did, so they may use the clock.
const HOME = join(__dirname, '../../../../src/renderer/home')
const STATEFUL = new Set(['dismissals.ts', 'focus-store.ts', 'local-storage.ts'])
const homeModules = readdirSync(HOME).filter((f) => f.endsWith('.ts') && !STATEFUL.has(f))

// The SDK's helpers are pure functions shared with the extensions (plural, validationError).
const PURE_PACKAGES = new Set(['@terminator/extension-sdk'])

describe('the Desk pure layer imports nothing but types, siblings and the sidebar layer', () => {
  it('has modules to check', () => {
    expect(homeModules.length).toBeGreaterThan(0)
  })

  it.each(homeModules)('%s value-imports only siblings or the sidebar pure layer', (file) => {
    const imports = [...code(file, HOME).matchAll(/^\s*import\s+([\s\S]*?)from\s+'([^']+)'/gm)]
    for (const [, clause, specifier] of imports) {
      if (/^\s*type\b/.test(clause)) continue
      expect(
        specifier.startsWith('./') ||
          specifier.startsWith('../sidebar/') ||
          PURE_PACKAGES.has(specifier),
        `${file} value-imports '${specifier}'`
      ).toBe(true)
    }
  })

  it.each(homeModules)('%s uses no React, zustand, store or clock', (file) => {
    const text = code(file, HOME)
    expect(text).not.toMatch(/from\s+'(react|zustand)'/)
    expect(text).not.toMatch(/stores\/|\buse[A-Z]\w*Store\b/)
    expect(text).not.toMatch(/Date\.now\s*\(|new\s+Date\s*\(\s*\)/)
  })
})
