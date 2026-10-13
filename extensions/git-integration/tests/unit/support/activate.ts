import { vi } from 'vitest'
import { isAbsolute, join, relative } from 'node:path'
import type { ChannelSpec, ExtensionAPI, SettingScope } from '@terminator/extension-sdk'
import { activate, deactivate } from '../../../src/index.ts'
import { makeTempDir } from '../../../../../tests/support/temp-dir'
import { partialFake } from '../../../../../tests/support/fakes'

interface RegisteredChannel {
  spec: ChannelSpec
  remoteAccessible: boolean
}

/** One workspace folder, with projects pointing at these worktrees, and the values it sets for itself. */
export interface FakeWorkspace {
  folderPath: string
  worktreePaths: string[]
  settings?: Record<string, unknown>
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

/** Where the stand-in API says the workspaces and this extension's own folder are, and its settings. */
interface ApiPlaces {
  workspaces: FakeWorkspace[]
  globalStorage: string
  settings?: Record<string, unknown>
}

/** An ipc whose registerHandler collects into `channels`. */
function capturingIpc(channels: RegisteredChannel[]) {
  return partialFake<ExtensionAPI['ipc']>({
    registerHandler: (spec: ChannelSpec, opts?: { remoteAccessible?: boolean }) => {
      channels.push({ spec, remoteAccessible: opts?.remoteAccessible === true })
      return disposable
    },
  })
}

const isWithin = (path: string, folder: string) => {
  const rel = relative(folder, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** As the core resolves one: the own value of the workspace holding `repoPath`, else the global one. */
function settingsOver(places: ApiPlaces) {
  const ownValues = (repoPath?: string) =>
    repoPath === undefined
      ? undefined
      : places.workspaces.find((w) => isWithin(repoPath, w.folderPath))?.settings
  return partialFake<ExtensionAPI['settings']>({
    get: <T>(key: string, scope?: SettingScope) =>
      (ownValues(scope?.repoPath)?.[key] ?? places.settings?.[key]) as T | undefined,
    register: () => disposable,
    isBranchExcluded: async () => false,
  })
}

/** A stand-in ExtensionAPI whose registerHandler collects into `channels`. */
function capturingApi(
  channels: RegisteredChannel[],
  spies: ApiSpies,
  places: ApiPlaces
): ExtensionAPI {
  return partialFake<ExtensionAPI>({
    ipc: capturingIpc(channels),
    settings: settingsOver(places),
    paths: { app: '/app', globalStorage: places.globalStorage },
    log: { debug: () => {}, info: () => {}, warn: spies.warn, error: () => {} },
    commands: { register: () => disposable },
    window: partialFake<ExtensionAPI['window']>({ broadcast: () => {}, openAuxiliary: () => {} }),
    nativeMenu: partialFake<ExtensionAPI['nativeMenu']>({ addViewMenuItem: () => disposable }),
    notifications: partialFake<ExtensionAPI['notifications']>({
      showToast: () => {},
      createNotification: () => disposable,
    }),
    workspace: fakeWorkspaceApi(places.workspaces),
    shell: partialFake<ExtensionAPI['shell']>({ exec: spies.exec }),
    github: partialFake<ExtensionAPI['github']>({
      api: spies.githubApi,
      pullRequests: { view: spies.githubApi, list: spies.githubApi },
    }),
  })
}

function fakeWorkspaceApi(workspaces: FakeWorkspace[]) {
  const id = (index: number) => `w${index + 1}`
  return partialFake<ExtensionAPI['workspace']>({
    list: () => workspaces.map((w, i) => ({ id: id(i), name: id(i), folderPath: w.folderPath })),
    listProjects: (workspaceId) =>
      workspaces
        .filter((_, i) => id(i) === workspaceId)
        .flatMap((w) =>
          w.worktreePaths.map((worktreePath, i) => ({
            id: `${workspaceId}-p${i}`,
            workspaceId,
            name: `p${i}`,
            worktreePath,
          }))
        ),
  })
}

/** Activates git-integration over these workspaces; returns its channels and the shell, gh and log warn spies. */
export function activateInWorkspaces(
  workspaces: FakeWorkspace[],
  settings?: Record<string, unknown>,
  globalStorage = freshGlobalStorage()
) {
  const channels: RegisteredChannel[] = []
  const spies = { exec: vi.fn(), githubApi: vi.fn(), warn: vi.fn() }
  activate(capturingApi(channels, spies, { workspaces, globalStorage, settings }))
  deactivate()
  return { channels, ...spies }
}

/** Activates git-integration on a stand-in API; returns its channels and the shell, gh and log warn spies. */
export function activateCapturingChannels(
  workspace?: FakeWorkspace,
  globalStorage = freshGlobalStorage(),
  settings?: Record<string, unknown>
) {
  return activateInWorkspaces(workspace ? [workspace] : [], settings, globalStorage)
}
