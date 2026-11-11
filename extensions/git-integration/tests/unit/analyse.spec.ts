import { describe, it, expect, vi, afterEach } from 'vitest'
import { analysePr } from '../../src/review/analyse'
import * as readingOrderModule from '../../src/review/reading-order'
import * as insightsModule from '../../src/review/insights'
import * as prReviewService from '../../src/github/pr-review-service'

const baseOpts = {
  readingOrder: [],
  chapters: [],
  dryViolations: [],
}

afterEach(() => {
  vi.restoreAllMocks()
})

const ONE_NEW_FUNCTION = [
  {
    path: 'src/a.ts',
    additions: 3,
    deletions: 0,
    patch: [
      '@@ -0,0 +1,3 @@ export function a',
      '+export function a() {',
      '+  return 1',
      '+}',
    ].join('\n'),
  },
]

const SOURCE_SPEC_AND_MANIFEST = [
  {
    path: 'src/a.ts',
    additions: 3,
    deletions: 1,
    patch: ['@@ -1,1 +1,3 @@', '-const a = 0', '+export function a() {', '+  return 1', '+}'].join(
      '\n'
    ),
  },
  {
    path: 'src/a.spec.ts',
    additions: 1,
    deletions: 0,
    patch: ['@@ -0,0 +1,1 @@', "+it('a', () => expect(a()).toBe(1))"].join('\n'),
  },
  {
    path: 'package.json',
    additions: 1,
    deletions: 1,
    patch: ['@@ -1,1 +1,1 @@', '-  "version": "1.0.0"', '+  "version": "1.0.1"'].join('\n'),
  },
]

describe('analysePr()', () => {
  it('runs the reading-order, moved-blocks and insights passes together', async () => {
    const result = await analysePr(ONE_NEW_FUNCTION, baseOpts)
    expect(result.readingOrder).toHaveLength(1)
    expect(result.movedBlocks).toEqual([])
    expect(result.insights).not.toBeNull()
  })

  it("parses each file's patch once across the reading-order, moved-blocks and insights passes", async () => {
    const parseSpy = vi.spyOn(prReviewService, 'parsePrFileDiff')
    await analysePr(SOURCE_SPEC_AND_MANIFEST, baseOpts)

    expect(parseSpy.mock.calls.map(([, path]) => path).sort()).toEqual([
      'package.json',
      'src/a.spec.ts',
      'src/a.ts',
    ])
  })
})

describe('analysePr() — a pass that fails', () => {
  it('falls back to empty results and does not throw when a pass fails', async () => {
    vi.spyOn(readingOrderModule, 'buildReadingOrder').mockRejectedValue(new Error('boom'))
    vi.spyOn(insightsModule, 'computeInsights').mockRejectedValue(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await analysePr([{ path: 'src/a.ts' }], baseOpts)

    expect(result.readingOrder).toEqual([])
    expect(result.insights).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })
})

/** A file whose one hunk at line 10 changes the retry count from `from` to `to`. */
function retriesChange(path: string, from: number, to: number) {
  return {
    path,
    patch: ['@@ -10,1 +10,1 @@', `-  retries: ${from},`, `+  retries: ${to},`].join('\n'),
  }
}

describe('analysePr() — same-shape hunks', () => {
  it('groups hunks of three files that differ only in literals, with their lines and masked values', async () => {
    const files = [
      retriesChange('src/api/client.ts', 3, 5),
      retriesChange('src/api/upload.ts', 2, 4),
      retriesChange('src/api/download.ts', 1, 7),
    ]

    const result = await analysePr(files, baseOpts)

    expect(result.sameShape).toEqual([
      {
        first: { path: 'src/api/client.ts', hunkIndex: 0, line: 10, maskedValues: ['3', '5'] },
        rest: [
          { path: 'src/api/upload.ts', hunkIndex: 0, line: 10, maskedValues: ['2', '4'] },
          { path: 'src/api/download.ts', hunkIndex: 0, line: 10, maskedValues: ['1', '7'] },
        ],
      },
    ])
  })
})
