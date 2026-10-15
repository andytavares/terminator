import type { RiskScore } from '../../src/schemas/pr-review.schema'

/** A low-risk score with every metric filled in; `overrides` replace top-level fields. */
export function makeRiskScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    level: 'low',
    composite: 10,
    dominantDriver: '',
    topImporters: [],
    importerCount: 0,
    metrics: {
      changeSize: 5,
      testFilePresent: true,
      complexityDelta: 0,
      churn90d: 1,
      blastRadius: 1,
      patchCoverage: 90,
    },
    ...overrides,
  }
}
