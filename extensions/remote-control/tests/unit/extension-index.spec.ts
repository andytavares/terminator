import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { hashPassword, verifyPassword } from '../../src/server/password-hash'

// Hoisted mocks must be declared before module imports
const mockCreateRemoteServer = vi.hoisted(() => vi.fn())
const mockBroadcast = vi.hoisted(() => vi.fn())
const mockSettingsGet = vi.hoisted(() => vi.fn())
const mockSettingsSet = vi.hoisted(() => vi.fn())
const mockIpcRegisterHandler = vi.hoisted(() => vi.fn())
const mockNgrokIsInstalled = vi.hoisted(() => vi.fn(() => false))

vi.mock('../../src/server/remote-server', () => ({
  createRemoteServer: mockCreateRemoteServer,
  PortInUseError: class PortInUseError extends Error {
    constructor(port: number) {
      super(`Port ${port} is already in use.`)
      this.name = 'PortInUseError'
    }
  },
}))

const mockNgrokStart = vi.hoisted(() => vi.fn().mockResolvedValue('https://example.ngrok.app'))
const mockNgrokStop = vi.hoisted(() => vi.fn())
const mockNgrokSetOnCrash = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/ngrok-manager', () => {
  class MockNgrokManager {
    static isInstalled = mockNgrokIsInstalled
    start = mockNgrokStart
    stop = mockNgrokStop
    setOnCrash = mockNgrokSetOnCrash
  }
  return { NgrokManager: MockNgrokManager, generateCaddyfile: vi.fn(() => '') }
})

vi.mock('os', () => ({
  networkInterfaces: vi.fn(() => ({})),
}))

function makeApi() {
  return {
    settings: {
      register: vi.fn(),
      get: mockSettingsGet,
      set: mockSettingsSet,
    },
    ipc: {
      registerHandler: mockIpcRegisterHandler,
      invokeChannel: vi.fn().mockResolvedValue(undefined),
      sendChannel: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(vi.fn()),
      isRemoteAccessible: vi.fn().mockResolvedValue(false),
    },
    window: { broadcast: mockBroadcast },
    paths: { app: '/app', userData: '/user-data' },
    pty: {},
    workspace: { list: vi.fn(() => []), listProjects: vi.fn(() => []) },
  }
}

function registeredSpecs(): ChannelSpec[] {
  return mockIpcRegisterHandler.mock.calls.map(([spec]: [ChannelSpec]) => spec)
}

/** What a renderer's invoke of `channel` reaches: the registered channel, payload parsing included. */
function registeredHandler(channel: string): (payload?: unknown) => Promise<unknown> {
  const spec = registeredSpecs().find((registered) => registered.channel === channel)!
  return (payload) => dispatchChannel(spec, payload)
}

function makeServerHandle(startImpl: () => Promise<void> = () => Promise.resolve()) {
  return {
    start: vi.fn().mockImplementation(startImpl),
    stop: vi.fn().mockResolvedValue(undefined),
    isListening: vi.fn(() => true),
    disconnectAllClients: vi.fn(),
    // The real handle always carries this; the view reads the connected-device
    // list from it, so a mock without it would pass while the feature is dead.
    devices: { onChange: vi.fn(() => () => {}), list: vi.fn(() => []) },
    inject: vi.fn(),
  }
}

async function setupAndGetToggleHandler(
  serverHandle: ReturnType<typeof makeServerHandle>
): Promise<(payload: unknown) => Promise<unknown>> {
  mockCreateRemoteServer.mockResolvedValue(serverHandle)
  mockSettingsGet.mockImplementation((key: string) => {
    if (key === 'terminator.remote-control.enabled') return false
    if (key === 'terminator.remote-control.port') return 7681
    if (key === 'terminator.remote-control.passwordHash') return currentHash
    return null
  })

  // Explicitly import the TypeScript source so vi.mock intercepts its dependencies.
  // Importing without extension would resolve to the compiled index.js bundle (where mocks have no effect).
  const { activate } = await import('../../src/index.ts')
  const api = makeApi()
  activate(api as never)

  const toggleHandler = registeredHandler('remote:toggle')
  return toggleHandler
}

let currentHash = ''

