import { describe, it, expect } from 'vitest'
import { visiblePr } from '../../src/review/visible-pr'
import type { PrChangedFile, PrReviewDetail } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../packages/test-support/src/fakes'

function file(path: string): PrChangedFile {
  return partialFake<PrChangedFile>({ path })
}

const PR = partialFake<PrReviewDetail>({
  ownedPaths: ['web/app.tsx', 'web/util.ts'],
  chapters: [
    { id: 'web', files: [file('web/app.tsx'), file('web/util.ts')] },
    { id: 'api', files: [file('api/main.py')] },
  ] as PrReviewDetail['chapters'],
})

function pathsOf(pr: PrReviewDetail): string[] {
  return pr.chapters.flatMap((c) => c.files.map((f) => f.path))
}

describe('visiblePr', () => {
  it('shows every file when the owned-only filter is off', () => {
    expect(pathsOf(visiblePr(PR, { ownedOnly: false }))).toEqual([
      'web/app.tsx',
      'web/util.ts',
      'api/main.py',
    ])
  })

  it('keeps only the files the viewer owns, and drops a chapter left empty', () => {
    const shown = visiblePr(PR, { ownedOnly: true })
    expect(pathsOf(shown)).toEqual(['web/app.tsx', 'web/util.ts'])
    expect(shown.chapters.map((c) => c.id)).toEqual(['web'])
  })

  it('shows all files when the viewer owns none, rather than an empty review', () => {
    const none = { ...PR, ownedPaths: [] }
    expect(pathsOf(visiblePr(none, { ownedOnly: true }))).toHaveLength(3)
  })
})
