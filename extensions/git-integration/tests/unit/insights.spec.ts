import { describe, it, expect, vi, afterEach } from 'vitest'
import { Parser, Tree } from 'web-tree-sitter'
import { computeInsights, type ComputeInsightsOptions } from '../../src/review/insights'
import type { Chapter, DryViolation, ReadingStep } from '../../src/schemas/pr-review.schema'
import { parsePrFiles } from '../../src/review/parsed-file'

const insightsOf = (files: unknown[], opts: ComputeInsightsOptions) =>
  computeInsights(parsePrFiles(files), opts)

const baseOpts: ComputeInsightsOptions = {
  readingOrder: [],
  chapters: [],
  statusChecks: [],
  dryViolations: [],
  localCoverage: null,
}

/** A changed file as GitHub lists it, with its patch given line by line. */
const ONE_ADDITION = { additions: 1, deletions: 0 }

function changedFileWithPatch(path: string, patchLines: string[], counts = ONE_ADDITION) {
  return { path, ...counts, patch: patchLines.join('\n') }
}

const RISKY_FILE = changedFileWithPatch(
  'src/risky.ts',
  [
    '@@ -1,3 +1,6 @@ export function risky',
    ' export function risky(a: number, b: number) {',
    '-  return a',
    '+  if (a && b) {',
    '+    return a || b',
    '+  }',
    '+  return a',
    ' }',
  ],
  { additions: 4, deletions: 1 }
)

const CI_WORKFLOW_FILE = {
  filename: '.github/workflows/ci.yml',
  patch: [
    '@@ -120,4 +120,4 @@ jobs:',
    "-        if: github.event_name == 'pull_request' && needs.select.outputs.burn == 'true'",
    "+        if: needs.select.outputs.burn == 'true'",
    '         run: npx playwright test --repeat-each=3',
  ].join('\n'),
}

const RISK_SCORE_FILE = {
  filename: 'extensions/git-integration/src/github/pr-review-service.ts',
  patch: [
    '@@ -80,2 +80,6 @@ const MISSING_TEST_PENALTY = 20',
    ' ',
    ' // ─── Risk score ───',
    '+export function computeRiskScore(m: FileMetrics, all: FileMetrics[]): RiskScore {',
    '+  if (all.length === 0 || m.additions == null) return defaultRiskScore()',
    '+  return score(m, all)',
    '+}',
  ].join('\n'),
}

const SHRINK_FILE = changedFileWithPatch(
  'src/shrink.ts',
  [
    '@@ -1,5 +1,0 @@ export function shrink',
    '-export function shrink(a: number, b: number) {',
    '-  if (a && b) {',
    '-    return a',
    '-  }',
    '-}',
  ],
  { additions: 0, deletions: 5 }
)

const TWO_FUNCTIONS_FILE = changedFileWithPatch('src/two.ts', [
  '@@ -0,0 +1,9 @@ export function small',
  '+export function small(a: number) {',
  '+  if (a) return 1',
  '+  return 0',
  '+}',
  '+export function large(a: number, b: number) {',
  '+  if (a && b) return 1',
  '+  if (a || b) return 2',
  '+  return 0',
  '+}',
])

describe('computeInsights() — complexity of parsed code', () => {
  it('reports a positive branch delta for a function that gains branches', async () => {
    const insights = await insightsOf([RISKY_FILE], baseOpts)
    expect(insights.complexity.source).toBe('tree-sitter · hunk base vs head')
    expect(insights.complexity.branchDelta).toBeGreaterThan(0)
    const fn = insights.complexity.functions.find((f) => f.name === 'risky')
    expect(fn).toBeDefined()
    expect(fn!.branchDelta).toBeGreaterThan(0)
    expect(fn!.path).toBe('src/risky.ts')
  })

  it('does not score configuration files such as a CI workflow', async () => {
    const insights = await insightsOf([CI_WORKFLOW_FILE], baseOpts)
    expect(insights.complexity.branchDelta).toBe(0)
    expect(insights.complexity.functions).toEqual([])
  })

  it('reports a function at its line in the file, not its line in the hunk', async () => {
    const insights = await insightsOf([RISK_SCORE_FILE], baseOpts)
    const fn = insights.complexity.functions.find((f) => f.name === 'computeRiskScore')
    expect(fn?.line).toBe(82)
  })

  it('lists the functions that gained the most branches first', async () => {
    const insights = await insightsOf([TWO_FUNCTIONS_FILE], baseOpts)
    expect(insights.complexity.functions.map((f) => f.name)).toEqual(['large', 'small'])
  })
})

