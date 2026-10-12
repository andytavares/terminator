import { describe, it, expect, vi } from 'vitest'
import { findTestLocations, symbolsForBlock } from '../../src/review/test-locations'

const AT_ABC123 = { repoRoot: '/repo', headSHA: 'abc123' }

const GREP_AT_ABC123 = [
  'abc123:src/utils.spec.ts:12:  it("sorts by priority", () => sortByPriority(items))',
  'abc123:src/utils.spec.ts:30:    expect(filterItems(items, {})).toEqual(items)',
  'abc123:tests/e2e/batch.spec.ts:4:import { sortByPriority } from "../src/utils"',
].join('\n')

const LOCATIONS_AT_ABC123 = [
  {
    path: 'src/utils.spec.ts',
    line: 12,
    symbol: 'sortByPriority',
    text: 'it("sorts by priority", () => sortByPriority(items))',
  },
  {
    path: 'src/utils.spec.ts',
    line: 30,
    symbol: 'filterItems',
    text: 'expect(filterItems(items, {})).toEqual(items)',
  },
  {
    path: 'tests/e2e/batch.spec.ts',
    line: 4,
    symbol: 'sortByPriority',
    text: 'import { sortByPriority } from "../src/utils"',
  },
]

describe('findTestLocations — at the PR head', () => {
  it('greps the PR head for each symbol and returns file, line and text', async () => {
    const runGit = vi.fn().mockResolvedValue(GREP_AT_ABC123)
    const found = await findTestLocations(AT_ABC123, ['sortByPriority', 'filterItems'], runGit)
    expect(runGit.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['grep', '-n', '-w', '-E', 'sortByPriority|filterItems', 'abc123'])
    )
    expect(found).toEqual(LOCATIONS_AT_ABC123)
  })

  it('skips a matched line that names none of the symbols as a whole word', async () => {
    const runGit = vi.fn().mockResolvedValue('abc123:a.spec.ts:1:sortByPriorityLater()')
    expect(await findTestLocations(AT_ABC123, ['sortByPriority'], runGit)).toEqual([])
  })

  it('keeps at most 50 matches', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `h:t.spec.ts:${i + 1}:foo()`).join('\n')
    const runGit = vi.fn().mockResolvedValue(lines)
    expect(
      await findTestLocations({ repoRoot: '/repo', headSHA: 'h' }, ['foo'], runGit)
    ).toHaveLength(50)
  })
})

describe('findTestLocations — when the head is not available', () => {
  it('falls back to the working tree when the head commit is not local', async () => {
    const runGit = vi
      .fn()
      .mockRejectedValueOnce(new Error('fatal: bad object abc123'))
      .mockResolvedValueOnce('src/a.test.ts:3:foo()')
    const found = await findTestLocations(AT_ABC123, ['foo'], runGit)
    expect(runGit).toHaveBeenCalledTimes(2)
    expect(runGit.mock.calls[1][1]).not.toContain('abc123')
    expect(found).toEqual([{ path: 'src/a.test.ts', line: 3, symbol: 'foo', text: 'foo()' }])
  })

  it('returns nothing when the working tree cannot be searched either', async () => {
    const runGit = vi.fn().mockRejectedValue(new Error('fatal: not a git repository'))
    expect(await findTestLocations(AT_ABC123, ['foo'], runGit)).toEqual([])
    expect(runGit).toHaveBeenCalledTimes(2)
  })

  it('returns nothing for no usable symbols, an uncloned repo, or no match', async () => {
    const runGit = vi.fn().mockRejectedValue(Object.assign(new Error('exit 1'), { code: 1 }))
    const at = (repoRoot: string) => ({ repoRoot, headSHA: 'abc' })
    expect(await findTestLocations(at('/repo'), ['not an identifier'], runGit)).toEqual([])
    expect(await findTestLocations(at('gh:acme/widgets'), ['foo'], runGit)).toEqual([])
    expect(await findTestLocations(at('/repo'), ['foo'], runGit)).toEqual([])
  })
})

describe('symbolsForBlock', () => {
  it('names the functions and declarations a TypeScript block defines', async () => {
    const code = [
      'export function sortByPriority(items: Item[]): Item[] {',
      '  return [...items]',
      '}',
      'export const PRIORITY_WEIGHT = { low: 1 }',
    ].join('\n')
    const names = await symbolsForBlock('src/utils.ts', code)
    expect(names).toContain('sortByPriority')
    expect(names).toContain('PRIORITY_WEIGHT')
  })

  it('uses the enclosing function from the hunk header when the block defines nothing', async () => {
    const names = await symbolsForBlock(
      'src/utils.ts',
      '    if (filter.search) {\n      return false\n    }',
      '@@ -20,6 +20,9 @@ export function filterItems('
    )
    expect(names).toEqual(['filterItems'])
  })

  it('returns nothing for a language without a grammar', async () => {
    expect(await symbolsForBlock('README.md', '# Title')).toEqual([])
  })
})
