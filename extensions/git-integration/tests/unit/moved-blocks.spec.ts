import { describe, it, expect } from 'vitest'
import { detectMovedBlocks } from '../../src/review/moved-blocks'

describe('detectMovedBlocks()', () => {
  it('links a block removed from one file to the same block added, unchanged, in another', () => {
    const files = [
      {
        path: 'src/github/pr-review-service.ts',
        patch: [
          '@@ -358,7 +358,0 @@ class UnionFind {',
          '-class UnionFind {',
          '-  private parent = new Map<string, string>()',
          '-',
          '-  find(x: string): string {',
          '-    return x',
          '-  }',
          '-}',
        ].join('\n'),
      },
      {
        path: 'src/review/reading-order.ts',
        patch: [
          '@@ -1,0 +1,7 @@ new file',
          '+class UnionFind {',
          '+  private parent = new Map<string, string>()',
          '+',
          '+  find(x: string): string {',
          '+    return x',
          '+  }',
          '+}',
        ].join('\n'),
      },
    ]

    const moved = detectMovedBlocks(files)
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({
      fromPath: 'src/github/pr-review-service.ts',
      toPath: 'src/review/reading-order.ts',
      symbol: 'UnionFind',
    })
    expect(moved[0].fromLine).toBe(358)
    expect(moved[0].toLine).toBe(1)
    expect(moved[0].lineCount).toBe(6)
  })

  it('ignores runs shorter than 3 lines', () => {
    const files = [
      {
        path: 'a.ts',
        patch: ['@@ -1,2 +1,0 @@', '-const x = 1', '-const y = 2'].join('\n'),
      },
      {
        path: 'b.ts',
        patch: ['@@ -1,0 +1,2 @@', '+const x = 1', '+const y = 2'].join('\n'),
      },
    ]
    expect(detectMovedBlocks(files)).toEqual([])
  })

  it('does not match runs whose normalized content differs', () => {
    const files = [
      {
        path: 'a.ts',
        patch: ['@@ -1,3 +1,0 @@', '-const x = 1', '-const y = 2', '-const z = 3'].join('\n'),
      },
      {
        path: 'b.ts',
        patch: ['@@ -1,0 +1,3 @@', '+const x = 1', '+const y = 9', '+const z = 3'].join('\n'),
      },
    ]
    expect(detectMovedBlocks(files)).toEqual([])
  })

  it('treats blank lines inside a run as transparent (ignored, not breaking)', () => {
    const files = [
      {
        path: 'a.ts',
        patch: ['@@ -1,4 +1,0 @@', '-const x = 1', '-', '-const y = 2', '-const z = 3'].join('\n'),
      },
      {
        path: 'b.ts',
        patch: ['@@ -1,0 +1,4 @@', '+const x = 1', '+', '+const y = 2', '+const z = 3'].join('\n'),
      },
    ]
    const moved = detectMovedBlocks(files)
    expect(moved).toHaveLength(1)
    expect(moved[0].lineCount).toBe(3)
  })

  it('ignores whitespace differences between the two runs', () => {
    const files = [
      {
        path: 'a.ts',
        patch: ['@@ -1,3 +1,0 @@', '-  const x = 1', '-  const y = 2', '-  const z = 3'].join('\n'),
      },
      {
        path: 'b.ts',
        patch: ['@@ -1,0 +1,3 @@', '+const x = 1', '+const y = 2', '+const z = 3'].join('\n'),
      },
    ]
    expect(detectMovedBlocks(files)).toHaveLength(1)
  })

  it('returns [] when no patch is present', () => {
    expect(detectMovedBlocks([{ path: 'a.ts' }, { path: 'b.ts' }])).toEqual([])
  })

  it('falls back to `filename` when `path` is absent', () => {
    const files = [
      {
        filename: 'a.ts',
        patch: ['@@ -1,3 +1,0 @@', '-const x = 1', '-const y = 2', '-const z = 3'].join('\n'),
      },
      {
        filename: 'b.ts',
        patch: ['@@ -1,0 +1,3 @@', '+const x = 1', '+const y = 2', '+const z = 3'].join('\n'),
      },
    ]
    const moved = detectMovedBlocks(files)
    expect(moved).toHaveLength(1)
    expect(moved[0].fromPath).toBe('a.ts')
    expect(moved[0].toPath).toBe('b.ts')
  })

  it('does not report a block as moved when the matching run sits at the same path and line (in-place edit)', () => {
    const files = [
      {
        path: 'y.ts',
        patch: [
          '@@ -5,3 +5,3 @@',
          '-line a',
          '-line b',
          '-line c',
          '+line a',
          '+line b',
          '+line c',
        ].join('\n'),
      },
    ]
    expect(detectMovedBlocks(files)).toEqual([])
  })

  it('does not reuse an already-matched added run for a second identical removed run', () => {
    const files = [
      {
        path: 'dup.ts',
        patch: ['@@ -1,3 +1,0 @@', '-const alpha = 1', '-const beta = 2', '-const gamma = 3'].join(
          '\n'
        ),
      },
      {
        path: 'dup2.ts',
        patch: ['@@ -1,3 +1,0 @@', '-const alpha = 1', '-const beta = 2', '-const gamma = 3'].join(
          '\n'
        ),
      },
      {
        path: 'target.ts',
        patch: ['@@ -1,0 +1,3 @@', '+const alpha = 1', '+const beta = 2', '+const gamma = 3'].join(
          '\n'
        ),
      },
    ]
    const moved = detectMovedBlocks(files)
    expect(moved).toHaveLength(1)
  })
})
