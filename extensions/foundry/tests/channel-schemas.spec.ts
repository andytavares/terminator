/**
 * Every channel Foundry registers, read from the registry `activate` builds
 * rather than from its source.
 */
import { freshFoundryStorage, idleHome } from './helpers/foundry-host.js'
import { partialFake } from '../../../tests/support/fakes'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const GLOBAL_STORAGE = freshFoundryStorage()

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { activate } from '../src/index.ts'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'

vi.mock('../src/runtime/supervised-runner.js', () => import('./helpers/supervision-mocks.js'))
vi.mock('../src/runtime/control-server.js', () => import('./helpers/supervision-mocks.js'))

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

/** Records every channel `activate` registers; everything else answers with nothing. */
function registeringApi(): ExtensionAPI {
  return partialFake<ExtensionAPI>({
    ipc: partialFake<ExtensionAPI['ipc']>({
      registerHandler: (spec: ChannelSpec) => {
        specs.push(spec)
        return disposable
      },
      onWindowEvent: () => () => {},
    }),
    window: partialFake<ExtensionAPI['window']>({
      broadcast: vi.fn(),
      openAuxiliary: vi.fn(),
      focusSelf: vi.fn(),
      showSelf: vi.fn(),
    }),
    commands: partialFake<ExtensionAPI['commands']>({ register: () => disposable }),
    home: idleHome(),
    shell: partialFake<ExtensionAPI['shell']>({
      exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    }),
    notifications: partialFake<ExtensionAPI['notifications']>({
      showToast: vi.fn(),
      createNotification: () => disposable,
    }),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    paths: { app: '', globalStorage: GLOBAL_STORAGE },
    ...quietHost(),
  })
}

/** The settings and workspaces of a host where nothing has been set up. */
function quietHost(): Partial<ExtensionAPI> {
  return {
    settings: partialFake<ExtensionAPI['settings']>({
      register: () => disposable,
      get: vi.fn(),
      set: vi.fn(),
    }),
    workspace: partialFake<ExtensionAPI['workspace']>({
      list: () => [],
      listProjects: () => [],
    }),
  }
}

beforeAll(async () => {
  const api = registeringApi()
  const { startSupervisionRuntime } = await import('../src/runtime/supervision-runtime.ts')
  activate(api)
  await startSupervisionRuntime(api)
})

function registeredChannels(): string[] {
  return specs.map((spec) => spec.channel)
}

// ADR 096: whether a channel rejects bad input is its schema's job, so this
// checks once, for every channel Foundry registers, that one is declared.
describe('every Foundry channel', () => {
  it('declares a schema that keeps a malformed payload from reaching run', async () => {
    expect(registeredChannels()).toContain('foundry:order.create')
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
    const twice = registeredChannels().filter((name, at, all) => all.indexOf(name) !== at)
    expect(twice, `registered more than once: ${twice.join(', ')}`).toEqual([])
    expect(registeredChannels().length).toBeGreaterThan(30)
  })

  // Constitution VIII: the contract ships with the code.
  it('is documented in the IPC contract', () => {
    const undocumented = registeredChannels().filter((name) => !contract.includes(name))
    expect(undocumented, `not in the IPC contract: ${undocumented.join(', ')}`).toEqual([])
  })

  it('is named under this extension prefix', () => {
    const foreign = registeredChannels().filter((name) => !name.startsWith('foundry:'))
    expect(foreign).toEqual([])
  })
})

describe('every Foundry channel the source declares', () => {
  // A channel declared in the source and missing from the registry is dead wiring: the surface
  // calling it fails at the moment the operator presses the button.
  it('is in the registry for every channel the source declares', () => {
    const missing = declaredChannels().filter((name) => !registeredChannels().includes(name))
    expect(declaredChannels().length).toBeGreaterThan(30)
    expect(missing, `declared but never registered: ${missing.join(', ')}`).toEqual([])
  })

  // An empty payload is what a surface sends when it has nothing to say. A channel that needs
  // arguments answers its invalid response; none of them may reject the invoke.
  it('answers an empty payload rather than rejecting', async () => {
    const rejected: string[] = []
    for (const spec of specs) {
      await dispatchChannel(spec, {}).catch(() => rejected.push(spec.channel))
    }
    expect(rejected, `rejected an empty payload: ${rejected.join(', ')}`).toEqual([])
  })
})

/** Every `foundry:` channel name the IPC sources declare, read from the text. */
function declaredChannels(): string[] {
  const src = path.join(here, '..', 'src')
  const files = [
    path.join(src, 'index.ts'),
    ...fs.readdirSync(path.join(src, 'ipc')).map((file) => path.join(src, 'ipc', file)),
  ]
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  const declared = /(?:(?:foundry|session)Channel\(\s*|channel: )'(foundry:[^']+)'/g
  return [...new Set([...source.matchAll(declared)].map((match) => match[1]))]
}
