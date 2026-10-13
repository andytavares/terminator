import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { registerMergeFlowHandlers } from '../../src/ipc/merge-flow.ipc'
import { bindWorkspaceRoots } from '../../src/ipc/repo-root'
import { channelRegistry } from './support/channels'

// A decision in the Conflict Solver rewrites the conflicted file on disk.
// Written in place, a reader in between (git, an editor, a watcher) sees it
// empty; replaced by rename, it sees the old file or the new one, never less
// (https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath, rename(2)).

const CONFLICT = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature'

/** Invokes a merge-flow channel on run.sh's first block in `repo`. */
async function invokeOnBlock(repo: string, channel: string, payload: Record<string, unknown>) {
  const registry = channelRegistry()
  registerMergeFlowHandlers(registry.register)
  return registry.invoke(channel, { repoRoot: repo, blockId: 'run.sh#0', ...payload })
}

/** run.sh in `repo` is a new file, not inode `before`, and nothing else was left behind. */
function expectReplacedWhole(repo: string, before: number) {
  expect(statSync(join(repo, 'run.sh')).ino).not.toBe(before)
  expect(readdirSync(repo)).toEqual(['run.sh'])
}

describe('merge flow writes resolved files whole', () => {
  let repo: string
  const file = () => join(repo, 'run.sh')

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'merge-atomic-'))
    bindWorkspaceRoots(() => [repo])
    writeFileSync(file(), `#!/bin/sh\n${CONFLICT}\n`)
    chmodSync(file(), 0o755)
  })

  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  const invoke = (channel: string, payload: Record<string, unknown>) =>
    invokeOnBlock(repo, channel, payload)

  it('replaces the file instead of truncating it, keeping its mode and leaving nothing behind', async () => {
    const before = statSync(file()).ino

    const result = await invoke('git:resolve-conflict', {
      resolvedText: 'ours',
      strategy: 'ours',
      originalConflictText: CONFLICT,
    })

    expect(result).toEqual({ success: true })
    expect(readFileSync(file(), 'utf8')).toBe('#!/bin/sh\nours\n')
    expect(statSync(file()).mode & 0o777).toBe(0o755)
    expectReplacedWhole(repo, before)
  })
})

describe('merge flow writes resolved files whole — on undo', () => {
  let repo: string
  const file = () => join(repo, 'run.sh')

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'merge-atomic-'))
    bindWorkspaceRoots(() => [repo])
    writeFileSync(file(), `#!/bin/sh\n${CONFLICT}\n`)
    chmodSync(file(), 0o755)
  })

  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  const invoke = (channel: string, payload: Record<string, unknown>) =>
    invokeOnBlock(repo, channel, payload)

  it('undoing a decision replaces the file the same way', async () => {
    writeFileSync(file(), '#!/bin/sh\nours\n')
    const before = statSync(file()).ino

    await invoke('git:undo-resolve', { resolvedText: 'ours', originalConflictText: CONFLICT })

    expect(readFileSync(file(), 'utf8')).toBe(`#!/bin/sh\n${CONFLICT}\n`)
    expectReplacedWhole(repo, before)
  })
})
