import { describe, it, expect } from 'vitest'
import { applyReadingOrder } from '../../src/review/apply-reading-order'
import type { Chapter, PrChangedFile, ReadingStep } from '../../src/schemas/pr-review.schema'

function file(path: string): PrChangedFile {
  return {
    path,
    changeType: 'modified',
    additions: 10,
    deletions: 2,
    isBinary: false,
    whyHere: 'Source file — implementation',
    churn90d: null,
    blastRadius: null,
    hunkCount: 1,
  }
}

function chapter(id: string, paths: string[]): Chapter {
  return { id, name: id, files: paths.map(file), status: 'not-started' }
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
  it('summarises each chapter by the symbols its steps change, with no test-file count', () => {
    const review = chapter('review', ['src/session.ts', 'src/store.ts', 'tests/session.spec.ts'])
    const out = applyReadingOrder(
      [review],
      [
        { ...step(1, 'src/session.ts', 'Defines markViewed'), symbol: 'markViewed' },
        { ...step(2, 'src/store.ts', 'Calls markViewed (step 1)'), symbol: 'viewAll' },
        step(3, 'tests/session.spec.ts', 'Tests step 1, read right after it'),
      ]
    )
    expect(out[0].summary).toBe('Changes markViewed and viewAll')
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
