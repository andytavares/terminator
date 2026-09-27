import { describe, it, expect } from 'vitest'
import { loadLanguageFor, analyseSnippet, symbolFromHunkHeader } from '../../src/review/symbols'

describe('loadLanguageFor()', () => {
  it('loads the typescript grammar for a .ts path', async () => {
    const lang = await loadLanguageFor('src/foo.ts')
    expect(lang).not.toBeNull()
  })

  it('returns null for a path with no known grammar', async () => {
    const lang = await loadLanguageFor('README.md')
    expect(lang).toBeNull()
  })

  it('caches the language per grammar (repeated calls resolve fast)', async () => {
    const first = await loadLanguageFor('a.ts')
    const second = await loadLanguageFor('b.ts')
    expect(first).toBe(second)
  })
})

describe('analyseSnippet()', () => {
  it('returns null when there is no grammar for the path', async () => {
    const result = await analyseSnippet('README.md', '# hello')
    expect(result).toBeNull()
  })

  it('collects function, class, interface, type, enum and exported-const definitions', async () => {
    const code = `
export function computeRiskScore(metrics: FileMetrics): RiskScore {
  return metrics.level
}
export class RiskEngine {}
export interface RiskInput { path: string }
export type RiskLevel = 'low' | 'high'
export enum Tier { Zero, One }
export const DEFAULT_WEIGHT = 5
const localHelper = 1
`
    const result = await analyseSnippet('src/risk.ts', code)
    expect(result).not.toBeNull()
    expect(result!.definitions).toEqual(
      expect.arrayContaining([
        'computeRiskScore',
        'RiskEngine',
        'RiskInput',
        'RiskLevel',
        'Tier',
        'DEFAULT_WEIGHT',
      ])
    )
    // Non-exported const is a local binding, not a shared definition.
    expect(result!.definitions).not.toContain('localHelper')
  })

  it('collects references, excluding local bindings and keywords', async () => {
    const code = `
import { RiskScore } from './schema'
export function usePrReview() {
  const result = computeRiskScore(metrics)
  if (result) {
    return result
  }
  return null
}
`
    const result = await analyseSnippet('src/hooks/usePrReview.ts', code)
    expect(result).not.toBeNull()
    expect(result!.references).toContain('computeRiskScore')
    expect(result!.references).toContain('metrics')
    // Function's own name is a definition, not a reference to itself.
    expect(result!.references).not.toContain('usePrReview')
    expect(result!.references).not.toContain('if')
    expect(result!.references).not.toContain('return')
  })

  it('counts if/else-if, loops, switch case, catch, ternary and short-circuit branches', async () => {
    const code = `
export function branchy(a: number, b: number, c: number) {
  if (a) {
    // noop
  } else if (b) {
    // noop
  }
  for (let i = 0; i < a; i++) {}
  while (b) {}
  switch (c) {
    case 1:
      break
    default:
      break
  }
  try {
    doThing()
  } catch (e) {
    handle(e)
  }
  const z = a ? b : c
  const y = a && b
  const w = a || b
  const v = a ?? b
  return z
}
`
    const result = await analyseSnippet('src/branchy.ts', code)
    expect(result).not.toBeNull()
    // if, else-if, for, while, switch case, catch, ternary, &&, ||, ?? = 10
    expect(result!.branches).toBe(10)
    expect(result!.functions).toHaveLength(1)
    expect(result!.functions[0]).toMatchObject({ name: 'branchy', branches: 10 })
  })

  it('does not count && inside a string or a comment as a branch', async () => {
    const code = `
export function notBranchy() {
  const s = 'a && b'
  // c && d is just a comment
  return s
}
`
    const result = await analyseSnippet('src/notbranchy.ts', code)
    expect(result).not.toBeNull()
    expect(result!.branches).toBe(0)
  })

  it('names a generator function declaration and a named function expression', async () => {
    const code = `
export function* genFn() {
  yield 1
}
const f = function namedFn() {
  return 1
}
`
    const result = await analyseSnippet('src/gen.ts', code)
    expect(result).not.toBeNull()
    expect(result!.functions.map((fn) => fn.name)).toEqual(
      expect.arrayContaining(['genFn', 'namedFn'])
    )
  })

  it('does not name an anonymous arrow function passed as a bare callback', async () => {
    const code = `
export function callIt() {
  setTimeout(() => {
    doThing()
  }, 10)
}
`
    const result = await analyseSnippet('src/callback.ts', code)
    expect(result).not.toBeNull()
    // Only callIt is named; the inline arrow has neither a name field nor a
    // variable_declarator parent, so functionName() falls through to null.
    expect(result!.functions.map((fn) => fn.name)).toEqual(['callIt'])
  })

  it('pulls every bound identifier out of a destructuring pattern', async () => {
    const code = `
export function destructure(obj: { a: number; b: number }) {
  const { a, b } = obj
  return a + b
}
`
    const result = await analyseSnippet('src/destructure.ts', code)
    expect(result).not.toBeNull()
    // a and b are local bindings, not cross-file references.
    expect(result!.references).not.toContain('a')
    expect(result!.references).not.toContain('b')
  })

  it('resolves the enclosing symbol for arrow-function const exports', async () => {
    const code = `
export const computeRiskScore = (metrics: FileMetrics): RiskScore => {
  return metrics.level
}
`
    const result = await analyseSnippet('src/risk.ts', code)
    expect(result).not.toBeNull()
    expect(result!.definitions).toContain('computeRiskScore')
    expect(result!.functions.map((f) => f.name)).toContain('computeRiskScore')
  })

  it('does not choke on a computed method name', async () => {
    const code = `
export class Registry {
  [Symbol.iterator]() {
    return null
  }
  register() {
    return 1
  }
}
`
    const result = await analyseSnippet('src/registry.ts', code)
    expect(result).not.toBeNull()
    expect(result!.definitions).toContain('Registry')
    expect(result!.definitions).toContain('register')
  })
})

describe('symbolFromHunkHeader()', () => {
  it('pulls the trailing symbol name out of a hunk header', () => {
    expect(symbolFromHunkHeader('@@ -56,10 +56,12 @@ export function HealthChips')).toBe(
      'HealthChips'
    )
  })

  it('skips export/class/const keywords to find the name', () => {
    expect(symbolFromHunkHeader('@@ -1,2 +1,2 @@ export class RiskEngine')).toBe('RiskEngine')
    expect(symbolFromHunkHeader('@@ -1,2 +1,2 @@ export const computeRiskScore = (')).toBe(
      'computeRiskScore'
    )
  })

  it('returns null when the header has no trailing context', () => {
    expect(symbolFromHunkHeader('@@ -1,2 +1,2 @@')).toBeNull()
  })
})
