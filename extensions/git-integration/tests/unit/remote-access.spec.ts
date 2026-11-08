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

// A logged-in remote browser reaches only what is opted in (ADR 094); a channel
// added here is a decision, so the list is spelled out. A valid payload for each
// remote channel, naming `root` as its checkout; null for one that takes no directory.
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

describe('the remote browser client', () => {
  it('may call exactly the read-only channels PAYLOAD_AT lists, and nothing that writes or runs', () => {
    const remote = activateCapturingChannels()
      .channels.filter((c) => c.remoteAccessible)
      .map((c) => c.spec.channel)
    expect(remote.sort()).toEqual(Object.keys(PAYLOAD_AT).sort())
  })
})

interface ScratchDirs {
  scratch: string
  workspaceFolder: string
  project: string
  outside: string
}

/** A workspace folder, a project with a worktree inside it and a symlink out of it, and a folder
 *  outside both; made before the describe's tests and removed after them. */
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

/** Each remote channel that takes a directory, with the payload naming it. */
const DIRECTORY_CHANNELS = Object.entries(PAYLOAD_AT).flatMap(([channel, payloadAt]) =>
  payloadAt ? [{ channel, payloadAt }] : []
)

/** The registered spec of `channel`, with `run` replaced by a spy. */
function spiedSpec(dirs: ScratchDirs, channel: string) {
  const spec = remoteChannelsIn(dirs).find((s) => s.channel === channel)!
  return { ...spec, run: vi.fn() }
}

describe("a remote-accessible channel's repoRoot", () => {
  const dirs = useScratchDirs()

  it.each(DIRECTORY_CHANNELS)(
    '$channel is refused outside the workspace, even through a symlink, before it runs',
    async ({ channel, payloadAt }) => {
      const spec = spiedSpec(dirs, channel)
      const refused = await dispatchChannel(spec, 42)
      const roots = [dirs.outside, join(dirs.project, 'escape'), '/']
      const answers = await Promise.all(roots.map((root) => dispatchChannel(spec, payloadAt(root))))
      expect(answers).toEqual([refused, refused, refused])
      expect(spec.run).not.toHaveBeenCalled()
    }
  )
})

describe("a remote-accessible channel's repoRoot — inside the workspace", () => {
  const dirs = useScratchDirs()

  it.each(DIRECTORY_CHANNELS)(
    '$channel is accepted at a project, the workspace folder, a worktree inside one, or a gh: repository',
    async ({ channel, payloadAt }) => {
      const { project, workspaceFolder } = dirs
      const roots = [
        project,
        workspaceFolder,
        join(project, '.worktrees', 'fix'),
        'gh:acme/widgets',
      ]
      const spec = spiedSpec(dirs, channel)
      await Promise.all(roots.map((root) => dispatchChannel(spec, payloadAt(root))))
      expect(spec.run).toHaveBeenCalledTimes(roots.length)
    }
  )
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
    // Activation starts Home's own refreshes; they run in the extension's storage, never `outside`.
    const calls = githubApi.mock.calls as unknown as Array<[{ cwd?: string }, unknown]>
    expect(calls.filter(([target]) => target.cwd?.startsWith(outside))).toEqual([])
  })
})
