import { describe, it, expect, vi } from 'vitest'
import { applyReadingOrder } from '../../src/review/apply-reading-order'
import { findTestReferencesInRepo } from '../../src/review/test-references'
import type { Chapter, PrChangedFile, ReadingStep } from '../../src/schemas/pr-review.schema'

function file(path: string): PrChangedFile {
  return {
    path,
    changeType: 'modified',
    additions: 10,
    deletions: 2,
    isBinary: false,
    tier: 1,
    whyHere: 'Source file — implementation',
    riskScore: {
      level: 'low',
      composite: null,
      metrics: {
        changeSize: null,
        churn90d: null,
        blastRadius: null,
        testFilePresent: null,
        complexityDelta: null,
        patchCoverage: null,
      },
      dominantDriver: 'Not yet computed',
      topImporters: [],
      importerCount: 0,
    },
    estimatedMinutes: 1,
  }
}

function chapter(id: string, paths: string[]): Chapter {
  return { id, name: id, files: paths.map(file), estimatedMinutes: 1, status: 'not-started' }
}

function step(n: number, path: string, reason: string): ReadingStep {
  return { step: n, path, symbol: null, reason, uses: [] }
}

describe('applyReadingOrder', () => {
  // buildChapters' real output for the risk-score example (see the design doc).
  const chapters = [
    chapter('ui', [
      'src/components/pr-review/ReviewDiffPane.tsx',
      'src/components/pr-review/HealthChips.tsx',
      'src/components/pr-review/RiskBreakdownPanel.tsx',
    ]),
    chapter('hooks', ['src/hooks/usePrReview.ts']),
    chapter('data-layer', ['src/github/pr-review-service.ts', 'src/schemas/pr-review.schema.ts']),
    chapter('tests', ['tests/unit/risk-score.spec.ts']),
  ]
  const order = [
    step(1, 'src/schemas/pr-review.schema.ts', 'Defines RiskScore · depends on nothing in this PR'),
    step(2, 'src/github/pr-review-service.ts', 'Uses RiskScore (step 1)'),
    step(3, 'tests/unit/risk-score.spec.ts', 'Tests step 2, read right after it'),
    step(4, 'src/hooks/usePrReview.ts', 'Calls computeRiskScore (step 2)'),
    step(5, 'src/components/pr-review/HealthChips.tsx', 'Uses RiskScore (step 1)'),
    step(6, 'src/components/pr-review/RiskBreakdownPanel.tsx', 'Uses RiskScore (step 1)'),
    step(7, 'src/components/pr-review/ReviewDiffPane.tsx', 'Renders HealthChips (step 5)'),
  ]

  it('orders chapters by their earliest step and files by step, with the step reason', () => {
    const out = applyReadingOrder(chapters, order)
    expect(out.map((c) => c.id)).toEqual(['data-layer', 'tests', 'hooks', 'ui'])
    expect(out[0].files.map((f) => f.path)).toEqual([
      'src/schemas/pr-review.schema.ts',
      'src/github/pr-review-service.ts',
    ])
    expect(out[3].files.map((f) => f.path)).toEqual([
      'src/components/pr-review/HealthChips.tsx',
      'src/components/pr-review/RiskBreakdownPanel.tsx',
      'src/components/pr-review/ReviewDiffPane.tsx',
    ])
    expect(out[3].files[2].whyHere).toBe('Renders HealthChips (step 5)')
  })

  it('leaves chapters untouched when there is no reading order', () => {
    expect(applyReadingOrder(chapters, [])).toBe(chapters)
  })

  it('keeps files without a step after the stepped ones, in their old order', () => {
    const out = applyReadingOrder(
      [chapter('mixed', ['package-lock.json', 'src/b.ts', 'src/a.ts'])],
      [step(1, 'src/a.ts', 'Uses x (step 1)'), step(2, 'src/b.ts', 'Calls a (step 1)')]
    )
    expect(out[0].files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'package-lock.json'])
    expect(out[0].files[2].whyHere).toBe('Source file — implementation')
  })
})

describe('findTestReferencesInRepo', () => {
  it('greps test files once and returns the symbols they mention', async () => {
    const runGit = vi.fn().mockResolvedValue('computeRiskScore\ncomputeRiskScore\nqueueRiskLevel\n')
    const found = await findTestReferencesInRepo(
      '/repo',
      ['computeRiskScore', 'shardByDuration', 'queueRiskLevel'],
      runGit
    )
    expect([...found].sort()).toEqual(['computeRiskScore', 'queueRiskLevel'])
    expect(runGit).toHaveBeenCalledTimes(1)
    const args = runGit.mock.calls[0][1] as string[]
    expect(args.slice(0, 4)).toEqual(['grep', '-h', '-o', '-w'])
    expect(args).toContain('computeRiskScore|shardByDuration|queueRiskLevel')
    expect(args).toContain('*.spec.*')
  })

  it('returns nothing for no symbols, an uncloned repo, or a grep with no match', async () => {
    const runGit = vi.fn().mockRejectedValue(new Error('exit 1'))
    expect((await findTestReferencesInRepo('/repo', [], runGit)).size).toBe(0)
    expect((await findTestReferencesInRepo('gh:acme/widgets', ['a'], runGit)).size).toBe(0)
    expect((await findTestReferencesInRepo('/repo', ['a'], runGit)).size).toBe(0)
    expect(runGit).toHaveBeenCalledTimes(1)
  })

  it('ignores symbols that are not plain identifiers', async () => {
    const runGit = vi.fn().mockResolvedValue('')
    await findTestReferencesInRepo('/repo', ['ok_name', 'bad name', 'a|b'], runGit)
    expect(runGit.mock.calls[0][1]).toContain('ok_name')
  })
})
