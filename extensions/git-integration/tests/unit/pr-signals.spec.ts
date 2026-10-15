import { describe, it, expect } from 'vitest'
import { signalDots, type MeasuredFile } from '../../src/review/pr-signals'
import type { FileMetrics, PrReviewDetail } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../tests/support/fakes'

function dotsFor(metrics: Partial<FileMetrics>) {
  const measured = partialFake<MeasuredFile>({
    metrics: partialFake<FileMetrics>({ testFilePresent: true, ...metrics }),
  })
  return signalDots([measured], partialFake<PrReviewDetail>({ ciStatus: 'passing' }))
}

describe('signalDots — churn uses the same floors as the file level', () => {
  it.each([
    [19, 'pass'],
    [20, 'warn'],
    [49, 'warn'],
    [50, 'fail'],
  ] as const)('%s commits is %s', (churn90d, dot) => {
    expect(dotsFor({ churn90d }).churn).toBe(dot)
  })
})

describe('signalDots — blast uses the same floors as the file level', () => {
  it.each([
    [9, 'pass'],
    [10, 'warn'],
    [19, 'warn'],
    [20, 'fail'],
  ] as const)('%s importers is %s', (blastRadius, dot) => {
    expect(dotsFor({ blastRadius }).blast).toBe(dot)
  })
})