describe('remote-control extension index', extensionIndexTests)

// A settings store that remembers what the extension writes, so credential
// handling can be judged by what ends up stored and returned.
async function activateWithSettings(initial: Record<string, unknown>) {
  const values = new Map<string, unknown>(Object.entries(initial))
  mockSettingsGet.mockImplementation((key: string) => values.get(key))
  mockSettingsSet.mockImplementation((key: string, value: unknown) => void values.set(key, value))
  mockCreateRemoteServer.mockResolvedValue(makeServerHandle())
  const { activate } = await import('../../src/index.ts')
  activate(makeApi() as never)
  // Activation queues the credential migration; hashing takes real time.
  await new Promise((resolve) => setTimeout(resolve, 300))
  const handler = (channel: string) =>
    registeredHandler(channel) as (payload?: unknown) => Promise<Record<string, unknown>>
  return { values, handler }
}

const EXT = 'terminator.remote-control'
const BCRYPT = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234'

describe('remote-control credentials', credentialHandlingTests)

// ADR 096: whether a channel rejects bad input is its schema's job, so this
// checks once, for every channel the extension registers, that one is declared.
describe('every remote-control channel', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('declares a schema that keeps a malformed payload from reaching run', async () => {
    mockCreateRemoteServer.mockResolvedValue(makeServerHandle())
    const { activate } = await import('../../src/index.ts')
    activate(makeApi() as never)

    const specs = registeredSpecs()
    expect(specs.map((spec) => spec.channel)).toContain('remote:toggle')
    for (const spec of specs) {
      expect(spec.schema, `${spec.channel} has no schema`).toBeDefined()
      const run = vi.fn()
      await dispatchChannel({ ...spec, run }, 42)
      expect(run, `${spec.channel} ran a malformed payload`).not.toHaveBeenCalled()
    }
  })
})

function extensionIndexTests() {
  beforeAll(async () => {
    currentHash = await hashPassword('existing-password')
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockNgrokIsInstalled.mockReturnValue(false)
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('startServer failure handling', startServerFailureTests)
  describe('remote:tunnel-reconnect', tunnelReconnectTests)
}

function startServerFailureTests() {
  describe('an unexpected error', startServerUnexpectedErrorTests)
  describe('a port in use', startServerPortInUseTests)
  describe('a successful start', startServerSuccessTests)
}

function startServerUnexpectedErrorTests() {
  it('on non-PortInUseError, sets enabled=false in settings and broadcasts START_FAILED', async () => {
    const serverHandle = makeServerHandle(() => Promise.reject(new Error('unexpected error')))
    const toggleHandler = await setupAndGetToggleHandler(serverHandle)

    await toggleHandler({ enabled: true })
    // Flush the enqueued microtasks
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mockSettingsSet).toHaveBeenCalledWith('terminator.remote-control.enabled', false)
    expect(mockBroadcast).toHaveBeenCalledWith('remote:status', {
      enabled: false,
      error: 'START_FAILED',
    })
  })
}

function startServerPortInUseTests() {
  it('on PortInUseError, does NOT set enabled=false (user intent preserved)', async () => {
    const { PortInUseError } = await import('../../src/server/remote-server')
    const serverHandle = makeServerHandle(() => Promise.reject(new PortInUseError(7681)))
    const toggleHandler = await setupAndGetToggleHandler(serverHandle)

    await toggleHandler({ enabled: true })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const enabledFalseCalls = mockSettingsSet.mock.calls.filter(
      ([key, val]: [string, unknown]) =>
        key === 'terminator.remote-control.enabled' && val === false
    )
    expect(enabledFalseCalls).toHaveLength(0)
  })
}

function startServerSuccessTests() {
  it('on successful start, does not broadcast START_FAILED', async () => {
    const serverHandle = makeServerHandle()
    const toggleHandler = await setupAndGetToggleHandler(serverHandle)

    await toggleHandler({ enabled: true })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mockBroadcast).not.toHaveBeenCalledWith(
      'remote:status',
      expect.objectContaining({ error: 'START_FAILED' })
    )
  })
}