const STEADY_TF_FILE = changedFileWithPatch(
  'infra/steady.tf',
  ['@@ -1,1 +1,1 @@', '-name = "a"', '+name = "b"'],
  { additions: 1, deletions: 1 }
)

const DEPLOY_TF_FILE = changedFileWithPatch(
  'infra/deploy.tf',
  ['@@ -1,0 +2,2 @@ resource', '+  if (a && b) {}', '+  if (c || d) {}'],
  { additions: 2, deletions: 0 }
)

describe('computeInsights() — complexity of skipped, removed and unparsed code', () => {
  it('skips files with no patch or no path, and accounts for a removed function', async () => {
    const files = [
      { path: 'src/nopatch.ts', additions: 0, deletions: 0 },
      { additions: 1, deletions: 0, patch: '@@ -0,0 +1,1 @@\n+x' },
      SHRINK_FILE,
    ]
    const insights = await insightsOf(files, baseOpts)
    // The whole function was removed — its branches subtract from the total delta.
    expect(insights.complexity.branchDelta).toBeLessThan(0)
  })

  it('does not flag a fallback file whose keyword count is unchanged', async () => {
    const insights = await insightsOf([STEADY_TF_FILE], baseOpts)
    expect(insights.complexity.functions).toEqual([])
  })

  it('falls back to keyword counting for a file with no grammar', async () => {
    const insights = await insightsOf([DEPLOY_TF_FILE], baseOpts)
    expect(insights.complexity.source).toBe('keyword count · approximate')
    expect(insights.complexity.branchDelta).toBeGreaterThan(0)
  })
})

const ADD_ONE_FILE = changedFileWithPatch(
  'src/util.ts',
  [
    '@@ -0,0 +1,3 @@ export function addOne',
    '+export function addOne(n: number) {',
    '+  return n + 1',
    '+}',
  ],
  { additions: 3, deletions: 0 }
)

const ADD_ONE_SPEC_FILE = changedFileWithPatch(
  'tests/unit/util.spec.ts',
  ['@@ -0,0 +1,2 @@ describe', '+const result = addOne(1)', '+expect(result).toBe(2)'],
  { additions: 2, deletions: 0 }
)

const SUBTRACT_ONE_FILE = changedFileWithPatch(
  'src/util.ts',
  [
    '@@ -0,0 +1,3 @@ export function subtractOne',
    '+export function subtractOne(n: number) {',
    '+  return n - 1',
    '+}',
  ],
  { additions: 3, deletions: 0 }
)

const ONE_CONSTANT_FILE = changedFileWithPatch('src/util.ts', [
  '@@ -0,0 +1,1 @@',
  '+export const x = 1',
])

describe('computeInsights() — coverage of changed functions', () => {
  it('marks a changed function tested when a PR test file references it', async () => {
    const insights = await insightsOf([ADD_ONE_FILE, ADD_ONE_SPEC_FILE], baseOpts)
    expect(insights.coverage.changedFunctions).toBe(1)
    expect(insights.coverage.testedFunctions).toBe(1)
    expect(insights.coverage.untestedFunctions).toEqual([])
    expect(insights.coverage.source).toBe('test files referencing each changed function')
  })

  it('falls back to findTestReferences (repo grep) when no PR test file covers a function', async () => {
    const withoutRepoTests = await insightsOf([SUBTRACT_ONE_FILE], baseOpts)
    expect(withoutRepoTests.coverage.untestedFunctions).toContain('subtractOne')

    const withRepoTests = await insightsOf([SUBTRACT_ONE_FILE], {
      ...baseOpts,
      findTestReferences: async (symbols) => new Set(symbols.filter((s) => s === 'subtractOne')),
    })
    expect(withRepoTests.coverage.testedFunctions).toBe(1)
    expect(withRepoTests.coverage.untestedFunctions).toEqual([])
  })
})

