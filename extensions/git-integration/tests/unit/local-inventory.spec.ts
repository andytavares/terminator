import { describe, it, expect } from 'vitest'
import {
  parseRefListing,
  parseReflogOldest,
  isAgentRow,
  inventoryRows,
  loadLocalInventory,
  type InventoryShell,
  type WorktreeEntry,
} from '../../src/git/local-inventory'

/** What the core's worktree list answers for the fixture checkout. */
const WORKTREES: WorktreeEntry[] = [
  { path: '/repo', branch: 'main', detached: false, prunable: false },
  {
    path: '/repo/.claude/worktrees/agent-x',
    branch: 'worktree-agent-x',
    detached: false,
    prunable: false,
  },
  { path: '/repo/.worktrees/detached', branch: null, detached: true, prunable: false },
  { path: '/gone/old-worktree', branch: 'feature-old', detached: false, prunable: true },
]

// Six NUL-separated fields per branch, records newline-separated, as
// `git for-each-ref refs/heads --format=...` prints them.
const REF_LISTING = [
  ['main', '', '', '1700000000', '/repo', 't-main'],
  ['feature-merged', 'origin/feature-merged', '', '1700001000', '', 't-merged'],
  ['feature-gone', 'origin/feature-gone', '[gone]', '1700002000', '', 't-gone'],
  [
    'worktree-agent-x',
    '',
    '[ahead 2, behind 3]',
    '1700003000',
    '/repo/.claude/worktrees/agent-x',
    't-agent',
  ],
  ['feature-old', 'origin/feature-old', '', '1700004000', '/gone/old-worktree', 't-old'],
]
  .map((record) => record.join('\0'))
  .join('\n')

/** A worktree without a `.git` file: nothing to read. */
const readFileOrNull = async () => null

const PARSED_REFS = [
  {
    branch: 'main',
    upstream: null,
    track: '',
    committerUnix: 1700000000,
    worktreePath: '/repo',
    tip: 't-main',
  },
  {
    branch: 'feature-merged',
    upstream: 'origin/feature-merged',
    track: '',
    committerUnix: 1700001000,
    worktreePath: '',
    tip: 't-merged',
  },
  {
    branch: 'feature-gone',
    upstream: 'origin/feature-gone',
    track: '[gone]',
    committerUnix: 1700002000,
    worktreePath: '',
    tip: 't-gone',
  },
  {
    branch: 'worktree-agent-x',
    upstream: null,
    track: '[ahead 2, behind 3]',
    committerUnix: 1700003000,
    worktreePath: '/repo/.claude/worktrees/agent-x',
    tip: 't-agent',
  },
  {
    branch: 'feature-old',
    upstream: 'origin/feature-old',
    track: '',
    committerUnix: 1700004000,
    worktreePath: '/gone/old-worktree',
    tip: 't-old',
  },
]

describe('parseRefListing', () => {
  it('reads the NUL-separated fields, including the empty ones', () => {
    expect(parseRefListing(REF_LISTING)).toEqual(PARSED_REFS)
  })
})

describe('parseReflogOldest', () => {
  it('takes the last line, the oldest entry, in milliseconds', () => {
    expect(parseReflogOldest('1700009000\n1700000500')).toBe(1700000500 * 1000)
    expect(parseReflogOldest('')).toBeNull()
  })
})

describe('isAgentRow', () => {
  it('knows claude worktrees and agent branches', () => {
    expect(isAgentRow(null, '/repo/.claude/worktrees/agent-x')).toBe(true)
    expect(isAgentRow('worktree-agent-x', '/repo/somewhere')).toBe(true)
    expect(isAgentRow('feature', '/repo/somewhere')).toBe(false)
  })
})

/** The facts inventoryRows assembles in these tests. */
const ROW_INPUT = {
  repoRoot: '/repo',
  worktrees: WORKTREES,
  refListing: REF_LISTING,
  defaultBranch: 'main',
  mergedBranches: ['main', 'feature-merged'],
  currentBranch: 'main',
  statTimes: {
    '/repo': { birthtimeMs: 1699999000000, mtimeMs: 1700000000000 },
    '/repo/.claude/worktrees/agent-x': { birthtimeMs: 1700002500000, mtimeMs: 1700003000000 },
    '/repo/.worktrees/detached': { birthtimeMs: 1700000100000, mtimeMs: 1700000200000 },
  },
  indexTimes: { '/repo/.claude/worktrees/agent-x': 1700003500000 },
  reflogOldest: { 'feature-merged': 1699990000000, 'feature-gone': 1699980000000 },
  projects: [{ id: 'p1', name: 'Agent X', worktreePath: '/repo/.claude/worktrees/agent-x' }],
}

describe('inventoryRows', () => {
  it('one row per branch, plus one per detached worktree', () => {
    const rows = inventoryRows(ROW_INPUT)
    expect(rows.map((r) => [r.branch, r.worktreePath])).toEqual([
      ['main', '/repo'],
      ['feature-merged', null],
      ['feature-gone', null],
      ['worktree-agent-x', '/repo/.claude/worktrees/agent-x'],
      ['feature-old', '/gone/old-worktree'],
      [null, '/repo/.worktrees/detached'],
    ])
  })
})

