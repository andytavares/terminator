import { describe, it, expect } from 'vitest'
import { chapterHunkProgress, reviewBand, sectionToActivate } from '../../src/review/review-layout'
import type { Chapter, PrChangedFile } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../packages/test-support/src/fakes'

function file(path: string, additions: number, deletions = 0): PrChangedFile {
  return partialFake<PrChangedFile>({ path, additions, deletions, hunkCount: 1 })
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
  files: [{ ...file('src/store.ts', 10), hunkCount: 5 }, file('src/view.tsx', 10)],
})

const NONE_VIEWED = new Set<string>()

describe('chapterHunkProgress', () => {
  it('counts the read hunks of loaded files against their hunks', () => {
    const progress = chapterHunkProgress(chapter, {
      viewedHunks: { 'src/store.ts': ['@@ -1 +1 @@'] },
      fileHunks: {
        'src/store.ts': ['@@ -1 +1 @@', '@@ -9 +9 @@'],
        'src/view.tsx': ['@@ -2 +2 @@'],
      },
      viewedFiles: NONE_VIEWED,
    })
    expect(progress).toEqual({ read: 1, total: 3 })
  })
})

describe('chapterHunkProgress before a diff loads', () => {
  it('counts a file whose diff has not loaded against the hunk count of its patch', () => {
    const progress = chapterHunkProgress(chapter, {
      viewedHunks: { 'src/store.ts': ['@@ -1 +1 @@', '@@ -9 +9 @@'] },
      fileHunks: {},
      viewedFiles: NONE_VIEWED,
    })
    expect(progress).toEqual({ read: 2, total: 6 })
  })

  it('counts every hunk of a viewed file as read, loaded or not', () => {
    const progress = chapterHunkProgress(chapter, {
      viewedHunks: {},
      fileHunks: { 'src/view.tsx': ['@@ -2 +2 @@'] },
      viewedFiles: new Set(['src/store.ts', 'src/view.tsx']),
    })
    expect(progress).toEqual({ read: 6, total: 6 })
  })

  it('ignores read headers that the loaded diff no longer has', () => {
    const progress = chapterHunkProgress(chapter, {
      viewedHunks: { 'src/view.tsx': ['@@ -40 +40 @@'] },
      fileHunks: { 'src/store.ts': [], 'src/view.tsx': ['@@ -2 +2 @@'] },
      viewedFiles: NONE_VIEWED,
    })
    expect(progress).toEqual({ read: 0, total: 1 })
  })
})

describe('sectionToActivate', () => {
  const view = { top: 0, bottom: 600 }
  const boxes = [
    { path: 'src/store.ts', top: -900, bottom: 100 },
    { path: 'src/view.tsx', top: 100, bottom: 300 },
  ]

  it('picks the first section whose bottom is below the sticky header', () => {
    expect(sectionToActivate(view, boxes, null)).toBe('src/store.ts')
  })

  it('keeps a section the keys moved to while it is on screen, though it cannot reach the top', () => {
    expect(sectionToActivate(view, boxes, 'src/view.tsx')).toBe('src/view.tsx')
  })

  it('lets go of that section once it scrolls out of view', () => {
    const scrolledUp = [
      { path: 'src/store.ts', top: 0, bottom: 1000 },
      { path: 'src/view.tsx', top: 1000, bottom: 1200 },
    ]
    expect(sectionToActivate(view, scrolledUp, 'src/view.tsx')).toBe('src/store.ts')
  })
})
