/**
 * Foundry activated over a host that answers like the application would.
 *
 * Real files under a temporary records location and real `git`; `gh` and the
 * tracker answer from what a spec gives them, because both reach the network.
 * A spec mocks the supervised runner and the control server itself (`vi.mock`
 * is per file), with `supervision-mocks.ts`, and drives its `theRunner`.
 */
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { expect, vi } from 'vitest'
import {
  dispatchChannel,
  type ChannelSpec,
  type ExtensionAPI,
  type ShellExecOptions,
  type WorkspaceSnapshot,
} from '@terminator/extension-sdk'

import type { ExecResult, ShellExec } from '../../src/line/integrate.js'
import { partialFake } from '../../../../tests/support/fakes'
import { makeTempDir } from '../../../../tests/support/temp-dir'

/** The runner's surface every Foundry module reaches, as `vi.fn`s a spec can drive. */
export function fakeRunner() {
  return {
    start: vi.fn(async (..._input: unknown[]): Promise<unknown> => null),
    runCommand: vi.fn(async (..._input: unknown[]): Promise<number | null> => 0),
    resolve: vi.fn((..._answer: unknown[]) => true),
    handBackToTerminal: vi.fn(),
    interrupt: vi.fn(),
    stop: vi.fn((..._stop: unknown[]) => true),
    send: vi.fn((..._message: unknown[]) => true),
    terminalFor: vi.fn(
      (..._session: unknown[]): { terminalSessionId: string; projectId: string } | null => null
    ),
    watchable: vi.fn((): unknown[] => []),
    dispose: vi.fn(),
  }
}

/** The control server's surface, never listening. */
export function quietControlServer() {
  return {
    url: 'http://127.0.0.1:1/pretooluse',
    eventUrl: 'http://127.0.0.1:1/event',
    token: 'token',
    register: () => () => undefined,
    close: async () => undefined,
  }
}

/** Real git, with a temporary repository's own identity and none of the outer run's GIT_ variables. */
export const realGit: ShellExec = ({ command, args, cwd }) =>
  new Promise<ExecResult>((resolve) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    execFile(command, args, { cwd, env, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({ exitCode, stdout, stderr, timedOut: false })
    })
  })

/** Real `git` with `args` in `cwd`. */
export function gitAt(cwd: string, ...args: string[]): Promise<ExecResult> {
  return realGit({ command: 'git', args, cwd })
}

/** A repository with one commit on `main`, its own identity, and nothing else. */
export async function seededRepository(parent: string, name = 'app'): Promise<string> {
  const repo = path.join(parent, name)
  fs.mkdirSync(repo, { recursive: true })
  await gitAt(repo, 'init', '-q', '-b', 'main')
  await gitAt(repo, 'config', 'user.name', 'Foundry Test')
  await gitAt(repo, 'config', 'user.email', 'foundry@example.com')
  await gitAt(repo, 'config', 'commit.gpgsign', 'false')
  fs.writeFileSync(path.join(repo, 'README.md'), '# app\n')
  await gitAt(repo, 'add', '-A')
  await gitAt(repo, 'commit', '-q', '-m', 'seed')
  return repo
}

export interface FoundryHost {
  readonly api: ExtensionAPI
  /** Calls a registered channel the way the bridge does, schema first. */
  call(channel: string, payload?: unknown): Promise<unknown>
  /** Settings by key; a missing key reads as unset. */
  readonly settings: Map<string, unknown>
  readonly broadcast: ReturnType<typeof vi.fn>
  /** Every feed Foundry published to Home. */
  readonly homePublish: ReturnType<typeof vi.fn>
  /** The handlers Foundry registered for Home's item actions. */
  readonly homeActionHandlers: Array<(itemId: string, actionId: string) => Promise<void>>
  readonly showToast: ReturnType<typeof vi.fn>
  readonly createNotification: ReturnType<typeof vi.fn>
  /** Palette and menu commands by id, so a spec can run one. */
  readonly commands: Map<string, () => void>
  /** Every `gh` call goes here; git runs for real. */
  readonly gh: ReturnType<typeof vi.fn>
  readonly exec: ReturnType<typeof vi.fn>
  readonly issues: ExtensionAPI['issues']
  readonly workspaces: Array<{ id: string; folderPath: string }>
  /** The channels registered as reachable from the remote browser client. */
  readonly remoteChannels: string[]
  /** `api.paths.globalStorage`, `<userData>/extensions/terminator.foundry`, not created yet. */
  readonly globalStorage: string
}

const noIssues = (): ExtensionAPI['issues'] =>
  partialFake<ExtensionAPI['issues']>({
    connections: vi.fn(async () => []),
    listMine: vi.fn(async () => ({ issues: [], failures: [] })),
    search: vi.fn(async () => ({ issues: [], failures: [] })),
    get: vi.fn(async () => null),
    comment: vi.fn(async () => undefined),
    states: vi.fn(async () => []),
    transition: vi.fn(async () => undefined),
    supportsTransitions: vi.fn(() => false),
    teams: vi.fn(async () => []),
    create: vi.fn(),
    supportsCreate: vi.fn(() => false),
  })

/** A `paths.globalStorage` in a fresh userData, `<userData>/extensions/terminator.foundry`. */
export function freshFoundryStorage(): string {
  return path.join(temporaryDirectory('foundry-user-data'), 'extensions', 'terminator.foundry')
}

