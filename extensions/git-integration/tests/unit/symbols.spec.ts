import { describe, it, expect, vi } from 'vitest'
import { Tree } from 'web-tree-sitter'
import { loadLanguageFor, analyseSnippet, tagsOf } from '../../src/review/symbols'

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

const BRANCHY_SOURCE = `
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

describe('analyseSnippet() — grammar and memory', () => {
  it('frees its syntax tree once the analysis is read', async () => {
    const free = vi.spyOn(Tree.prototype, 'delete')
    const result = await analyseSnippet('src/freed.ts', 'export function freed() { return 1 }')
    expect(result?.definitions).toContain('freed')
    expect(free).toHaveBeenCalledTimes(1)
    free.mockRestore()
  })

  it('returns null when there is no grammar for the path', async () => {
    const result = await analyseSnippet('README.md', '# hello')
    expect(result).toBeNull()
  })
})

describe('analyseSnippet() — definitions', () => {
  it('collects the function, class and interface definitions the grammar tags', async () => {
    const code = `
export function computeRiskScore(metrics: FileMetrics): RiskScore {
  return metrics.level
}
export class RiskEngine {}
export interface RiskInput { path: string }
const localHelper = 1
`
    const result = await analyseSnippet('src/risk.ts', code)
    expect(result).not.toBeNull()
    expect(result!.definitions).toEqual(
      expect.arrayContaining(['computeRiskScore', 'RiskEngine', 'RiskInput'])
    )
    expect(result!.definitions).not.toContain('localHelper')
  })
})

describe('analyseSnippet() — references', () => {
  it("collects calls, excluding keywords and the snippet's own definitions", async () => {
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
    expect(result!.references).not.toContain('usePrReview')
    expect(result!.references).not.toContain('if')
    expect(result!.references).not.toContain('return')
  })

  it('does not report a call to a function the same snippet defines', async () => {
    const code = `
function helper() { return 1 }
export function caller() { return helper() + external() }
`
    const result = await analyseSnippet('src/caller.ts', code)
    expect(result!.references).toEqual(['external'])
  })
})

describe('analyseSnippet() — branches', () => {
  it('counts if/else-if, loops, switch case, catch, ternary and short-circuit branches', async () => {
    const result = await analyseSnippet('src/branchy.ts', BRANCHY_SOURCE)
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
})

describe('analyseSnippet() — function names', () => {
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
})

describe('analyseSnippet() — exported functions and methods', () => {
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

const TYPESCRIPT_SOURCE = `interface RiskInput { path: string }
export class RiskEngine {
  score(input: RiskInput): number {
    return weigh(input)
  }
}
export function computeRiskScore(input: RiskInput) {
  return new RiskEngine().score(input)
}`

const PYTHON_SOURCE = `class Ledger:
    def total(self):
        return summarise(self.rows)

def open_ledger(path):
    return Ledger()`

const GO_SOURCE = `package ledger

type Ledger struct{ rows []int }

func (l Ledger) Total() int {
	return sum(l.rows)
}

func Open() Ledger {
	return Ledger{}
}`

const RUST_SOURCE = `struct Ledger { rows: Vec<i32> }

impl Ledger {
    fn total(&self) -> i32 {
        sum(&self.rows)
    }
}

fn open() -> Ledger {
    Ledger { rows: Vec::new() }
}`

describe('analyseSnippet() — the same analysis for every tagged grammar', () => {
  it('reads TypeScript definitions, references and functions from its tags query', async () => {
    const result = await analyseSnippet('src/risk.ts', TYPESCRIPT_SOURCE)
    expect(result!.definitions.toSorted()).toEqual([
      'RiskEngine',
      'RiskInput',
      'computeRiskScore',
      'score',
    ])
    expect(result!.references).toEqual(['weigh'])
    expect(result!.functions).toEqual([
      { name: 'score', line: 3, endLine: 5, branches: 0 },
      { name: 'computeRiskScore', line: 7, endLine: 9, branches: 0 },
    ])
  })
})

describe('analyseSnippet() — Python and Go', () => {
  it('reads Python definitions, references and functions from its tags query', async () => {
    const result = await analyseSnippet('ledger.py', PYTHON_SOURCE)
    expect(result!.definitions.toSorted()).toEqual(['Ledger', 'open_ledger', 'total'])
    expect(result!.references).toEqual(['summarise'])
    expect(result!.functions).toEqual([
      { name: 'total', line: 2, endLine: 3, branches: 0 },
      { name: 'open_ledger', line: 5, endLine: 6, branches: 0 },
    ])
  })

  it('reads Go definitions, references and functions from its tags query', async () => {
    const result = await analyseSnippet('ledger.go', GO_SOURCE)
    expect(result!.definitions.toSorted()).toEqual(['Ledger', 'Open', 'Total'])
    expect(result!.references).toContain('sum')
    expect(result!.references).not.toContain('Ledger')
    expect(result!.functions).toEqual([
      { name: 'Total', line: 5, endLine: 7, branches: 0 },
      { name: 'Open', line: 9, endLine: 11, branches: 0 },
    ])
  })
})

describe('analyseSnippet() — Rust and grammars with no tags query', () => {
  it('reads Rust definitions, references and functions from its tags query, a method once', async () => {
    const result = await analyseSnippet('ledger.rs', RUST_SOURCE)
    expect(result!.definitions.toSorted()).toEqual(['Ledger', 'open', 'total'])
    expect(result!.references).toContain('sum')
    expect(result!.references).not.toContain('Ledger')
    expect(result!.functions).toEqual([
      { name: 'total', line: 4, endLine: 6, branches: 0 },
      { name: 'open', line: 9, endLine: 11, branches: 0 },
    ])
  })

  it('returns null for a grammar whose upstream repo ships no tags query', async () => {
    const result = await analyseSnippet('src/theme.css', '.button { color: red; }')
    expect(result).toBeNull()
  })
})

const TYPESCRIPT_PICK = `function pick(a, b) {
  if (a) {
    return 1
  } else if (b) {
    return 2
  }
  for (const x of a) {}
  while (b) {}
  return a ? 1 : 2
}`

const PYTHON_PICK = `def pick(a, b):
    if a:
        return 1
    elif b:
        return 2
    for x in a:
        pass
    while b:
        pass
    return 1 if a else 2`

describe('analyseSnippet() — branches across grammars', () => {
  it.each([
    ['src/pick.ts', TYPESCRIPT_PICK],
    ['pick.py', PYTHON_PICK],
  ])(
    'counts if, else-if, for, while and the conditional expression in %s as 5',
    async (path, code) => {
      const result = await analyseSnippet(path, code)
      expect(result!.branches).toBe(5)
      expect(result!.functions).toMatchObject([{ name: 'pick', branches: 5 }])
    }
  )
})

describe('tagsOf()', () => {
  it('lists each definition with its kind and line span, and each reference with its line', async () => {
    const tags = await tagsOf('ledger.py', PYTHON_SOURCE)
    expect(tags).toEqual({
      definitions: [
        { name: 'Ledger', kind: 'class', startLine: 1, endLine: 3 },
        { name: 'total', kind: 'function', startLine: 2, endLine: 3 },
        { name: 'open_ledger', kind: 'function', startLine: 5, endLine: 6 },
      ],
      references: [
        { name: 'summarise', line: 3 },
        { name: 'Ledger', line: 6 },
      ],
    })
  })

  it('returns null for a grammar with no tags query', async () => {
    expect(await tagsOf('src/theme.css', '.button { color: red; }')).toBeNull()
  })

  it('returns null for a path with no grammar', async () => {
    expect(await tagsOf('README.md', '# hello')).toBeNull()
  })
})
