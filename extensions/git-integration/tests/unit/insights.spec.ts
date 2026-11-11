import { describe, it, expect, vi, afterEach } from 'vitest'
import { Parser, Tree } from 'web-tree-sitter'
import {
  computeInsights,
  measureDiffComplexity,
  type ComputeInsightsOptions,
} from '../../src/review/insights'
import type { Chapter, DryViolation, ReadingStep } from '../../src/schemas/pr-review.schema'
import { parsePrFiles } from '../../src/review/parsed-file'
import { parsePrFileDiff } from '../../src/github/pr-review-service'

const insightsOf = (files: unknown[], opts: ComputeInsightsOptions) =>
  computeInsights(parsePrFiles(files), opts)

const baseOpts: ComputeInsightsOptions = {
  readingOrder: [],
  chapters: [],
  dryViolations: [],
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
  it('subtracts the branches of a removed function (an if and an &&) from the branch delta', async () => {
    const insights = await insightsOf([SHRINK_FILE], baseOpts)
    expect(insights.complexity.branchDelta).toBe(-2)
  })

  it('measures the same complexity with a file that has no patch beside it', async () => {
    const noPatch = { path: 'src/nopatch.ts', additions: 0, deletions: 0 }
    const alone = await insightsOf([SHRINK_FILE], baseOpts)
    const beside = await insightsOf([noPatch, SHRINK_FILE], baseOpts)
    expect(beside.complexity).toEqual(alone.complexity)
  })

  it('measures nothing for a file with no grammar', async () => {
    const insights = await insightsOf([STEADY_TF_FILE, DEPLOY_TF_FILE], baseOpts)
    expect(insights.complexity.functions).toEqual([])
    expect(insights.complexity.branchDelta).toBe(0)
  })
})

const BUSY_PATCH = [
  '@@ -0,0 +1,9 @@',
  '+export function busy(a: number) {',
  '+  if (a > 1) return 1',
  '+  if (a > 2) return 2',
  '+  if (a > 3) return 3',
  '+  if (a > 4) return 4',
  '+  if (a > 5) return 5',
  '+  if (a > 6) return 6',
  '+  return 0',
  '+}',
  '@@ -20,0 +30,3 @@',
  '+export function calm(a: number) {',
  '+  return a',
  '+}',
].join('\n')

describe('measureDiffComplexity()', () => {
  it('flags only the hunk that adds five or more branches', async () => {
    const measured = await measureDiffComplexity('src/busy.ts', parsePrFileDiff(BUSY_PATCH, 'x'))
    expect(measured?.delta).toBe(6)
    expect(measured?.hotspots).toEqual([
      expect.objectContaining({ hunkIndex: 0, complexityDelta: 6 }),
    ])
  })

  it('returns null for a file with no grammar', async () => {
    expect(await measureDiffComplexity('infra/a.tf', parsePrFileDiff(BUSY_PATCH, 'x'))).toBeNull()
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

describe('computeInsights() — health flags', () => {
  it('flags a new TODO and no language-specific marker in added lines', async () => {
    const insights = await insightsOf([MARKERS_FILE], baseOpts)
    expect(insights.health.flags.map((f) => f.kind)).toEqual(['todo'])
    expect(insights.health.source).toBe('tree-sitter · detectDryViolations')
  })

  it('adds one flag per DRY violation group', async () => {
    const violation: DryViolation = { files: ['a.ts', 'b.ts'], fingerprint: 'x', lineCount: 5 }
    const insights = await insightsOf([], { ...baseOpts, dryViolations: [violation] })
    expect(insights.health.flags.filter((f) => f.kind === 'duplicate-block')).toHaveLength(1)
  })
})

/** A file whose patch adds `lines` as a new file. */
function addedFile(path: string, lines: string[]) {
  const patch = [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)]
  return changedFileWithPatch(path, patch, { additions: lines.length, deletions: 0 })
}

const eightyAssignments = (prefix: string) =>
  Array.from({ length: 80 }, (_, i) => `${prefix}v${i} = ${i}`)

/** 92 lines, five nested ifs, six parameters. */
const OVERSIZED_TS_FILE = addedFile('src/oversized.ts', [
  'export function oversized(a: number, b: number, c: number, d: number, e: number, f: number) {',
  '  if (a) {',
  '    if (b) {',
  '      if (c) {',
  '        if (d) {',
  '          if (e) { return f }',
  '        }',
  '      }',
  '    }',
  '  }',
  ...eightyAssignments('  const '),
  '  return 0',
  '}',
])

/** 88 lines, five nested ifs, six parameters. */
const OVERSIZED_PY_FILE = addedFile('oversized.py', [
  'def oversized(a, b, c, d, e, f):',
  '    if a:',
  '        if b:',
  '            if c:',
  '                if d:',
  '                    if e:',
  '                        return f',
  ...eightyAssignments('    '),
  '    return 0',
])

const SMALL_GO_FILE = addedFile('small.go', [
  'package small',
  '',
  'func Larger(a int, b int) int {',
  '\tif a > b {',
  '\t\treturn a',
  '\t}',
  '\treturn b',
  '}',
])

const CHAINED_CONDITION_FILE = addedFile('src/ready.ts', [
  'export function ready(a: boolean, b: boolean, c: boolean) {',
  '  if (a && b && c && a && b && c) return true',
  '  return false',
  '}',
])

describe('computeInsights() — conditions are not nesting', () => {
  it('flags no nesting for one if whose condition chains six operands', async () => {
    const insights = await insightsOf([CHAINED_CONDITION_FILE], baseOpts)
    expect(insights.health.flags).toEqual([])
  })
})

describe('computeInsights() — function health flags in any grammar', () => {
  it('flags a TypeScript function over 80 lines, nested five deep, with six parameters', async () => {
    const insights = await insightsOf([OVERSIZED_TS_FILE], baseOpts)
    expect(insights.health.flags).toEqual([
      { kind: 'long-function', label: 'Function over 80 lines (92)', path: 'src/oversized.ts' },
      { kind: 'deep-nesting', label: 'Nesting depth 5', path: 'src/oversized.ts' },
      { kind: 'many-params', label: '6 parameters', path: 'src/oversized.ts' },
    ])
  })

  it('flags a Python function over 80 lines, nested five deep, with six parameters', async () => {
    const insights = await insightsOf([OVERSIZED_PY_FILE], baseOpts)
    expect(insights.health.flags).toEqual([
      { kind: 'long-function', label: 'Function over 80 lines (88)', path: 'oversized.py' },
      { kind: 'deep-nesting', label: 'Nesting depth 5', path: 'oversized.py' },
      { kind: 'many-params', label: '6 parameters', path: 'oversized.py' },
    ])
  })

  it('flags nothing for a short, shallow Go function with two parameters', async () => {
    const insights = await insightsOf([SMALL_GO_FILE], baseOpts)
    expect(insights.health.flags).toEqual([])
  })
})

const FEATURE_FILE = changedFileWithPatch(
  'src/feature.ts',
  ['@@ -0,0 +1,3 @@ export function feature', '+export function feature() {', '+  return 1', '+}'],
  { additions: 3, deletions: 0 }
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
    status: 'not-started',
  }
}

describe('computeInsights() — understandability', () => {
  it('counts semantic lines-to-read and rates level', async () => {
    const insights = await insightsOf([FEATURE_FILE], baseOpts)
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