describe('inventoryRows — the flags', () => {
  it('marks main, merged, gone, ahead/behind, prunable and agent rows', () => {
    const rows = inventoryRows(ROW_INPUT)
    const byBranch = (b: string | null) => rows.find((r) => r.branch === b)!
    expect(byBranch('main')).toMatchObject({ isMain: true, isCurrent: true, merged: true })
    expect(byBranch('feature-merged')).toMatchObject({ merged: true, upstreamGone: false })
    expect(byBranch('feature-gone')).toMatchObject({ merged: false, upstreamGone: true })
    expect(byBranch('worktree-agent-x')).toMatchObject({
      ahead: 2,
      behind: 3,
      isAgent: true,
      upstream: null,
    })
    expect(byBranch('feature-old')).toMatchObject({ prunable: true })
    expect(rows.find((r) => r.branch === null)).toMatchObject({
      worktreePath: '/repo/.worktrees/detached',
      isAgent: false,
    })
    expect(rows.find((r) => r.branch === 'worktree-agent-x')!.isAgent).toBe(true)
  })
})

describe('inventoryRows — times and projects', () => {
  it('times: branch reflog for createdAt, worktree stat birthtime, index mtime wins for modifiedAt', () => {
    const rows = inventoryRows(ROW_INPUT)
    const byBranch = (b: string | null) => rows.find((r) => r.branch === b)!
    expect(byBranch('feature-merged').createdAt).toBe(1699990000000)
    expect(byBranch('feature-merged').modifiedAt).toBe(1700001000000)
    expect(byBranch('worktree-agent-x').createdAt).toBe(1700002500000)
    expect(byBranch('worktree-agent-x').modifiedAt).toBe(1700003500000)
    expect(rows.find((r) => r.branch === null)!.createdAt).toBe(1700000100000)
  })

  it('matches the Terminator project whose worktreePath the row names', () => {
    const rows = inventoryRows(ROW_INPUT)
    expect(rows.find((r) => r.branch === 'worktree-agent-x')!.project).toEqual({
      id: 'p1',
      name: 'Agent X',
    })
    expect(rows.find((r) => r.branch === 'main')!.project).toBeNull()
  })
})

interface FakeGit {
  answers: Record<string, string>
  statTimes?: Record<string, { birthtimeMs: number; mtimeMs: number }>
  projects?: Array<{ id: string; name: string; worktreePath?: string }>
}

/** An InventoryShell answering from command-line keys. */
function fakeShell(fake: FakeGit): InventoryShell {
  const exec = async (_cwd: string, args: string[]) => {
    const key = args.join(' ')
    for (const [prefix, out] of Object.entries(fake.answers)) {
      if (key.startsWith(prefix)) return out
    }
    throw new Error(`unexpected git ${key}`)
  }
  const stat = async (path: string) => {
    const times = fake.statTimes?.[path]
    if (!times) return null
    return { birthtimeMs: times.birthtimeMs, mtimeMs: times.mtimeMs }
  }
  const listProjects = async () => fake.projects ?? []
  const listWorktrees = async () => WORKTREES
  return { exec, listWorktrees, stat, readFile: readFileOrNull, listProjects }
}

/** The git answers of a checkout with the fixture's branches. */
const INVENTORY_ANSWERS = {
  'for-each-ref': REF_LISTING,
  'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main',
  'branch --merged main': '  main\n  feature-merged\n',
  'rev-parse --abbrev-ref HEAD': 'main',
  'reflog show --format=%ct refs/heads/feature-merged': '1699999000\n1699990000',
  'reflog show --format=%ct refs/heads/feature-gone': '1699980000',
  'reflog show --format=%ct refs/heads/worktree-agent-x': '1700003000',
  'reflog show --format=%ct refs/heads/feature-old': '1700004000',
}

describe('loadLocalInventory', () => {
  it('runs the four reads and assembles the rows', async () => {
    const shell = fakeShell({
      answers: INVENTORY_ANSWERS,
      statTimes: { '/repo': { birthtimeMs: 1, mtimeMs: 2 } },
    })
    const rows = await loadLocalInventory('/repo', shell)
    expect(rows).toHaveLength(6)
    expect(rows.find((r) => r.branch === 'main')!.isMain).toBe(true)
  })

  it('falls back to main when origin/HEAD is not set', async () => {
    const answers = { ...INVENTORY_ANSWERS, 'branch --merged main': 'main', 'reflog show': '' }
    delete (answers as Record<string, string>)['symbolic-ref --short refs/remotes/origin/HEAD']
    const rows = await loadLocalInventory('/repo', fakeShell({ answers }))
    expect(rows.find((r) => r.branch === 'main')!.isMain).toBe(true)
  })
})
