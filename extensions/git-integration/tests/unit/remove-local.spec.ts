import { describe, it, expect } from 'vitest'
import { removeLocalItems, type RemoveShell } from '../../src/git/remove-local'

interface Call {
  cwd: string
  args: string[]
}

interface FakeShellOptions {
  mainWorktree?: string
  currentBranch?: string
  projects?: Array<{ id: string; name: string; worktreePath?: string }>
  sessions?: Array<{ cwd: string; projectId?: string }>
  failOn?: (args: string[]) => string | null
}

/** An InventoryShell over recorded calls; git answers from `failOn`, success otherwise. */
function recordingShell(options: FakeShellOptions) {
  const calls: Call[] = []
  const deleted: string[] = []
  const shell: RemoveShell = {
    exec: async (cwd, args) => {
      calls.push({ cwd, args })
      if (args[0] === 'worktree' && args[1] === 'list')
        return `worktree ${options.mainWorktree ?? '/repo'}\nbranch refs/heads/main\n`
      if (args[0] === 'rev-parse') return options.currentBranch ?? 'main'
      const failure = options.failOn?.(args)
      if (failure) throw new Error(failure)
      return ''
    },
    listProjects: async () => options.projects ?? [],
    listSessions: async () => options.sessions ?? [],
    deleteProject: (id) => deleted.push(id),
  }
  return { shell, calls, deleted }
}

const gitArgs = (calls: Call[]) => calls.map((c) => c.args.join(' '))

describe('removeLocalItems — refusals', () => {
  it('refuses the main worktree and the current branch', async () => {
    const { shell, calls } = recordingShell({ currentBranch: 'main' })
    const { results } = await removeLocalItems('/repo', shell, [
      { branch: null, worktreePath: '/repo', forceBranch: false },
      { branch: 'main', worktreePath: null, forceBranch: false },
    ])
    expect(results).toEqual([
      { branch: null, worktreePath: '/repo', ok: false, reason: 'main worktree' },
      { branch: 'main', worktreePath: null, ok: false, reason: 'current branch' },
    ])
    expect(calls.filter((c) => c.args[0] === 'branch')).toEqual([])
  })
})

const removalItem = (branch: string | null, worktreePath: string | null, forceBranch = false) => ({
  branch,
  worktreePath,
  forceBranch,
})

const FIX_PROJECT = [{ id: 'p1', name: 'Fix', worktreePath: '/repo/.worktrees/fix' }]

describe('removeLocalItems — removal', () => {
  it('removes the worktree, then the branch with -d for a merged one, and prunes once', async () => {
    const { shell, calls } = recordingShell({})
    const { results } = await removeLocalItems('/repo', shell, [
      removalItem('feature', '/repo/.worktrees/feature'),
      removalItem('stale', null, true),
    ])
    expect(gitArgs(calls)).toEqual([
      'worktree list --porcelain',
      'rev-parse --abbrev-ref HEAD',
      'worktree remove /repo/.worktrees/feature',
      'branch -d feature',
      'branch -D stale',
      'worktree prune',
    ])
    expect(results).toEqual([
      { branch: 'feature', worktreePath: '/repo/.worktrees/feature', ok: true },
      { branch: 'stale', worktreePath: null, ok: true },
    ])
  })
})

describe('removeLocalItems — failures', () => {
  it('reports a failed item with git’s message and keeps going', async () => {
    const { shell, calls } = recordingShell({
      failOn: (args) => (args[1] === 'remove' ? 'fatal: is dirty' : null),
    })
    const { results } = await removeLocalItems('/repo', shell, [
      removalItem('wip', '/repo/.worktrees/wip'),
    ])
    expect(results).toEqual([
      { branch: 'wip', worktreePath: '/repo/.worktrees/wip', ok: false, reason: 'fatal: is dirty' },
    ])
    // The branch stays too: the item failed as a whole. Prune still runs.
    expect(gitArgs(calls)).toContain('worktree prune')
    expect(gitArgs(calls)).not.toContain('branch -d wip')
  })
})

describe('removeLocalItems — the project of a removed worktree', () => {
  it('deletes the Terminator project of a removed worktree', async () => {
    const { shell, deleted } = recordingShell({ projects: FIX_PROJECT })
    await removeLocalItems('/repo', shell, [removalItem(null, '/repo/.worktrees/fix')])
    expect(deleted).toEqual(['p1'])
  })

  it('keeps the project when the removal failed', async () => {
    const { shell, deleted } = recordingShell({
      projects: FIX_PROJECT,
      failOn: () => 'fatal: nope',
    })
    await removeLocalItems('/repo', shell, [removalItem(null, '/repo/.worktrees/fix')])
    expect(deleted).toEqual([])
  })
})

describe('removeLocalItems — a worktree with an open session', () => {
  const OPEN = '/repo/.worktrees/open'

  it('refuses a worktree a terminal runs in, whatever the caller asked for', async () => {
    const { shell, calls } = recordingShell({ sessions: [{ cwd: `${OPEN}/src` }] })
    const { results } = await removeLocalItems('/repo', shell, [removalItem('open', OPEN, true)])
    expect(results).toEqual([
      { branch: 'open', worktreePath: OPEN, ok: false, reason: 'open session' },
    ])
    expect(gitArgs(calls).some((args) => args.startsWith('worktree remove'))).toBe(false)
    expect(gitArgs(calls).some((args) => args.startsWith('branch -'))).toBe(false)
  })

  it('refuses a worktree whose project card has a terminal, even one that runs elsewhere', async () => {
    const { shell } = recordingShell({
      projects: [{ id: 'p9', name: 'Open', worktreePath: OPEN }],
      sessions: [{ cwd: '/somewhere/else', projectId: 'p9' }],
    })
    const { results } = await removeLocalItems('/repo', shell, [removalItem('open', OPEN)])
    expect(results[0]).toMatchObject({ ok: false, reason: 'open session' })
  })

  it('does not treat a sibling folder with the same prefix as the same worktree', async () => {
    const { shell } = recordingShell({ sessions: [{ cwd: `${OPEN}-other` }] })
    const { results } = await removeLocalItems('/repo', shell, [removalItem(null, OPEN)])
    expect(results[0]).toMatchObject({ ok: true })
  })
})

describe('removeLocalItems — the branch fails after the worktree went', () => {
  it('reports the failure but still removes the project card of the deleted folder', async () => {
    const { shell, deleted } = recordingShell({
      projects: FIX_PROJECT,
      failOn: (args) => (args[0] === 'branch' ? 'error: not fully merged' : null),
    })
    const { results } = await removeLocalItems('/repo', shell, [
      removalItem('fix', '/repo/.worktrees/fix'),
    ])
    expect(results[0]).toMatchObject({ ok: false, reason: 'error: not fully merged' })
    expect(deleted).toEqual(['p1'])
  })
})
