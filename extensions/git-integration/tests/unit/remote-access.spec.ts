import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { dispatchChannel } from '@terminator/extension-sdk'
import { makeTempDir } from '../../../../tests/support/temp-dir'

vi.mock('electron-store', () => ({
  default: class {
    store = {}
    get() {
      return undefined
    }
    set() {}
    delete() {}
  },
}))

import { activateCapturingChannels } from './support/activate'

describe('the remote browser client', () => {
  // A logged-in remote browser reaches only what is opted in (ADR 094); a
  // channel added here is a decision, so the list is spelled out.
  it('may call exactly these read-only channels, and nothing that writes or runs', () => {
    const remote = activateCapturingChannels()
      .channels.filter((c) => c.remoteAccessible)
      .map((c) => c.spec.channel)
    expect(remote.sort()).toEqual([
      'git:conflicts-list',
      'git:pr-status',
      'git:status',
      'github:accessible-repos',
      'github:active-reviews-for-repo',
      'github:current-user',
      'github:dashboard-search',
      'github:list-open-prs',
      'github:pr-compare',
      'github:pr-inline-comments',
      'github:pr-issue-comments',
      'github:pr-review-detail',
      'github:review-settings',
      'github:session-get',
      'github:sessions-for-repo',
      'review-agent:list',
      'review-agent:settings',
    ])
  })
})

// A valid payload for each remote channel, naming `root` as its checkout; null
// for a channel that takes no directory.
const PAYLOAD_AT: Record<string, ((root: string) => unknown) | null> = {
  'git:conflicts-list': (root) => ({ repoRoot: root }),
  'git:pr-status': (root) => ({ repoRoot: root }),
  'git:status': (root) => ({ path: root }),
  'github:accessible-repos': null,
  'github:active-reviews-for-repo': (root) => ({ repoRoot: root }),
  'github:current-user': (root) => ({ repoRoot: root }),
  'github:dashboard-search': null,
  'github:list-open-prs': (root) => ({ repoRoot: root }),
  'github:pr-compare': (root) => ({ repoRoot: root, fromSha: 'a1', toSha: 'b2' }),
  'github:pr-inline-comments': (root) => ({ repoRoot: root, prNumber: 7 }),
  'github:pr-issue-comments': (root) => ({ repoRoot: root, prNumber: 7 }),
  'github:pr-review-detail': (root) => ({ repoRoot: root, prNumber: 7 }),
  'github:review-settings': null,
  // A review session's store key: it names no directory and runs nothing.
  'github:session-get': null,
  'github:sessions-for-repo': (root) => ({ repoRoot: root }),
  'review-agent:list': (root) => ({ repoRoot: root, prNumber: 7, headSHA: 'abc' }),
  'review-agent:settings': null,
}

interface ScratchDirs {
  scratch: string
  workspaceFolder: string
  project: string
  outside: string
}

/**
 * A workspace folder, a project with a worktree inside it and a symlink leading out of it,
 * and a folder outside both; made before the describe's tests and removed after them.
 */
function useScratchDirs(): ScratchDirs {
  const dirs = {} as ScratchDirs
  beforeAll(() => {
    dirs.scratch = makeTempDir('gi-roots-')
    dirs.workspaceFolder = join(dirs.scratch, 'workspace')
    dirs.project = join(dirs.scratch, 'project-worktree')
    dirs.outside = join(dirs.scratch, 'elsewhere')
    const { workspaceFolder, project, outside } = dirs
    for (const dir of [workspaceFolder, project, outside, join(project, '.worktrees', 'fix')]) {
      mkdirSync(dir, { recursive: true })
    }
    symlinkSync(outside, join(project, 'escape'))
  })
  afterAll(() => rmSync(dirs.scratch, { recursive: true, force: true }))
  return dirs
}

/** The remote-accessible channels' specs, as activation registers them. */
function remoteChannelsIn(dirs: ScratchDirs) {
  return activateCapturingChannels({
    folderPath: dirs.workspaceFolder,
    worktreePaths: [dirs.project],
  })
    .channels.filter((c) => c.remoteAccessible)
    .map((c) => c.spec)
}

describe("a remote-accessible channel's repoRoot", () => {
  const dirs = useScratchDirs()
  const remoteChannels = () => remoteChannelsIn(dirs)

  it('is checked for every remote channel that takes a directory', () => {
    expect(Object.keys(PAYLOAD_AT).sort()).toEqual(
      remoteChannels()
        .map((s) => s.channel)
        .sort()
    )
  })

  it('is refused outside the workspace, even through a symlink, before the channel runs', async () => {
    for (const spec of remoteChannels()) {
      const payloadAt = PAYLOAD_AT[spec.channel]
      if (!payloadAt) continue
      const run = vi.fn()
      const refused = await dispatchChannel({ ...spec, run }, 42)
      for (const root of [dirs.outside, join(dirs.project, 'escape'), '/']) {
        const answer = await dispatchChannel({ ...spec, run }, payloadAt(root))
        expect(answer, `${spec.channel} at ${root}`).toEqual(refused)
      }
      expect(run, `${spec.channel} ran outside the workspace`).not.toHaveBeenCalled()
    }
  })
})

describe("a remote-accessible channel's repoRoot — inside the workspace", () => {
  const dirs = useScratchDirs()
  const remoteChannels = () => remoteChannelsIn(dirs)

  it('is accepted at a project, the workspace folder, a worktree inside one, or a gh: repository', async () => {
    const { project, workspaceFolder } = dirs
    const roots = [project, workspaceFolder, join(project, '.worktrees', 'fix'), 'gh:acme/widgets']
    for (const spec of remoteChannels()) {
      const payloadAt = PAYLOAD_AT[spec.channel]
      if (!payloadAt) continue
      const run = vi.fn()
      for (const root of roots) await dispatchChannel({ ...spec, run }, payloadAt(root))
      expect(run, spec.channel).toHaveBeenCalledTimes(roots.length)
    }
  })
})

describe("a remote-accessible channel's repoRoot — outside the workspace", () => {
  const dirs = useScratchDirs()

  it('outside the workspace runs no git and no gh', async () => {
    const { outside } = dirs
    const { channels, exec, githubApi } = activateCapturingChannels({
      folderPath: dirs.workspaceFolder,
      worktreePaths: [dirs.project],
    })
    const spec = (name: string) => channels.find((c) => c.spec.channel === name)!.spec

    expect(await dispatchChannel(spec('git:status'), { path: outside })).toEqual({
      error: 'VALIDATION_ERROR',
    })
    expect(await dispatchChannel(spec('github:list-open-prs'), { repoRoot: outside })).toEqual({
      error: 'VALIDATION_ERROR',
    })
    expect(exec).not.toHaveBeenCalled()
    expect(githubApi).not.toHaveBeenCalled()
  })
})