describe('computeInsights() — patch coverage percentage', () => {
  it('parses a patch-coverage percentage from a matching status check description', async () => {
    const insights = await insightsOf([ONE_CONSTANT_FILE], {
      ...baseOpts,
      statusChecks: [{ name: 'codecov/patch', state: 'pass', description: '84.21% of diff hit' }],
    })
    expect(insights.coverage.patchPercent).toBe(84)
  })

  it('falls back to localCoverage, then to null, when no CI check reports it', async () => {
    const withLocal = await insightsOf([ONE_CONSTANT_FILE], { ...baseOpts, localCoverage: 72.6 })
    expect(withLocal.coverage.patchPercent).toBe(73)

    const withNeither = await insightsOf([ONE_CONSTANT_FILE], baseOpts)
    expect(withNeither.coverage.patchPercent).toBeNull()
  })
})

const FREED_FILE = changedFileWithPatch(
  'src/freed.ts',
  [
    '@@ -1,2 +1,4 @@ export function freed',
    ' export function freed(a: number) {',
    '-  return a',
    '+  if (a > 1) return a',
    '+  return 0',
    ' }',
  ],
  { additions: 3, deletions: 1 }
)

const FREED_SPEC_FILE = changedFileWithPatch('src/freed.spec.ts', [
  '@@ -0,0 +1,1 @@',
  "+it('frees', () => freed(2))",
])

describe('computeInsights() — syntax tree memory', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('frees every tree-sitter tree it parses', async () => {
    const parse = vi.spyOn(Parser.prototype, 'parse')
    const free = vi.spyOn(Tree.prototype, 'delete')

    await insightsOf([FREED_FILE, FREED_SPEC_FILE], baseOpts)

    expect(parse.mock.calls.length).toBeGreaterThan(0)
    expect(free).toHaveBeenCalledTimes(parse.mock.calls.length)
  })
})

const MARKERS_FILE = changedFileWithPatch(
  'src/health.ts',
  [
    '@@ -0,0 +1,4 @@',
    '+// TODO: revisit this',
    '+// eslint-disable-next-line no-console',
    '+// @ts-ignore',
    '+export function f(x: any) { return x }',
  ],
  { additions: 4, deletions: 0 }
)

const DEEPLY_NESTED_LINES = [
  '+export function deep(a: number) {',
  '+  if (a) {',
  '+    if (a) {',
  '+      if (a) {',
  '+        if (a) {',
  '+          if (a) { return 1 }',
  '+        }',
  '+      }',
  '+    }',
  '+  }',
  '+  return 0',
  '+}',
]

/** A file adding one long function, one deeply nested one and one with six parameters. */
function oversizedFunctionFiles() {
  const bodyLines = Array.from({ length: 82 }, (_, i) => `  const v${i} = ${i}`)
  const longFn = ['+export function longFn() {', ...bodyLines.map((l) => `+${l}`), '+}']
  const manyParams = [
    '+export function manyParams(a: number, b: number, c: number, d: number, e: number, f: number) {',
    '+  return a',
    '+}',
  ]
  return [
    changedFileWithPatch('src/long.ts', ['@@ -0,0 +1,84 @@', ...longFn], {
      additions: 84,
      deletions: 0,
    }),
    changedFileWithPatch('src/deep.ts', ['@@ -0,0 +1,12 @@', ...DEEPLY_NESTED_LINES], {
      additions: 12,
      deletions: 0,
    }),
    changedFileWithPatch('src/params.ts', ['@@ -0,0 +1,3 @@', ...manyParams], {
      additions: 3,
      deletions: 0,
    }),
  ]
}

