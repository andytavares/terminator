import { describe, it, expect } from 'vitest'
import { groupSameShapeHunks } from '../../src/review/same-shape'
import { parsePrFiles } from '../../src/review/parsed-file'

const groupsOf = (files: unknown[]) => groupSameShapeHunks(parsePrFiles(files))

/** A file whose only hunk is `lines`, each already prefixed with `-`, `+` or a space. */
function changing(path: string, lines: string[]) {
  return { path, patch: ['@@ -10,4 +10,4 @@', ...lines].join('\n') }
}

describe('groupSameShapeHunks()', () => {
  it('groups hunks across files that differ only in number literals, recording the masked values', () => {
    const groups = groupsOf([
      changing('src/api/client.ts', ['-  retries: 3,', '+  retries: 5,']),
      changing('src/api/upload.ts', ['-  retries: 2,', '+  retries: 4,']),
      changing('src/api/download.ts', ['-  retries: 1,', '+  retries: 7,']),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].first).toEqual({ path: 'src/api/client.ts', hunkIndex: 0 })
    expect(groups[0].rest).toEqual([
      { path: 'src/api/upload.ts', hunkIndex: 0 },
      { path: 'src/api/download.ts', hunkIndex: 0 },
    ])
    expect(groups[0].maskedValues.get('src/api/client.ts#0')).toEqual(['3', '5'])
    expect(groups[0].maskedValues.get('src/api/upload.ts#0')).toEqual(['2', '4'])
    expect(groups[0].maskedValues.get('src/api/download.ts#0')).toEqual(['1', '7'])
  })
})

describe('groupSameShapeHunks() — within one file', () => {
  it('groups hunks within one file', () => {
    const groups = groupsOf([
      {
        path: 'src/config.ts',
        patch: [
          '@@ -1,2 +1,2 @@',
          '-  retries: 3,',
          '+  retries: 5,',
          '@@ -40,2 +40,2 @@',
          '-  retries: 2,',
          '+  retries: 4,',
        ].join('\n'),
      },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].first).toEqual({ path: 'src/config.ts', hunkIndex: 0 })
    expect(groups[0].rest).toEqual([{ path: 'src/config.ts', hunkIndex: 1 }])
  })
})

describe('groupSameShapeHunks() — what never folds', () => {
  it('never folds a hunk whose operator differs', () => {
    const groups = groupsOf([
      changing('src/limits.ts', ['-if (count >= 3) stop()', '+if (count >= 5) stop()']),
      changing('src/quota.ts', ['-if (count >= 2) stop()', '+if (count >= 4) stop()']),
      changing('src/rate.ts', ['-if (count > 2) stop()', '+if (count > 4) stop()']),
    ])

    expect(groups).toHaveLength(1)
    expect([groups[0].first, ...groups[0].rest].map((ref) => ref.path)).toEqual([
      'src/limits.ts',
      'src/quota.ts',
    ])
  })

  it('never folds a hunk whose identifier differs', () => {
    const groups = groupsOf([
      changing('src/api/client.ts', ['-  retries: 3,', '+  retries: 5,']),
      changing('src/api/upload.ts', ['-  timeout: 3,', '+  timeout: 5,']),
    ])

    expect(groups).toEqual([])
  })

  it('groups hunks that differ only in string literals, whatever the quote', () => {
    const groups = groupsOf([
      changing('src/log.ts', ["-  level: 'a',", "+  level: 'warn',"]),
      changing('src/trace.ts', ['-  level: "b",', '+  level: `error`,']),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].maskedValues.get('src/trace.ts#0')).toEqual(['"b"', '`error`'])
  })
})

describe('groupSameShapeHunks() — what is ignored', () => {
  it('never groups hunks with fewer than two changed lines', () => {
    const groups = groupsOf([
      changing('src/a.ts', ['+  retries: 3,']),
      changing('src/b.ts', ['+  retries: 5,']),
    ])

    expect(groups).toEqual([])
  })

  it('ignores context lines when comparing hunks', () => {
    const groups = groupsOf([
      changing('src/api/client.ts', [' const client = {', '-  retries: 3,', '+  retries: 5,']),
      changing('src/api/upload.ts', [
        ' export const upload = {',
        '-  retries: 2,',
        '+  retries: 4,',
      ]),
    ])

    expect(groups).toHaveLength(1)
  })
})
