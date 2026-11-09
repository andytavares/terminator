import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  loadLocalInventory,
  type InventoryShell,
  type WorktreeEntry,
} from '../../src/git/local-inventory'
import { makeTempDir } from '../../../../packages/test-support/src/temp-dir'

/** A worktree without a `.git` file: nothing to read. */
const readFileOrNull = async () => null

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

/** The worktrees as the core lists them, read from real git's own list. */
async function realWorktrees(repoRoot: string): Promise<WorktreeEntry[]> {
  return gitSync(repoRoot, ['worktree', 'list', '--porcelain'])
    .trim()
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n')
      const branch = lines.find((l) => l.startsWith('branch '))
      return {
        path: lines[0].slice('worktree '.length),
        branch: branch ? branch.slice('branch refs/heads/'.length) : null,
        detached: lines.includes('detached'),
        prunable: false,
      }
    })
}

const realGitShell = (): InventoryShell => ({
  exec: async (cwd, args) => gitSync(cwd, args),
  listWorktrees: realWorktrees,
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
  })
})
