/**
 * Foundry activated over a host that answers like the application would.
 *
 * Real files under a temporary records location and real `git`; `gh` and the
 * tracker answer from what a spec gives them, because both reach the network.
 * A spec mocks `electron`, the supervised runner and the control server itself
 * (`vi.mock` is per file) and hands over the runner from `fakeRunner`.
 */
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { vi } from 'vitest'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'

import type { ExecResult, ShellExec } from '../../src/line/integrate.js'
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

/** A repository with one commit on `main`, its own identity, and nothing else. */
export async function seededRepository(parent: string, name = 'app'): Promise<string> {
  const repo = path.join(parent, name)
  fs.mkdirSync(repo, { recursive: true })
  const git = (...args: string[]) => realGit({ command: 'git', args, cwd: repo })
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.name', 'Foundry Test')
  await git('config', 'user.email', 'foundry@example.com')
  await git('config', 'commit.gpgsign', 'false')
  fs.writeFileSync(path.join(repo, 'README.md'), '# app\n')
  await git('add', '-A')
  await git('commit', '-q', '-m', 'seed')
  return repo
}

export interface FoundryHost {
  readonly api: ExtensionAPI
  /** Calls a registered channel the way the bridge does, schema first. */
  call(channel: string, payload?: unknown): Promise<unknown>
  /** Settings by key; a missing key reads as unset. */
  readonly settings: Map<string, unknown>
  readonly broadcast: ReturnType<typeof vi.fn>
  readonly showToast: ReturnType<typeof vi.fn>
  readonly createNotification: ReturnType<typeof vi.fn>
  /** Palette and menu commands by id, so a spec can run one. */
  readonly commands: Map<string, () => void>
  /** Every `gh` call goes here; git runs for real. */
  readonly gh: ReturnType<typeof vi.fn>
  readonly exec: ReturnType<typeof vi.fn>
  readonly issues: ExtensionAPI['issues']
  readonly workspaces: Array<{ id: string; folderPath: string }>
  /** `api.paths.globalStorage`, `<userData>/extensions/terminator.foundry`, not created yet. */
  readonly globalStorage: string
}

const noIssues = (): ExtensionAPI['issues'] =>
  ({
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
  }) as unknown as ExtensionAPI['issues']

/** A `paths.globalStorage` in a fresh userData, `<userData>/extensions/terminator.foundry`. */
export function freshGlobalStorage(): string {
  return path.join(temporaryDirectory('foundry-user-data'), 'extensions', 'terminator.foundry')
}

/** A host whose records location is `dataDir()` and which has nothing connected. */
export function fakeHost(dataDir: () => string): FoundryHost {
  const globalStorage = freshGlobalStorage()
  const handlers = new Map<string, ChannelSpec>()
  const settings = new Map<string, unknown>()
  const commands = new Map<string, () => void>()
  const workspaces: Array<{ id: string; folderPath: string }> = []
  const gh = vi.fn(
    async (..._options: Parameters<ShellExec>): Promise<ExecResult> => ({
      exitCode: 1,
      stdout: '',
      stderr: 'gh is not available here',
      timedOut: false,
    })
  )
  const exec = vi.fn((options: Parameters<ShellExec>[0]) =>
    options.command === 'gh' ? gh(options) : realGit(options)
  )
  const broadcast = vi.fn()
  const showToast = vi.fn()
  const createNotification = vi.fn(() => ({ dispose: vi.fn() }))
  const issues = noIssues()
  const disposable = () => ({ dispose: vi.fn() })

  const api = {
    ipc: {
      registerHandler: vi.fn((spec: ChannelSpec) => {
        handlers.set(spec.channel, spec)
        return disposable()
      }),
    },
    window: { broadcast, focusSelf: vi.fn(), showSelf: vi.fn(), openAuxiliary: vi.fn() },
    commands: {
      register: vi.fn((contribution: { id: string }, handler: () => void) => {
        commands.set(contribution.id, handler)
        return { dispose: () => commands.delete(contribution.id) }
      }),
    },
    shell: { exec },
    notifications: { showToast, createNotification },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      register: vi.fn(disposable),
      get: (key: string) => (key === 'terminator.foundry.dataDir' ? dataDir() : settings.get(key)),
      set: (key: string, value: unknown) => settings.set(key, value),
      isBranchExcluded: async () => false,
    },
    workspace: {
      list: () => workspaces,
      listProjects: () => [],
      addProject: vi.fn(async () => null),
      deleteProject: vi.fn(),
    },
    issues,
    // Foundry keeps its runtime state in its own folder: a throw-away one per
    // host, so a spec never writes it into the working tree.
    paths: { app: path.resolve(__dirname, '../..'), globalStorage },
    app: { version: '0.0.0-test' },
  } as unknown as ExtensionAPI

  return {
    api,
    call: async (channel, payload = {}) => {
      const spec = handlers.get(channel)
      if (spec === undefined) throw new Error(`${channel} is not registered`)
      return dispatchChannel(spec, payload)
    },
    settings,
    broadcast,
    showToast,
    createNotification,
    commands,
    gh,
    exec,
    issues,
    workspaces,
    globalStorage,
  }
}

/** A fresh temporary directory under the OS temp directory. */
export function temporaryDirectory(prefix: string): string {
  return makeTempDir(`${prefix}-`)
}

/**
 * Activates Foundry over the host and waits for the supervision runtime, so a
 * spec's first call finds the runner the way a call minutes after start does.
 */
export async function activateFoundry(host: FoundryHost): Promise<void> {
  const { activate } = await import('../../src/index.ts')
  const { runtime } = await import('../../src/runtime/runtime-state.ts')
  activate(host.api)
  await vi.waitFor(() => {
    if (runtime.supervision === null) throw new Error('the supervision runtime is not up yet')
  })
}
