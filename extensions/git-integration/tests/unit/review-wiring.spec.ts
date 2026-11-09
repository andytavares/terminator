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

describe('applyReadingOrder', () => {
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
})

describe('applyReadingOrder — chapter summary', () => {
  it('summarises each chapter by the symbols its steps change and its test files', () => {
    const review = chapter('review', ['src/session.ts', 'src/store.ts', 'tests/session.spec.ts'])
    review.files[2] = { ...review.files[2], tier: 2 }
    const out = applyReadingOrder(
      [review],
      [
        { ...step(1, 'src/session.ts', 'Defines markViewed'), symbol: 'markViewed' },
        { ...step(2, 'src/store.ts', 'Calls markViewed (step 1)'), symbol: 'viewAll' },
        step(3, 'tests/session.spec.ts', 'Tests step 1, read right after it'),
      ]
    )
    expect(out[0].summary).toBe('Changes markViewed and viewAll · 1 test file')
  })

  it('names at most three symbols in a chapter summary and counts the rest', () => {
    const paths = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']
    const out = applyReadingOrder(
      [chapter('many', paths)],
      paths.map((p, i) => ({ ...step(i + 1, p, 'Defines it'), symbol: `s${i + 1}` }))
    )
    expect(out[0].summary).toBe('Changes s1, s2, s3 and 2 more')
  })

  it('gives a chapter no summary when none of its steps names a symbol', () => {
    const out = applyReadingOrder(
      [chapter('docs', ['docs/guide.md'])],
      [step(1, 'docs/guide.md', 'No dependencies detected in this PR')]
    )
    expect(out[0].summary).toBeUndefined()
  })
})

describe('applyReadingOrder — without steps', () => {
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
})

describe('findTestReferencesInRepo — symbols and repositories it cannot grep', () => {
  it.each([
    { name: 'no symbols', repoRoot: '/repo', symbols: [] as string[], gitRuns: 0 },
    { name: 'an uncloned repo', repoRoot: 'gh:acme/widgets', symbols: ['a'], gitRuns: 0 },
    { name: 'a grep with no match', repoRoot: '/repo', symbols: ['a'], gitRuns: 1 },
  ])(
    'returns nothing for $name, after $gitRuns git runs',
    async ({ repoRoot, symbols, gitRuns }) => {
      // git grep exits 1 when nothing matches.
      const runGit = vi.fn().mockRejectedValue(new Error('exit 1'))
      const found = await findTestReferencesInRepo(repoRoot, symbols, runGit)
      expect([...found]).toEqual([])
      expect(runGit).toHaveBeenCalledTimes(gitRuns)
    }
  )

  it('greps only for the symbols that are plain identifiers', async () => {
    const runGit = vi.fn().mockResolvedValue('')
    await findTestReferencesInRepo('/repo', ['ok_name', 'bad name', 'a|b'], runGit)
    const args = runGit.mock.calls[0][1] as string[]
    expect(args.slice(0, 7)).toEqual(['grep', '-h', '-o', '-w', '-E', 'ok_name', '--'])
  })
})
