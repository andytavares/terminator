import { describe, it, expect, vi, afterEach } from 'vitest'
import { analysePr } from '../../src/review/analyse'
import * as readingOrderModule from '../../src/review/reading-order'
import * as insightsModule from '../../src/review/insights'
import * as prReviewService from '../../src/github/pr-review-service'

const baseOpts = {
  readingOrder: [],
  chapters: [],
  statusChecks: [],
  dryViolations: [],
  localCoverage: null,
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
    const parseSpy = vi.spyOn(prReviewService, 'parseDiff')
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
