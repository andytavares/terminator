// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRepoGit } from '../../../../src/renderer/components/home/start-work-model'
import { startWork } from '../../../../src/renderer/components/home/start-work'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { installElectronApi } from '../../../support/electron-api'
import { workspaceFixture } from '../../../support/renderer-stores'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'

// Starting work on a branch needs the repository: a git that could not answer is reported as
// that, not as the folder being no repository.

const workspace = workspaceFixture({ id: 'ws-1', name: 'Terminator', folderPath: '/repo' })

function withIsRepo(answer: Awaited<ReturnType<ElectronAPI['git']['isRepo']>>): void {
  installElectronApi({ git: { isRepo: async () => answer } })
}

beforeEach(() => {
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [workspace],
    projectsByWorkspaceId: new Map(),
  })
})

const startOnBranch = () =>
  startWork({ kind: 'branch', workspace, branch: 'feat/x', runAs: 'terminal' })

describe('startWork on a branch — what git said about the repository', () => {
  it('says the folder is not a repository when git said so', async () => {
    withIsRepo({ isRepo: false })
    expect(await startOnBranch()).toBe('Terminator is not a git repo.')
  })

  it('says git could not be read when it gave no answer, and not that it is no repository', async () => {
    withIsRepo({ error: 'git rev-parse timed out' })
    const message = await startOnBranch()
    expect(message).toMatch(/could not read/i)
    expect(message).not.toMatch(/not a git repo/i)
  })
})

describe('the launcher reading a repository', () => {
  it('shows the branches of a repository, and none when git could not answer', async () => {
    const git = {
      isRepo: async () => ({ isRepo: true, root: '/repo' }) as never,
      listBranches: async () => ({
        branches: [{ name: 'main', isCurrent: true, isRemote: false }],
      }),
      listWorktrees: async () => ({ worktrees: [] }),
    }
    installElectronApi({ git })
    const { result, rerender } = renderHook(({ ws }) => useRepoGit(ws), {
      initialProps: { ws: workspace },
    })
    await waitFor(() => expect(result.current.freeBranchNames).toEqual(['main']))
    installElectronApi({ git: { ...git, isRepo: async () => ({ error: 'timed out' }) } })
    rerender({ ws: { ...workspace, id: 'ws-2', folderPath: '/other' } })
    await waitFor(() => expect(result.current.freeBranchNames).toEqual([]))
  })
})