describe('computeInsights() — health flags', () => {
  it('flags TODO, eslint-disable, @ts-ignore and new any in added lines', async () => {
    const insights = await insightsOf([MARKERS_FILE], baseOpts)
    const kinds = insights.health.flags.map((f) => f.kind)
    expect(kinds).toContain('todo')
    expect(kinds).toContain('eslint-disable')
    expect(kinds).toContain('ts-ignore')
    expect(kinds).toContain('any')
    expect(insights.health.source).toBe('tree-sitter · detectDryViolations')
  })

  it('flags a function over 80 lines, deep nesting and too many parameters', async () => {
    const insights = await insightsOf(oversizedFunctionFiles(), baseOpts)
    const kinds = insights.health.flags.map((f) => f.kind)
    expect(kinds).toContain('long-function')
    expect(kinds).toContain('deep-nesting')
    expect(kinds).toContain('many-params')
  })

  it('adds one flag per DRY violation group', async () => {
    const violation: DryViolation = { files: ['a.ts', 'b.ts'], fingerprint: 'x', lineCount: 5 }
    const insights = await insightsOf([], { ...baseOpts, dryViolations: [violation] })
    expect(insights.health.flags.filter((f) => f.kind === 'duplicate-block')).toHaveLength(1)
  })
})

const FEATURE_FILE = changedFileWithPatch(
  'src/feature.ts',
  ['@@ -0,0 +1,3 @@ export function feature', '+export function feature() {', '+  return 1', '+}'],
  { additions: 3, deletions: 0 }
)

const LOCK_FILE = changedFileWithPatch(
  'package-lock.json',
  ['@@ -0,0 +1,1 @@', '-"a": "1"', '+"a": "2"'],
  {
    additions: 500,
    deletions: 500,
  }
)

/** A reading order where each step uses the symbol the step before it defines. */
function chainedReadingOrder(paths: string[]): ReadingStep[] {
  return paths.map((path, i) => ({
    step: i + 1,
    path,
    symbol: path.toUpperCase(),
    reason: i === 0 ? `Defines ${path}` : `Uses step ${i}`,
    uses: i === 0 ? [] : [{ symbol: paths[i - 1], definedInStep: i, definedInPath: paths[i - 1] }],
  }))
}

function chapterOfPaths(id: string, paths: string[]): Chapter {
  return {
    id,
    name: `Chapter ${id}`,
    files: paths.map((path) => ({ path }) as never),
    estimatedMinutes: 1,
    status: 'not-started',
  }
}

describe('computeInsights() — understandability', () => {
  it('counts semantic lines-to-read, excludes tier-3 files, and rates level', async () => {
    const insights = await insightsOf([FEATURE_FILE, LOCK_FILE], baseOpts)
    // Only src/feature.ts's semantic hunk counts; the lock file is tier 3.
    expect(insights.understandability.linesToRead).toBe(3)
    expect(insights.understandability.newExports).toBeGreaterThan(0)
    expect(insights.understandability.level).toBe('easy')
    expect(insights.understandability.source).toBe('reading-order graph')
  })

  it('derives the longest dependency chain and cross-chapter refs from the reading order', async () => {
    const readingOrder = chainedReadingOrder(['a.ts', 'b.ts', 'c.ts'])
    const chapters = [chapterOfPaths('ch1', ['a.ts']), chapterOfPaths('ch2', ['b.ts', 'c.ts'])]
    const insights = await insightsOf([], { ...baseOpts, readingOrder, chapters })
    expect(insights.understandability.longestChain).toBe(3)
    // b.ts (chapter 2) uses a.ts (chapter 1) — one cross-chapter ref.
    expect(insights.understandability.crossChapterRefs).toBe(1)
  })

  it('rates a chain of three moderate and a chain of six hard', async () => {
    const three = chainedReadingOrder(['a.ts', 'b.ts', 'c.ts'])
    const six = chainedReadingOrder(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'])
    const moderate = await insightsOf([], { ...baseOpts, readingOrder: three })
    const hard = await insightsOf([], { ...baseOpts, readingOrder: six })
    expect(moderate.understandability.level).toBe('moderate')
    expect(hard.understandability.level).toBe('hard')
  })
})
