import type { PrChangedFile } from '../../../src/schemas/pr-review.schema'

/** A small modified file, as the review channel returns one in a chapter. */
export function changedFile(path: string, overrides: Partial<PrChangedFile> = {}): PrChangedFile {
  return {
    path,
    changeType: 'modified',
    additions: 1,
    deletions: 0,
    isBinary: false,
    whyHere: '',
    churn90d: null,
    ...overrides,
  }
}
