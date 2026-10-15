import { describe, it, expect } from 'vitest'
import { visiblePr } from '../../src/review/visible-pr'
import type { PrChangedFile, PrReviewDetail } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../tests/support/fakes'

function file(path: string, level: 'low' | 'high'): PrChangedFile {
  return partialFake<PrChangedFile>({
    path,
    riskScore: partialFake<PrChangedFile['riskScore']>({ level }),
  })
}

const PR = partialFake<PrReviewDetail>({
  ownedPaths: ['web/app.tsx', 'web/util.ts'],
  chapters: [
    { id: 'web', files: [file('web/app.tsx', 'high'), file('web/util.ts', 'low')] },
    { id: 'api', files: [file('api/main.py', 'high')] },
  ] as PrReviewDetail['chapters'],
})

function pathsOf(pr: PrReviewDetail): string[] {
  return pr.chapters.flatMap((c) => c.files.map((f) => f.path))
}

describe('visiblePr', () => {
  it('shows every file when no filter is on', () => {
    expect(pathsOf(visiblePr(PR, { focusMode: false, ownedOnly: false }))).toEqual([
      'web/app.tsx',
      'web/util.ts',
      'api/main.py',
    ])
  })

  it('keeps only the files the viewer owns, and drops a chapter left empty', () => {
    const shown = visiblePr(PR, { focusMode: false, ownedOnly: true })
    expect(pathsOf(shown)).toEqual(['web/app.tsx', 'web/util.ts'])
    expect(shown.chapters.map((c) => c.id)).toEqual(['web'])
  })

  it('combines with focus mode: owned files that are not low risk', () => {
    expect(pathsOf(visiblePr(PR, { focusMode: true, ownedOnly: true }))).toEqual(['web/app.tsx'])
  })

  it('shows all files when the viewer owns none, rather than an empty review', () => {
    const none = { ...PR, ownedPaths: [] }
    expect(pathsOf(visiblePr(none, { focusMode: false, ownedOnly: true }))).toHaveLength(3)
  })
})
