import { describe, it, expect } from 'vitest'
import { buildReadingOrder } from '../../src/review/reading-order'
import { parsePrFiles } from '../../src/review/parsed-file'

const readingOrderOf = (files: unknown[]) => buildReadingOrder(parsePrFiles(files))

// ─── Acceptance fixture: 7 real paths from this PR's own diff ─────────────────
// Sizes are tuned so tie-breaking (higher additions+deletions first among free
// files) lands on the exact order the design doc specifies.

const schemaFile = {
  path: 'extensions/git-integration/src/schemas/pr-review.schema.ts',
  additions: 8,
  deletions: 2,
  patch: [
    '@@ -15,0 +16,8 @@ export const RiskScoreSchema',
    '+export const RiskScoreSchema = z.object({',
    "+  level: z.enum(['low', 'medium', 'high']),",
    '+  composite: z.number().nullable(),',
    '+})',
    '+',
    '+export type RiskScore = z.infer<typeof RiskScoreSchema>',
  ].join('\n'),
}

const serviceFile = {
  path: 'extensions/git-integration/src/github/pr-review-service.ts',
  additions: 90,
  deletions: 10,
  patch: [
    '@@ -85,0 +89,4 @@ export function computeRiskScore',
    '+export function computeRiskScore(metrics: FileMetrics, allFilesMetrics: FileMetrics[]): RiskScore {',
    "+  const level = metrics.churn90d && metrics.blastRadius ? 'high' : 'low'",
    '+  return { level, composite: null } as RiskScore',
    '+}',
  ].join('\n'),
}

const specFile = {
  path: 'extensions/git-integration/tests/unit/risk-score.spec.ts',
  additions: 5,
  deletions: 0,
  patch: [
    "@@ -0,0 +1,5 @@ describe('computeRiskScore')",
    "+describe('computeRiskScore', () => {",
    "+  it('returns high risk for high churn', () => {",
    '+    const result = computeRiskScore(metrics, [])',
    '+  })',
    '+})',
  ].join('\n'),
}

const useHookFile = {
  path: 'extensions/git-integration/src/hooks/usePrReview.ts',
  additions: 80,
  deletions: 5,
  patch: [
    "@@ -14,0 +15,3 @@ import { computeRiskScore } from '../github/pr-review-service'",
    '+export function useRiskScore(metrics: FileMetrics) {',
    '+  return computeRiskScore(metrics, [])',
    '+}',
  ].join('\n'),
}

const healthChipsFile = {
  path: 'extensions/git-integration/src/components/pr-review/HealthChips.tsx',
  additions: 45,
  deletions: 5,
  patch: [
    "@@ -1,0 +2,6 @@ import type { RiskScore } from '../../schemas/pr-review.schema'",
    "+import type { RiskScore } from '../../schemas/pr-review.schema'",
    '+',
    '+interface HealthChipsProps {',
    '+  riskScore: RiskScore',
    '+}',
    '+export function HealthChips({ riskScore }: HealthChipsProps) {',
    '+  return <div>{riskScore.level}</div>',
    '+}',
  ].join('\n'),
}

const riskBreakdownFile = {
  path: 'extensions/git-integration/src/components/pr-review/RiskBreakdownPanel.tsx',
  additions: 35,
  deletions: 5,
  patch: [
    "@@ -1,0 +2,4 @@ import type { RiskScore } from '../../schemas/pr-review.schema'",
    "+import type { RiskScore } from '../../schemas/pr-review.schema'",
    '+export function RiskBreakdownPanel({ riskScore }: { riskScore: RiskScore }) {',
    '+  return <div>{riskScore.composite}</div>',
    '+}',
  ].join('\n'),
}

const reviewDiffPaneFile = {
  path: 'extensions/git-integration/src/components/pr-review/ReviewDiffPane.tsx',
  additions: 4,
  deletions: 1,
  patch: [
    '@@ -328,0 +329,3 @@ export function ReviewDiffPane()',
    '+export function ReviewDiffPane() {',
    '+  return <HealthChips riskScore={score} />',
    '+}',
  ].join('\n'),
}

const readmeFile = {
  path: 'docs/README.md',
  additions: 1,
  deletions: 1,
  patch: ['@@ -1,1 +1,1 @@', '-old text', '+new text'].join('\n'),
}

const ACCEPTANCE_FILES_IN_READING_ORDER = [
  schemaFile,
  serviceFile,
  specFile,
  useHookFile,
  healthChipsFile,
  riskBreakdownFile,
  reviewDiffPaneFile,
  readmeFile,
]

describe('buildReadingOrder() — acceptance', () => {
  it('orders the 7 real files by definitions-first reading order, with the unknown-language file still appearing', async () => {
    const steps = await readingOrderOf(ACCEPTANCE_FILES_IN_READING_ORDER)

    const paths = steps.map((s) => s.path)
    expect(paths).toEqual(ACCEPTANCE_FILES_IN_READING_ORDER.map((f) => f.path))

    const byPath = new Map(steps.map((s) => [s.path, s]))
    expect(byPath.get(schemaFile.path)?.reason).toBe(
      'Defines RiskScore · depends on nothing in this PR'
    )
    expect(byPath.get(serviceFile.path)?.reason).toBe('Uses RiskScore (step 1)')
    expect(byPath.get(specFile.path)?.reason).toBe('Tests step 2, read right after it')
    expect(byPath.get(useHookFile.path)?.reason).toBe('Calls computeRiskScore (step 2)')
    expect(byPath.get(healthChipsFile.path)?.reason).toBe('Uses RiskScore (step 1)')
    expect(byPath.get(riskBreakdownFile.path)?.reason).toBe('Uses RiskScore (step 1)')
    expect(byPath.get(reviewDiffPaneFile.path)?.reason).toBe('Renders HealthChips (step 5)')

    // Steps are 1-based and match the array position.
    steps.forEach((s, i) => expect(s.step).toBe(i + 1))
  })
})

