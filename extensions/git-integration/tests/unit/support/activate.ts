import { vi } from 'vitest'
import type { ChannelSpec, ExtensionAPI } from '@terminator/extension-sdk'
import { activate, deactivate } from '../../../src/index.ts'

export interface RegisteredChannel {
  spec: ChannelSpec
  remoteAccessible: boolean
}

/** One workspace folder, with projects pointing at these worktrees. */
export interface FakeWorkspace {
  folderPath: string
  worktreePaths: string[]
}

/**
 * Activates git-integration against a stand-in API and returns every channel
 * it registered, with the shell and gh entry points as spies.
 */
export function activateCapturingChannels(workspace?: FakeWorkspace) {
  const channels: RegisteredChannel[] = []
  const disposable = { dispose: () => {} }
  const exec = vi.fn()
  const githubApi = vi.fn()
  const api = {
    ipc: {
      registerHandler: (spec: ChannelSpec, opts?: { remoteAccessible?: boolean }) => {
        channels.push({ spec, remoteAccessible: opts?.remoteAccessible === true })
        return disposable
      },
    },
    settings: {
      get: () => undefined,
      register: () => disposable,
      isBranchExcluded: async () => false,
    },
    paths: { app: '/app', userData: '/user-data' },
    commands: { register: () => disposable },
    window: { broadcast: () => {}, openAuxiliary: () => {} },
    nativeMenu: { addViewMenuItem: () => disposable },
    topBar: { registerMenuItem: () => disposable },
    notifications: { showToast: () => {}, createNotification: () => disposable },
    workspace: {
      list: () => (workspace ? [{ id: 'w1', name: 'w', folderPath: workspace.folderPath }] : []),
      listProjects: () =>
        (workspace?.worktreePaths ?? []).map((worktreePath, i) => ({
          id: `p${i}`,
          workspaceId: 'w1',
          name: `p${i}`,
          worktreePath,
        })),
    },
    shell: { exec },
    github: { api: githubApi, pullRequests: { view: githubApi, list: githubApi } },
  } as unknown as ExtensionAPI
  activate(api)
  deactivate()
  return { channels, exec, githubApi }
}
