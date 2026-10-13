import { vi } from 'vitest'
import { join } from 'node:path'
import type { ChannelSpec, ExtensionAPI } from '@terminator/extension-sdk'
import { activate, deactivate } from '../../../src/index.ts'
import { makeTempDir } from '../../../../../tests/support/temp-dir'

interface RegisteredChannel {
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

const disposable = { dispose: () => {} }

interface ApiSpies {
  exec: ReturnType<typeof vi.fn>
  githubApi: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
}

/** Where the stand-in API says the workspace and this extension's own folder are. */
interface ApiPlaces {
  workspace?: FakeWorkspace
  globalStorage: string
}

/** A stand-in ExtensionAPI whose registerHandler collects into `channels`. */
function capturingApi(
  channels: RegisteredChannel[],
  spies: ApiSpies,
  places: ApiPlaces
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
    paths: { app: '/app', globalStorage: places.globalStorage },
    log: { debug: () => {}, info: () => {}, warn: spies.warn, error: () => {} },
    commands: { register: () => disposable },
    window: { broadcast: () => {}, openAuxiliary: () => {} },
    nativeMenu: { addViewMenuItem: () => disposable },
    notifications: { showToast: () => {}, createNotification: () => disposable },
    workspace: fakeWorkspaceApi(places.workspace),
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

/** Activates git-integration on a stand-in API; returns its channels and the shell, gh and log warn spies. */
export function activateCapturingChannels(
  workspace?: FakeWorkspace,
  globalStorage = freshGlobalStorage()
) {
  const channels: RegisteredChannel[] = []
  const spies = { exec: vi.fn(), githubApi: vi.fn(), warn: vi.fn() }
  activate(capturingApi(channels, spies, { workspace, globalStorage }))
  deactivate()
  return { channels, ...spies }
}