describe('buildReadingOrder() — cycles', () => {
  it('keeps a 2-file cycle adjacent', async () => {
    const a = {
      path: 'src/a.ts',
      additions: 10,
      deletions: 0,
      patch: [
        '@@ -0,0 +1,3 @@ export function fromA',
        '+export function fromA() {',
        '+  return fromB()',
        '+}',
      ].join('\n'),
    }
    const b = {
      path: 'src/b.ts',
      additions: 10,
      deletions: 0,
      patch: [
        '@@ -0,0 +1,3 @@ export function fromB',
        '+export function fromB() {',
        '+  return fromA()',
        '+}',
      ].join('\n'),
    }
    const steps = await readingOrderOf([a, b])
    const positions = new Map(steps.map((s) => [s.path, s.step]))
    expect(Math.abs(positions.get('src/a.ts')! - positions.get('src/b.ts')!)).toBe(1)
  })
})

describe('buildReadingOrder() — edge cases', () => {
  it('returns [] for no files', async () => {
    expect(await readingOrderOf([])).toEqual([])
  })

  it('still returns a step for a file whose test-reference has no in-PR definer', async () => {
    const orphanSpec = {
      path: 'tests/unit/orphan.spec.ts',
      additions: 3,
      deletions: 0,
      patch: [
        '@@ -0,0 +1,3 @@ describe',
        "+describe('orphan', () => {",
        '+  expect(true).toBe(true)',
        '+})',
      ].join('\n'),
    }
    const steps = await readingOrderOf([orphanSpec])
    expect(steps).toHaveLength(1)
    expect(steps[0].path).toBe(orphanSpec.path)
  })
})

describe('buildReadingOrder() — reference wording', () => {
  it('says "Uses" for a type argument such as Record<Priority, number>, not "Renders"', async () => {
    const files = [
      {
        filename: 'src/test-batch/pr-050/types.ts',
        additions: 1,
        deletions: 0,
        patch: "@@ -0,0 +1,1 @@\n+export type Priority = 'low' | 'medium' | 'high' | 'critical'",
      },
      {
        filename: 'src/test-batch/pr-050/utils.ts',
        additions: 3,
        deletions: 0,
        patch: [
          '@@ -0,0 +1,3 @@',
          "+import type { Priority } from './types'",
          '+const PRIORITY_WEIGHT: Record<Priority, number> = { low: 1, medium: 2, high: 3, critical: 4 }',
          '+export const weightOf = (p: Priority) => PRIORITY_WEIGHT[p]',
        ].join('\n'),
      },
    ]
    const order = await readingOrderOf(files)
    expect(order.find((s) => s.path.endsWith('utils.ts'))?.reason).toBe('Uses Priority (step 1)')
  })
})

describe('buildReadingOrder() — the reference a reason names', () => {
  it('names the call, not an earlier type use, when a file does both', async () => {
    const types = {
      path: 'src/types.ts',
      additions: 10,
      deletions: 0,
      patch: '@@ -0,0 +1,1 @@\n+export type Weight = number',
    }
    const scale = {
      path: 'src/scale.ts',
      additions: 3,
      deletions: 0,
      patch: '@@ -0,0 +1,3 @@\n+export function scale(n: number) {\n+  return n * 2\n+}',
    }
    const user = {
      path: 'src/user.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -0,0 +1,1 @@\n+export const w: Weight = scale(1)',
    }
    const order = await readingOrderOf([types, scale, user])
    expect(order.find((s) => s.path === 'src/user.ts')?.reason).toBe('Calls scale (step 2)')
  })
})

describe('buildReadingOrder() — files outside the dependency graph', () => {
  it('puts a lock file last, after the code it was listed before', async () => {
    const lock = {
      path: 'package-lock.json',
      additions: 2,
      deletions: 2,
      patch: '@@ -1,1 +1,1 @@\n-"a": "1"\n+"a": "2"',
    }
    const order = await readingOrderOf([lock, schemaFile])
    expect(order.map((s) => s.path)).toEqual([schemaFile.path, 'package-lock.json'])
  })

  it('adds no ordering edge for a symbol only a test file defines', async () => {
    const helperSpec = {
      path: 'tests/unit/thing.spec.ts',
      additions: 3,
      deletions: 0,
      patch: '@@ -0,0 +1,3 @@\n+export function makeThing() {\n+  return useThing()\n+}',
    }
    const source = {
      path: 'src/thing.ts',
      additions: 3,
      deletions: 0,
      patch: '@@ -0,0 +1,3 @@\n+export function useThing() {\n+  return makeThing()\n+}',
    }
    const order = await readingOrderOf([helperSpec, source])
    expect(order.map((s) => s.path)).toEqual(['src/thing.ts', 'tests/unit/thing.spec.ts'])
  })
})
