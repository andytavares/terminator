import { vi } from 'vitest'
import { join } from 'node:path'
import type { ChannelSpec, ExtensionAPI } from '@terminator/extension-sdk'
import { activate, deactivate } from '../../../src/index.ts'
import { makeTempDir } from '../../../../../tests/support/temp-dir'

export interface RegisteredChannel {
  spec: ChannelSpec
  remoteAccessible: boolean
}

/** One workspace folder, with projects pointing at these worktrees. */
export interface FakeWorkspace {
  folderPath: string
  worktreePaths: string[]
}

/** A `paths.globalStorage` in a fresh userData, `<userData>/extensions/<id>`, not created yet. */
export function freshGlobalStorage(): string {
  const userData = makeTempDir('git-integration-user-data-')
  return join(userData, 'extensions', 'terminator.git-integration')
}

/**
 * Activates git-integration against a stand-in API and returns every channel
 * it registered, with the shell, gh and the log's warn as spies.
 */
export function activateCapturingChannels(
  workspace?: FakeWorkspace,
  globalStorage = freshGlobalStorage()
) {
  const channels: RegisteredChannel[] = []
  const disposable = { dispose: () => {} }
  const exec = vi.fn()
  const githubApi = vi.fn()
  const warn = vi.fn()
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
    paths: { app: '/app', globalStorage },
    log: { debug: () => {}, info: () => {}, warn, error: () => {} },
    commands: { register: () => disposable },
    window: { broadcast: () => {}, openAuxiliary: () => {} },
    nativeMenu: { addViewMenuItem: () => disposable },
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
  return { channels, exec, githubApi, warn }
}
