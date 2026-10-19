import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  parseWorktreePorcelain,
  parseRefListing,
  parseReflogOldest,
  isAgentRow,
  inventoryRows,
  loadLocalInventory,
  type InventoryShell,
} from '../../src/git/local-inventory'
import { makeTempDir } from '../../../../tests/support/temp-dir'

const PORCELAIN = `worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /repo/.claude/worktrees/agent-x
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/worktree-agent-x

worktree /repo/.worktrees/detached
HEAD cccccccccccccccccccccccccccccccccccccccc
detached

worktree /gone/old-worktree
HEAD dddddddddddddddddddddddddddddddddddddddd
branch refs/heads/feature-old
prunable gitdir file points to non-existent location
`

// Five NUL-separated fields per branch, records newline-separated, as
// `git for-each-ref refs/heads --format=...` prints them.
const REF_LISTING = [
  ['main', '', '', '1700000000', '/repo'],
  ['feature-merged', 'origin/feature-merged', '', '1700001000', ''],
  ['feature-gone', 'origin/feature-gone', '[gone]', '1700002000', ''],
  ['worktree-agent-x', '', '[ahead 2, behind 3]', '1700003000', '/repo/.claude/worktrees/agent-x'],
  ['feature-old', 'origin/feature-old', '', '1700004000', '/gone/old-worktree'],
]
  .map((record) => record.join('\0'))
  .join('\n')

/** A worktree without a `.git` file: nothing to read. */
const readFileOrNull = async () => null

describe('parseWorktreePorcelain', () => {
  it('parses branches, detached heads and prunable entries', () => {
    expect(parseWorktreePorcelain(PORCELAIN)).toEqual([
      { path: '/repo', branch: 'main', detached: false, prunable: false },
      {
        path: '/repo/.claude/worktrees/agent-x',
        branch: 'worktree-agent-x',
        detached: false,
        prunable: false,
      },
      { path: '/repo/.worktrees/detached', branch: null, detached: true, prunable: false },
      { path: '/gone/old-worktree', branch: 'feature-old', detached: false, prunable: true },
    ])
  })
})

const PARSED_REFS = [
  {
    branch: 'main',
    upstream: null,
    track: '',
    committerUnix: 1700000000,
    worktreePath: '/repo',
  },
  {
    branch: 'feature-merged',
    upstream: 'origin/feature-merged',
    track: '',
    committerUnix: 1700001000,
    worktreePath: '',
  },
  {
    branch: 'feature-gone',
    upstream: 'origin/feature-gone',
    track: '[gone]',
    committerUnix: 1700002000,
    worktreePath: '',
  },
  {
    branch: 'worktree-agent-x',
    upstream: null,
    track: '[ahead 2, behind 3]',
    committerUnix: 1700003000,
    worktreePath: '/repo/.claude/worktrees/agent-x',
  },
  {
    branch: 'feature-old',
    upstream: 'origin/feature-old',
    track: '',
    committerUnix: 1700004000,
    worktreePath: '/gone/old-worktree',
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
  porcelain: PORCELAIN,
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
  return { exec, stat, readFile: readFileOrNull, listProjects }
}

/** The git answers of a checkout with the fixture's branches. */
const INVENTORY_ANSWERS = {
  'worktree list --porcelain': PORCELAIN,
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

// Real git in a temp repository: the parsers meet the actual output.
function realGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  delete env['GIT_DIR']
  delete env['GIT_WORK_TREE']
  return env
}

function gitSync(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: realGitEnv() })
}

/** stat over fs/promises, null when the path is gone. */
async function statOrNull(path: string): Promise<{ birthtimeMs: number; mtimeMs: number } | null> {
  const fs = await import('node:fs/promises')
  const times = await fs.stat(path).catch(() => null)
  return times ? { birthtimeMs: times.birthtimeMs, mtimeMs: times.mtimeMs } : null
}

const realGitShell = (): InventoryShell => ({
  exec: async (cwd, args) => gitSync(cwd, args),
  stat: statOrNull,
  readFile: readFileOrNull,
  listProjects: async () => [],
})

/** main with a merged branch, a pushed-then-deleted one, and a detached agent worktree. */
function seedInventoryRepo(parent: string): { repo: string; agent: string } {
  const repo = join(parent, 'app')
  gitSync(parent, ['init', '-q', '-b', 'main', 'app'])
  gitSync(repo, ['config', 'user.name', 'Test'])
  gitSync(repo, ['config', 'user.email', 'test@example.com'])
  gitSync(repo, ['config', 'commit.gpgsign', 'false'])
  gitSync(repo, ['commit', '-q', '--allow-empty', '-m', 'seed'])
  gitSync(parent, ['init', '-q', '--bare', 'origin.git'])
  gitSync(repo, ['remote', 'add', 'origin', join(parent, 'origin.git')])
  gitSync(repo, ['push', '-q', '-u', 'origin', 'main'])
  gitSync(repo, ['remote', 'set-head', 'origin', 'main'])
  gitSync(repo, ['checkout', '-q', '-b', 'feature-merged'])
  gitSync(repo, ['checkout', '-q', 'main'])
  gitSync(repo, ['checkout', '-q', '-b', 'feature-gone'])
  gitSync(repo, ['commit', '-q', '--allow-empty', '-m', 'wip'])
  gitSync(repo, ['push', '-q', '-u', 'origin', 'feature-gone'])
  gitSync(repo, ['push', '-q', 'origin', ':feature-gone'])
  gitSync(repo, ['checkout', '-q', 'main'])
  const agent = join(parent, 'repo2', '.claude', 'worktrees', 'agent-x')
  gitSync(repo, ['worktree', 'add', '-q', '--detach', agent])
  return { repo, agent }
}

describe('loadLocalInventory over real git', () => {
  it('reports merged branches, worktrees and agent worktrees', async () => {
    const { repo, agent } = seedInventoryRepo(makeTempDir('gi-inventory-'))
    const rows = await loadLocalInventory(repo, realGitShell())
    const byBranch = (b: string | null) => rows.find((r) => r.branch === b)
    expect(byBranch('main')).toMatchObject({ isMain: true, isCurrent: true })
    expect(byBranch('feature-merged')).toMatchObject({ merged: true, upstreamGone: false })
    expect(byBranch('feature-gone')).toMatchObject({ merged: false, upstreamGone: true })
    const detached = rows.find((r) => r.branch === null)
    expect(detached).toMatchObject({ worktreePath: agent, isAgent: true })
    expect(detached!.createdAt).not.toBeNull()
    expect(byBranch('feature-merged')!.createdAt).not.toBeNull()
  }, 20000)
})
