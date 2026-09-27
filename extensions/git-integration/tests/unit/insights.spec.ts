import { describe, it, expect } from 'vitest'
import { computeInsights, type ComputeInsightsOptions } from '../../src/review/insights'
import type { Chapter, DryViolation, ReadingStep } from '../../src/schemas/pr-review.schema'

const baseOpts: ComputeInsightsOptions = {
  readingOrder: [],
  chapters: [],
  statusChecks: [],
  dryViolations: [],
  localCoverage: null,
}

describe('computeInsights() — complexity', () => {
  it('reports a positive branch delta for a function that gains branches', async () => {
    const files = [
      {
        path: 'src/risky.ts',
        additions: 4,
        deletions: 1,
        patch: [
          '@@ -1,3 +1,6 @@ export function risky',
          ' export function risky(a: number, b: number) {',
          '-  return a',
          '+  if (a && b) {',
          '+    return a || b',
          '+  }',
          '+  return a',
          ' }',
        ].join('\n'),
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    expect(insights.complexity.source).toBe('tree-sitter · hunk base vs head')
    expect(insights.complexity.branchDelta).toBeGreaterThan(0)
    const fn = insights.complexity.functions.find((f) => f.name === 'risky')
    expect(fn).toBeDefined()
    expect(fn!.branchDelta).toBeGreaterThan(0)
    expect(fn!.path).toBe('src/risky.ts')
  })

  it('does not score configuration files such as a CI workflow', async () => {
    const files = [
      {
        filename: '.github/workflows/ci.yml',
        patch: [
          '@@ -120,4 +120,4 @@ jobs:',
          "-        if: github.event_name == 'pull_request' && needs.select.outputs.burn == 'true'",
          "+        if: needs.select.outputs.burn == 'true'",
          '         run: npx playwright test --repeat-each=3',
        ].join('\n'),
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    expect(insights.complexity.branchDelta).toBe(0)
    expect(insights.complexity.functions).toEqual([])
  })

  it('reports a function at its line in the file, not its line in the hunk', async () => {
    const files = [
      {
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
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    const fn = insights.complexity.functions.find((f) => f.name === 'computeRiskScore')
    expect(fn?.line).toBe(82)
  })

  it('skips files with no patch or no path, and accounts for a removed function', async () => {
    const files = [
      { path: 'src/nopatch.ts', additions: 0, deletions: 0 },
      { additions: 1, deletions: 0, patch: '@@ -0,0 +1,1 @@\n+x' },
      {
        path: 'src/shrink.ts',
        additions: 0,
        deletions: 5,
        patch: [
          '@@ -1,5 +1,0 @@ export function shrink',
          '-export function shrink(a: number, b: number) {',
          '-  if (a && b) {',
          '-    return a',
          '-  }',
          '-}',
        ].join('\n'),
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    // The whole function was removed — its branches subtract from the total delta.
    expect(insights.complexity.branchDelta).toBeLessThan(0)
  })

  it('does not flag a fallback file whose keyword count is unchanged', async () => {
    const files = [
      {
        path: 'infra/steady.tf',
        additions: 1,
        deletions: 1,
        patch: ['@@ -1,1 +1,1 @@', '-name = "a"', '+name = "b"'].join('\n'),
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    expect(insights.complexity.functions).toEqual([])
  })

  it('falls back to keyword counting for a file with no grammar', async () => {
    const files = [
      {
        path: 'infra/deploy.tf',
        additions: 2,
        deletions: 0,
        patch: ['@@ -1,0 +2,2 @@ resource', '+  if (a && b) {}', '+  if (c || d) {}'].join('\n'),
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    expect(insights.complexity.source).toBe('keyword count · approximate')
    expect(insights.complexity.branchDelta).toBeGreaterThan(0)
  })
})

describe('computeInsights() — coverage', () => {
  it('marks a changed function tested when a PR test file references it', async () => {
    const files = [
      {
        path: 'src/util.ts',
        additions: 3,
        deletions: 0,
        patch: [
          '@@ -0,0 +1,3 @@ export function addOne',
          '+export function addOne(n: number) {',
          '+  return n + 1',
          '+}',
        ].join('\n'),
      },
      {
        path: 'tests/unit/util.spec.ts',
        additions: 2,
        deletions: 0,
        patch: [
          '@@ -0,0 +1,2 @@ describe',
          '+const result = addOne(1)',
          '+expect(result).toBe(2)',
        ].join('\n'),
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    expect(insights.coverage.changedFunctions).toBe(1)
    expect(insights.coverage.testedFunctions).toBe(1)
    expect(insights.coverage.untestedFunctions).toEqual([])
    expect(insights.coverage.source).toBe('test files referencing each changed function')
  })

  it('falls back to findTestReferences (repo grep) when no PR test file covers a function', async () => {
    const files = [
      {
        path: 'src/util.ts',
        additions: 3,
        deletions: 0,
        patch: [
          '@@ -0,0 +1,3 @@ export function subtractOne',
          '+export function subtractOne(n: number) {',
          '+  return n - 1',
          '+}',
        ].join('\n'),
      },
    ]
    const withoutRepoTests = await computeInsights(files, baseOpts)
    expect(withoutRepoTests.coverage.untestedFunctions).toContain('subtractOne')

    const withRepoTests = await computeInsights(files, {
      ...baseOpts,
      findTestReferences: async (symbols) => new Set(symbols.filter((s) => s === 'subtractOne')),
    })
    expect(withRepoTests.coverage.testedFunctions).toBe(1)
    expect(withRepoTests.coverage.untestedFunctions).toEqual([])
  })

  it('parses a patch-coverage percentage from a matching status check description', async () => {
    const files = [
      {
        path: 'src/util.ts',
        additions: 1,
        deletions: 0,
        patch: ['@@ -0,0 +1,1 @@', '+export const x = 1'].join('\n'),
      },
    ]
    const insights = await computeInsights(files, {
      ...baseOpts,
      statusChecks: [{ name: 'codecov/patch', state: 'pass', description: '84.21% of diff hit' }],
    })
    expect(insights.coverage.patchPercent).toBe(84)
  })

  it('falls back to localCoverage, then to null, when no CI check reports it', async () => {
    const files = [
      {
        path: 'src/util.ts',
        additions: 1,
        deletions: 0,
        patch: ['@@ -0,0 +1,1 @@', '+export const x = 1'].join('\n'),
      },
    ]
    const withLocal = await computeInsights(files, { ...baseOpts, localCoverage: 72.6 })
    expect(withLocal.coverage.patchPercent).toBe(73)

    const withNeither = await computeInsights(files, baseOpts)
    expect(withNeither.coverage.patchPercent).toBeNull()
  })
})

describe('computeInsights() — health flags', () => {
  it('flags TODO, eslint-disable, @ts-ignore and new any in added lines', async () => {
    const files = [
      {
        path: 'src/health.ts',
        additions: 4,
        deletions: 0,
        patch: [
          '@@ -0,0 +1,4 @@',
          '+// TODO: revisit this',
          '+// eslint-disable-next-line no-console',
          '+// @ts-ignore',
          '+export function f(x: any) { return x }',
        ].join('\n'),
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    const kinds = insights.health.flags.map((f) => f.kind)
    expect(kinds).toContain('todo')
    expect(kinds).toContain('eslint-disable')
    expect(kinds).toContain('ts-ignore')
    expect(kinds).toContain('any')
    expect(insights.health.source).toBe('tree-sitter · detectDryViolations')
  })

  it('flags a function over 80 lines, deep nesting and too many parameters', async () => {
    const bodyLines = Array.from({ length: 82 }, (_, i) => `  const v${i} = ${i}`)
    const longFn = ['+export function longFn() {', ...bodyLines.map((l) => `+${l}`), '+}']
    const nested = [
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
    const manyParams = [
      '+export function manyParams(a: number, b: number, c: number, d: number, e: number, f: number) {',
      '+  return a',
      '+}',
    ]

    const files = [
      {
        path: 'src/long.ts',
        additions: 84,
        deletions: 0,
        patch: ['@@ -0,0 +1,84 @@', ...longFn].join('\n'),
      },
      {
        path: 'src/deep.ts',
        additions: 12,
        deletions: 0,
        patch: ['@@ -0,0 +1,12 @@', ...nested].join('\n'),
      },
      {
        path: 'src/params.ts',
        additions: 3,
        deletions: 0,
        patch: ['@@ -0,0 +1,3 @@', ...manyParams].join('\n'),
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    const kinds = insights.health.flags.map((f) => f.kind)
    expect(kinds).toContain('long-function')
    expect(kinds).toContain('deep-nesting')
    expect(kinds).toContain('many-params')
  })

  it('adds one flag per DRY violation group', async () => {
    const violation: DryViolation = { files: ['a.ts', 'b.ts'], fingerprint: 'x', lineCount: 5 }
    const insights = await computeInsights([], { ...baseOpts, dryViolations: [violation] })
    expect(insights.health.flags.filter((f) => f.kind === 'duplicate-block')).toHaveLength(1)
  })
})

describe('computeInsights() — understandability', () => {
  it('counts semantic lines-to-read, excludes tier-3 files, and rates level', async () => {
    const files = [
      {
        path: 'src/feature.ts',
        additions: 3,
        deletions: 0,
        patch: [
          '@@ -0,0 +1,3 @@ export function feature',
          '+export function feature() {',
          '+  return 1',
          '+}',
        ].join('\n'),
      },
      {
        path: 'package-lock.json',
        additions: 500,
        deletions: 500,
        patch: ['@@ -0,0 +1,1 @@', '-"a": "1"', '+"a": "2"'].join('\n'),
      },
    ]
    const insights = await computeInsights(files, baseOpts)
    // Only src/feature.ts's semantic hunk counts; the lock file is tier 3.
    expect(insights.understandability.linesToRead).toBe(3)
    expect(insights.understandability.newExports).toBeGreaterThan(0)
    expect(insights.understandability.level).toBe('easy')
    expect(insights.understandability.source).toBe('reading-order graph')
  })

  it('derives the longest dependency chain and cross-chapter refs from the reading order', async () => {
    const readingOrder: ReadingStep[] = [
      { step: 1, path: 'a.ts', symbol: 'A', reason: 'Defines A', uses: [] },
      {
        step: 2,
        path: 'b.ts',
        symbol: 'B',
        reason: 'Uses A (step 1)',
        uses: [{ symbol: 'A', definedInStep: 1, definedInPath: 'a.ts' }],
      },
      {
        step: 3,
        path: 'c.ts',
        symbol: 'C',
        reason: 'Uses B (step 2)',
        uses: [{ symbol: 'B', definedInStep: 2, definedInPath: 'b.ts' }],
      },
    ]
    const chapters: Chapter[] = [
      {
        id: 'ch1',
        name: 'Chapter 1',
        files: [{ path: 'a.ts' } as never],
        estimatedMinutes: 1,
        status: 'not-started',
      },
      {
        id: 'ch2',
        name: 'Chapter 2',
        files: [{ path: 'b.ts' } as never, { path: 'c.ts' } as never],
        estimatedMinutes: 1,
        status: 'not-started',
      },
    ]
    const insights = await computeInsights([], { ...baseOpts, readingOrder, chapters })
    expect(insights.understandability.longestChain).toBe(3)
    // b.ts (chapter 2) uses a.ts (chapter 1) — one cross-chapter ref.
    expect(insights.understandability.crossChapterRefs).toBe(1)
  })
})