/** The parts of a host a spec reads back: every call lands in one of these. */
function hostParts() {
  const gh = vi.fn(
    async (..._options: Parameters<ShellExec>): Promise<ExecResult> => ({
      exitCode: 1,
      stdout: '',
      stderr: 'gh is not available here',
      timedOut: false,
    })
  )
  return {
    settings: new Map<string, unknown>(),
    commands: new Map<string, () => void>(),
    workspaces: [] as Array<{ id: string; folderPath: string }>,
    gh,
    exec: vi.fn((options: Parameters<ShellExec>[0]) =>
      options.command === 'gh' ? gh(options) : realGit(options)
    ),
    broadcast: vi.fn(),
    homePublish: vi.fn(),
    homeActionHandlers: [] as Array<(itemId: string, actionId: string) => Promise<void>>,
    showToast: vi.fn(),
    createNotification: vi.fn(() => ({ dispose: vi.fn() })),
    issues: noIssues(),
    remoteChannels: [] as string[],
  }
}

type HostParts = ReturnType<typeof hostParts>

/** A disposable whose `dispose` is a spy. */
export function disposableStub() {
  return { dispose: vi.fn() }
}

function hostCommands(commands: HostParts['commands']): ExtensionAPI['commands'] {
  return partialFake<ExtensionAPI['commands']>({
    register: vi.fn((contribution: { id: string }, handler: () => void) => {
      commands.set(contribution.id, handler)
      return { dispose: () => commands.delete(contribution.id) }
    }),
  })
}

function hostSettings(dataDir: () => string, settings: HostParts['settings']) {
  return partialFake<ExtensionAPI['settings']>({
    register: vi.fn(disposableStub),
    get: <T>(key: string) =>
      (key === 'terminator.foundry.dataDir' ? dataDir() : settings.get(key)) as T | undefined,
    set: (key: string, value: unknown) => settings.set(key, value),
    isBranchExcluded: async () => false,
  })
}

interface HostApiInput {
  dataDir: () => string
  globalStorage: string
  handlers: Map<string, ChannelSpec>
  parts: HostParts
}

function foundryHostApi({ dataDir, globalStorage, handlers, parts }: HostApiInput): ExtensionAPI {
  const registerHandler = vi.fn((spec: ChannelSpec, options?: { remoteAccessible?: boolean }) => {
    handlers.set(spec.channel, spec)
    if (options?.remoteAccessible === true) parts.remoteChannels.push(spec.channel)
    return disposableStub()
  })
  return partialFake<ExtensionAPI>({
    ipc: partialFake<ExtensionAPI['ipc']>({ registerHandler }),
    window: partialFake<ExtensionAPI['window']>({
      broadcast: parts.broadcast,
      focusSelf: vi.fn(),
      showSelf: vi.fn(),
      openAuxiliary: vi.fn(),
    }),
    commands: hostCommands(parts.commands),
    home: hostHome(parts),
    shell: hostShell(parts.exec),
    notifications: partialFake<ExtensionAPI['notifications']>({
      showToast: parts.showToast,
      createNotification: parts.createNotification,
    }),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: hostSettings(dataDir, parts.settings),
    workspace: hostWorkspace(parts.workspaces),
    issues: parts.issues,
    paths: hostPaths(globalStorage),
  })
}

/** A Home that takes a feed and a handler and does nothing with either. */
export function idleHome(): ExtensionAPI['home'] {
  return partialFake<ExtensionAPI['home']>({ publish: vi.fn(), onAction: vi.fn(disposableStub) })
}

function hostHome(parts: HostParts): ExtensionAPI['home'] {
  return partialFake<ExtensionAPI['home']>({
    publish: parts.homePublish,
    onAction: vi.fn((handler: (itemId: string, actionId: string) => Promise<void>) => {
      parts.homeActionHandlers.push(handler)
      return disposableStub()
    }),
  })
}

// A throw-away storage folder per host, so a spec never writes into the working tree.
function hostPaths(globalStorage: string): ExtensionAPI['paths'] {
  return { app: path.resolve(__dirname, '../..'), globalStorage }
}

function hostShell(exec: HostParts['exec']): ExtensionAPI['shell'] {
  // Foundry never asks for bytes, so the string overload is the only one called.
  const execText = (options: ShellExecOptions) => exec(options)
  return { exec: execText as ExtensionAPI['shell']['exec'] }
}

function hostWorkspace(workspaces: HostParts['workspaces']): ExtensionAPI['workspace'] {
  return partialFake<ExtensionAPI['workspace']>({
    list: () => workspaces as WorkspaceSnapshot[],
    listProjects: () => [],
    addProject: vi.fn(async () => null),
    deleteProject: vi.fn(),
  })
}

/** A host whose records location is `dataDir()` and which has nothing connected. */
export function fakeHost(dataDir: () => string): FoundryHost {
  const globalStorage = freshFoundryStorage()
  const handlers = new Map<string, ChannelSpec>()
  const parts = hostParts()
  return {
    api: foundryHostApi({ dataDir, globalStorage, handlers, parts }),
    call: async (channel, payload = {}) => {
      const spec = handlers.get(channel)
      if (spec === undefined) throw new Error(`${channel} is not registered`)
      return dispatchChannel(spec, payload)
    },
    ...parts,
    globalStorage,
  }
}

/** What a command that exited 0 and printed `stdout` hands back. */
export function execSucceeded(stdout: string): ExecResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false }
}

/** The message of every toast the host has shown, oldest first. */
export function toastsShown(host: FoundryHost): string[] {
  return host.showToast.mock.calls.map((call) => call[1] as string)
}

/** Until the host has shown a toast saying `message`. */
export async function untilToastShown(host: FoundryHost, message: string): Promise<void> {
  await vi.waitFor(() => expect(toastsShown(host)).toContain(message), { timeout: 10_000 })
}

/** A fresh temporary directory under the OS temp directory. */
export function temporaryDirectory(prefix: string): string {
  return makeTempDir(`${prefix}-`)
}
