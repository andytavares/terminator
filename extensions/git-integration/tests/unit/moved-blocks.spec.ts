import { describe, it, expect } from 'vitest'
import { detectMovedBlocks } from '../../src/review/moved-blocks'
import { parsePrFiles } from '../../src/review/parsed-file'

const movedBlocksOf = (files: unknown[]) => detectMovedBlocks(parsePrFiles(files))

/** A file whose only hunk removes `lines` from line 1. */
function removing(path: string, lines: string[]) {
  return { path, patch: [`@@ -1,${lines.length} +1,0 @@`, ...lines.map((l) => `-${l}`)].join('\n') }
}

/** A file whose only hunk adds `lines` at line 1. */
function adding(path: string, lines: string[]) {
  return { path, patch: [`@@ -1,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n') }
}

const XYZ = ['const x = 1', 'const y = 2', 'const z = 3']

const UNION_FIND_LINES = [
  'class UnionFind {',
  '  private parent = new Map<string, string>()',
  '',
  '  find(x: string): string {',
  '    return x',
  '  }',
  '}',
]

const UNION_FIND_MOVE = [
  {
    path: 'src/github/pr-review-service.ts',
    patch: ['@@ -358,7 +358,0 @@ class UnionFind {', ...UNION_FIND_LINES.map((l) => `-${l}`)].join(
      '\n'
    ),
  },
  {
    path: 'src/review/reading-order.ts',
    patch: ['@@ -1,0 +1,7 @@ new file', ...UNION_FIND_LINES.map((l) => `+${l}`)].join('\n'),
  },
]

describe('detectMovedBlocks() — a moved block', () => {
  it('links a block removed from one file to the same block added, unchanged, in another', () => {
    const moved = movedBlocksOf(UNION_FIND_MOVE)
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

  it('falls back to `filename` when `path` is absent', () => {
    const files = [removing('a.ts', XYZ), adding('b.ts', XYZ)].map(({ path, patch }) => ({
      filename: path,
      patch,
    }))
    const moved = movedBlocksOf(files)
    expect(moved).toHaveLength(1)
    expect(moved[0].fromPath).toBe('a.ts')
    expect(moved[0].toPath).toBe('b.ts')
  })
})

describe('detectMovedBlocks() — what still counts as the same block', () => {
  it('treats blank lines inside a run as transparent (ignored, not breaking)', () => {
    const lines = ['const x = 1', '', 'const y = 2', 'const z = 3']
    const moved = movedBlocksOf([removing('a.ts', lines), adding('b.ts', lines)])
    expect(moved).toHaveLength(1)
    expect(moved[0].lineCount).toBe(3)
  })

  it('ignores whitespace differences between the two runs', () => {
    const indented = XYZ.map((l) => `  ${l}`)
    expect(movedBlocksOf([removing('a.ts', indented), adding('b.ts', XYZ)])).toHaveLength(1)
  })
})

const IN_PLACE_EDIT = {
  path: 'y.ts',
  patch: ['@@ -5,3 +5,3 @@', '-line a', '-line b', '-line c', '+line a', '+line b', '+line c'].join(
    '\n'
  ),
}

describe('detectMovedBlocks() — runs that are not a move', () => {
  it('ignores runs shorter than 3 lines', () => {
    const two = ['const x = 1', 'const y = 2']
    expect(movedBlocksOf([removing('a.ts', two), adding('b.ts', two)])).toEqual([])
  })

  it('does not match runs whose normalized content differs', () => {
    const changed = ['const x = 1', 'const y = 9', 'const z = 3']
    expect(movedBlocksOf([removing('a.ts', XYZ), adding('b.ts', changed)])).toEqual([])
  })

  it('does not pair runs of different lengths', () => {
    const longer = [...XYZ, 'const w = 4']
    expect(movedBlocksOf([removing('a.ts', XYZ), adding('b.ts', longer)])).toEqual([])
  })

  it('does not report a block as moved when the matching run sits at the same path and line (in-place edit)', () => {
    expect(movedBlocksOf([IN_PLACE_EDIT])).toEqual([])
  })
})

describe('detectMovedBlocks() — files and runs it skips', () => {
  it('returns [] when no patch is present', () => {
    expect(movedBlocksOf([{ path: 'a.ts' }, { path: 'b.ts' }])).toEqual([])
  })

  it('skips a file listed without any path', () => {
    const { patch } = removing('', XYZ)
    expect(movedBlocksOf([{ patch }, adding('b.ts', XYZ)])).toEqual([])
  })

  it('does not reuse an already-matched added run for a second identical removed run', () => {
    const lines = ['const alpha = 1', 'const beta = 2', 'const gamma = 3']
    const files = [
      removing('dup.ts', lines),
      removing('dup2.ts', lines),
      adding('target.ts', lines),
    ]
    const moved = movedBlocksOf(files)
    expect(moved).toHaveLength(1)
  })
})
