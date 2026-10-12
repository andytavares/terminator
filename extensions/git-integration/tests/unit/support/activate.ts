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

const disposable = { dispose: () => {} }

/** A stand-in ExtensionAPI whose registerHandler collects into `channels`. */
function capturingApi(
  channels: RegisteredChannel[],
  spies: { exec: ReturnType<typeof vi.fn>; githubApi: ReturnType<typeof vi.fn> },
  workspace?: FakeWorkspace
): ExtensionAPI {
  return {
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
    notifications: { showToast: () => {}, createNotification: () => disposable },
    workspace: fakeWorkspaceApi(workspace),
    shell: { exec: spies.exec },
    github: {
      api: spies.githubApi,
      pullRequests: { view: spies.githubApi, list: spies.githubApi },
    },
  } as unknown as ExtensionAPI
}

function fakeWorkspaceApi(workspace?: FakeWorkspace) {
  return {
    list: () => (workspace ? [{ id: 'w1', name: 'w', folderPath: workspace.folderPath }] : []),
    listProjects: () =>
      (workspace?.worktreePaths ?? []).map((worktreePath, i) => ({
        id: `p${i}`,
        workspaceId: 'w1',
        name: `p${i}`,
        worktreePath,
      })),
  }
}

/**
 * Activates git-integration against a stand-in API and returns every channel
 * it registered, with the shell and gh entry points as spies.
 */
export function activateCapturingChannels(workspace?: FakeWorkspace) {
  const channels: RegisteredChannel[] = []
  const exec = vi.fn()
  const githubApi = vi.fn()
  activate(capturingApi(channels, { exec, githubApi }, workspace))
  deactivate()
  return { channels, exec, githubApi }
}
