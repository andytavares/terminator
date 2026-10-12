/**
 * Every channel Foundry registers, read from the registry `activate` builds
 * rather than from its source.
 */
import { tmpdir } from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const USER_DATA = tmpdir()

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: { isEncryptionAvailable: vi.fn().mockReturnValue(false) },
}))

vi.mock('../src/runtime/supervised-runner.js', () => ({
  createSupervisedRunner: () => ({ watchable: vi.fn().mockReturnValue([]), dispose: vi.fn() }),
}))

vi.mock('../src/runtime/control-server.js', () => ({
  createControlServer: vi.fn().mockResolvedValue({
    url: 'http://127.0.0.1:1/pretooluse',
    eventUrl: 'http://127.0.0.1:1/event',
    token: 'token',
    register: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  }),
}))

const here = path.dirname(fileURLToPath(import.meta.url))
const contract = fs.readFileSync(
  path.join(
    here,
    '..',
    '..',
    '..',
    'specs',
    '037-foundry-software-factory',
    'contracts',
    'ipc-channels.md'
  ),
  'utf8'
)

const disposable = { dispose: vi.fn() }
const specs: ChannelSpec[] = []

beforeAll(async () => {
  const api = {
    ipc: {
      registerHandler: (spec: ChannelSpec) => {
        specs.push(spec)
        return disposable
      },
      onWindowEvent: () => () => {},
    },
    window: { broadcast: vi.fn(), openAuxiliary: vi.fn(), focusSelf: vi.fn(), showSelf: vi.fn() },
    commands: { register: () => disposable, setEnabled: vi.fn() },
    shell: { exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) },
    notifications: { showToast: vi.fn(), createNotification: () => disposable },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    paths: { app: '', userData: USER_DATA },
    settings: {
      register: () => disposable,
      get: vi.fn(),
      set: vi.fn(),
      resolveWorktreeBaseDir: () => path.join(tmpdir(), 'fdry-channel-schemas'),
    },
    terminal: { onSessionCreate: () => disposable, onSessionClose: () => disposable },
    workspace: {
      list: () => [],
      listProjects: () => [],
      onDelete: () => disposable,
      onProjectDelete: () => disposable,
    },
    pty: { listSessions: () => [], attachOnData: () => null, attachOnExit: () => null },
    app: { version: '0.0.0-test' },
  } as unknown as ExtensionAPI

  const { activate } = await import('../src/index.ts')
  const { startSupervisionRuntime } = await import('../src/runtime/supervision-runtime.ts')
  activate(api)
  await startSupervisionRuntime(api)
})

function channels(): string[] {
  return specs.map((spec) => spec.channel)
}

// ADR 096: whether a channel rejects bad input is its schema's job, so this
// checks once, for every channel Foundry registers, that one is declared.
describe('every Foundry channel', () => {
  it('declares a schema that keeps a malformed payload from reaching run', async () => {
    expect(channels()).toContain('foundry:order.create')
    for (const spec of specs) {
      expect(spec.schema, `${spec.channel} has no schema`).toBeDefined()
      const run = vi.fn()
      await dispatchChannel({ ...spec, run }, 42)
      expect(run, `${spec.channel} ran a malformed payload`).not.toHaveBeenCalled()
    }
  })

  // The host refuses a second handler for the same name by throwing inside
  // `activate`, so one duplicated registration stops the whole extension
  // loading while every build and unit test stays green.
  it('is registered exactly once', () => {
    const twice = channels().filter((name, at, all) => all.indexOf(name) !== at)
    expect(twice, `registered more than once: ${twice.join(', ')}`).toEqual([])
    expect(channels().length).toBeGreaterThan(30)
  })

  // Constitution VIII: the contract ships with the code.
  it('is documented in the IPC contract', () => {
    const undocumented = channels().filter((name) => !contract.includes(name))
    expect(undocumented, `not in the IPC contract: ${undocumented.join(', ')}`).toEqual([])
  })

  it('is named under this extension prefix', () => {
    const foreign = channels().filter((name) => !name.startsWith('foundry:'))
    expect(foreign).toEqual([])
  })
})
