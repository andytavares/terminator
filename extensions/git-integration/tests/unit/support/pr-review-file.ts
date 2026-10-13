import type { PrChangedFile } from '../../../src/schemas/pr-review.schema'

/** A small modified file of low risk, as the review channel returns one in a chapter. */
export function changedFile(path: string, overrides: Partial<PrChangedFile> = {}): PrChangedFile {
  return {
    path,
    changeType: 'modified',
    additions: 1,
    deletions: 0,
    isBinary: false,
    tier: 1,
    whyHere: '',
    estimatedMinutes: 1,
    riskScore: {
      level: 'low',
      composite: 1,
      metrics: {
        changeSize: 1,
        churn90d: null,
        blastRadius: null,
        testFilePresent: null,
        complexityDelta: null,
        patchCoverage: null,
      },
      dominantDriver: '',
      topImporters: [],
      importerCount: 0,
    },
    ...overrides,
  }
}