function tunnelReconnectTests() {
  it('re-registers crash handler and updates currentPublicUrl after reconnect', async () => {
    mockNgrokIsInstalled.mockReturnValue(true)
    const toggleHandler = await setupAndGetToggleHandler(makeServerHandle())

    // Start the server so remoteServer is set
    await toggleHandler({ enabled: true })
    await new Promise((resolve) => setTimeout(resolve, 20))

    mockNgrokSetOnCrash.mockClear()

    await registeredHandler('remote:tunnel-reconnect')()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockNgrokSetOnCrash).toHaveBeenCalled()
    expect(mockBroadcast).toHaveBeenCalledWith(
      'remote:status',
      expect.objectContaining({ publicUrl: 'https://example.ngrok.app' })
    )
  })
}

function credentialHandlingTests() {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockNgrokIsInstalled.mockReturnValue(false)
  })

  describe('storing a password', passwordStorageTests)
  describe('reading settings and refusing to start', passwordGateTests)
  describe('migrating a plaintext password', plaintextMigrationTests)
  describe('an unconvertible bcrypt hash', bcryptHashTests)
}

function passwordStorageTests() {
  it('stores a chosen password only as a hash and does not echo it back', async () => {
    const { values, handler } = await activateWithSettings({})
    const result = await handler('remote:update-password')({ password: 'my-chosen-secret' })
    expect(JSON.stringify(result)).not.toContain('my-chosen-secret')
    expect(JSON.stringify([...values.values()])).not.toContain('my-chosen-secret')
    expect(
      await verifyPassword('my-chosen-secret', values.get(`${EXT}.passwordHash`) as string)
    ).toBe(true)
  })

  it('returns a generated password once, storing only its hash', async () => {
    const { values, handler } = await activateWithSettings({})
    const result = await handler('remote:update-password')({ password: '' })
    const generated = result.password as string
    expect(generated.length).toBeGreaterThanOrEqual(16)
    expect(JSON.stringify([...values.values()])).not.toContain(generated)
    expect(await verifyPassword(generated, values.get(`${EXT}.passwordHash`) as string)).toBe(true)
  })
}

function passwordGateTests() {
  it('never returns the password from get-settings, only whether one is set', async () => {
    const { handler } = await activateWithSettings({ [`${EXT}.passwordHash`]: currentHash })
    const settings = await handler('remote:get-settings')()
    expect(settings.hasPassword).toBe(true)
    expect(JSON.stringify(settings)).not.toContain('existing-password')
    expect(settings).not.toHaveProperty('password')
  })

  it('refuses to turn on while no password is set', async () => {
    const { values, handler } = await activateWithSettings({})
    const result = await handler('remote:toggle')({ enabled: true })
    expect(result).toEqual({ error: 'PASSWORD_REQUIRED' })
    expect(values.get(`${EXT}.enabled`)).toBe(false)
    expect(mockCreateRemoteServer).not.toHaveBeenCalled()
  })
}

function plaintextMigrationTests() {
  it('keeps a plaintext password from an earlier version working, as a hash only', async () => {
    const { values } = await activateWithSettings({
      [`${EXT}.password`]: 'earlier-version-password',
      [`${EXT}.passwordHash`]: BCRYPT,
    })
    // Hashing the migrated password can outlast activation's fixed wait on a loaded machine.
    await vi.waitFor(() => expect(values.get(`${EXT}.password`)).toBe(''))
    expect(JSON.stringify([...values.values()])).not.toContain('earlier-version-password')
    expect(
      await verifyPassword('earlier-version-password', values.get(`${EXT}.passwordHash`) as string)
    ).toBe(true)
  })
}

function bcryptHashTests() {
  it('turns Remote Control off and says why when the saved bcrypt hash cannot be kept', async () => {
    const { values } = await activateWithSettings({
      [`${EXT}.enabled`]: true,
      [`${EXT}.passwordHash`]: BCRYPT,
    })
    expect(values.get(`${EXT}.enabled`)).toBe(false)
    expect(mockCreateRemoteServer).not.toHaveBeenCalled()
    expect(mockBroadcast).toHaveBeenCalledWith('remote:status', {
      enabled: false,
      error: 'PASSWORD_REQUIRED',
      message: expect.stringContaining('Set a new password'),
    })
  })
}
