import { describe, it, expect } from 'vitest'
import { chapterHunkProgress, reviewBand } from '../../src/review/review-layout'
import type { Chapter, PrChangedFile } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../packages/test-support/src/fakes'

function file(path: string, additions: number, deletions = 0): PrChangedFile {
  return partialFake<PrChangedFile>({ path, additions, deletions })
}

describe('reviewBand', () => {
  it.each([
    { lines: 99, band: 'page' },
    { lines: 100, band: 'stream' },
    { lines: 800, band: 'stream' },
    { lines: 801, band: 'chapters' },
  ])('puts a PR of $lines changed lines in the $band band', ({ lines, band }) => {
    expect(reviewBand([file('a.ts', lines - 1, 0), file('b.ts', 0, 1)])).toBe(band)
  })
})

const chapter = partialFake<Chapter>({
  id: 'core',
  files: [file('src/store.ts', 10), file('src/view.tsx', 10)],
})

describe('chapterHunkProgress', () => {
  it('counts the read hunks of loaded files against their hunks', () => {
    const progress = chapterHunkProgress(chapter, {
      viewedHunks: { 'src/store.ts': ['@@ -1 +1 @@'] },
      fileHunks: {
        'src/store.ts': ['@@ -1 +1 @@', '@@ -9 +9 @@'],
        'src/view.tsx': ['@@ -2 +2 @@'],
      },
    })
    expect(progress).toEqual({ read: 1, total: 3 })
  })

  it('counts a file whose diff has not loaded as its read hunks, and at least one', () => {
    const progress = chapterHunkProgress(chapter, {
      viewedHunks: { 'src/store.ts': ['@@ -1 +1 @@', '@@ -9 +9 @@'] },
      fileHunks: {},
    })
    expect(progress).toEqual({ read: 2, total: 3 })
  })

  it('ignores read headers that the loaded diff no longer has', () => {
    const progress = chapterHunkProgress(chapter, {
      viewedHunks: { 'src/view.tsx': ['@@ -40 +40 @@'] },
      fileHunks: { 'src/store.ts': [], 'src/view.tsx': ['@@ -2 +2 @@'] },
    })
    expect(progress).toEqual({ read: 0, total: 1 })
  })
})
