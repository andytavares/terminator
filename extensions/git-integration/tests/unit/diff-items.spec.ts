import { describe, it, expect } from 'vitest'
import { buildDiffItems, type DiffItemSource, type MovedMark } from '../../src/review/diff-items'
import { buildSplitRows } from '../../src/components/FileDiffView'
import type { DiffHunk, DiffLine } from '../../src/schemas/git.schema'

const context = (n: number): DiffLine => ({
  type: 'context',
  content: `line ${n}`,
  oldLineNumber: n,
  newLineNumber: n,
})
const hunkOf = (header: string, lines: DiffLine[]): DiffHunk => ({ header, lines })

function sourceOf(hunks: DiffHunk[], overrides: Partial<DiffItemSource> = {}): DiffItemSource {
  return {
    mode: 'unified',
    hunkCount: hunks.length,
    visibleHunks: hunks.map((hunk, index) => ({ hunk, index })),
    splitRows: hunks.map((h) => buildSplitRows(h.lines)),
    gapViews: new Map(),
    hotspots: [],
    movedMark: () => null,
    ...overrides,
  }
}

const keysOf = (source: DiffItemSource) => buildDiffItems(source).map((item) => item.key)

describe('buildDiffItems()', () => {
  it('orders the top gap, each hunk header and rows, its hotspot, and the gaps after it', () => {
    const hunks = [hunkOf('@@ a', [context(5)]), hunkOf('@@ b', [context(9)])]
    const gapViews = new Map([
      ['top', { above: [], hidden: 4, below: [] }],
      ['after-0', { above: [context(6)], hidden: 2, below: [] }],
      ['bottom', { above: [], hidden: null, below: [] }],
    ])
    const source = sourceOf(hunks, { gapViews, hotspots: [{ hunkIndex: 0, message: 'hot' }] })

    expect(keysOf(source)).toEqual([
      'top-expander',
      '0-header',
      '0-0',
      '0-hotspot',
      'after-0-above-6',
      'after-0-expander',
      '1-header',
      '1-0',
      'bottom-expander',
    ])
  })

  it('leads with a notice counting the formatting hunks it hides', () => {
    const hunks = [hunkOf('@@ a', [context(1)]), hunkOf('@@ b', [context(9)])]
    const items = buildDiffItems(sourceOf(hunks, { visibleHunks: [{ hunk: hunks[1], index: 1 }] }))
    expect(items[0]).toEqual({ kind: 'notice', key: 'notice', hiddenCount: 1 })
    expect(items.map((i) => i.key)).toEqual(['notice', '1-header', '1-0'])
  })

  it('drops the lines of a collapsed moved block but keeps the line that opens it', () => {
    const lines = [1, 2, 3].map(
      (n): DiffLine => ({ ...context(n), type: 'add', oldLineNumber: null })
    )
    const mark = (isStart: boolean): MovedMark => ({
      block: {
        fromPath: 'a.ts',
        fromLine: 1,
        toPath: 'b.ts',
        toLine: 1,
        lineCount: 3,
        symbol: null,
      },
      side: 'RIGHT',
      key: 'a.ts:1->b.ts:1',
      isStart,
      expanded: false,
    })
    const source = sourceOf([hunkOf('@@ a', lines)], { movedMark: (n) => mark(n === 1) })
    expect(keysOf(source)).toEqual(['0-header', '0-0'])
    expect(keysOf({ ...source, mode: 'split' })).toEqual(['0-header', '0-row-0'])
  })
})
