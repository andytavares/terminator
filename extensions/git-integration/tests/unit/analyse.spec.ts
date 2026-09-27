import { describe, it, expect, vi, afterEach } from 'vitest'
import { analysePr } from '../../src/review/analyse'
import * as readingOrderModule from '../../src/review/reading-order'
import * as insightsModule from '../../src/review/insights'

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

describe('analysePr()', () => {
  it('runs the reading-order, moved-blocks and insights passes together', async () => {
    const files = [
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
    const result = await analysePr(files, baseOpts)
    expect(result.readingOrder).toHaveLength(1)
    expect(result.movedBlocks).toEqual([])
    expect(result.insights).not.toBeNull()
  })

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
