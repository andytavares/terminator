import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockSpawn = vi.fn()
const mockExecSync = vi.fn()
const mockFetch = vi.fn()
const mockNetworkInterfaces = vi.fn()

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
}))

vi.mock('os', () => ({
  networkInterfaces: mockNetworkInterfaces,
}))

global.fetch = mockFetch as never

let generateCaddyfile: typeof import('../../src/server/ngrok-manager').generateCaddyfile

describe('generateCaddyfile', caddyfileTests)

/** The ngrok agent API answering with one tunnel at `publicUrl`. */
function mockTunnelUrl(publicUrl: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        tunnels: [{ public_url: publicUrl, config: { addr: 'http://localhost:7681' } }],
      }),
  })
}

async function startManagerTunnel(): Promise<void> {
  const startPromise = manager.start(7681)
  await vi.runAllTimersAsync()
  await startPromise
}

function processExitHandler() {
  return mockProcess.on.mock.calls.find(([event]) => event === 'exit')?.[1]
}

/** Run timers past the agent API poll limit (MAX_POLLS=60). */
async function runPastAllPolls(): Promise<void> {
  for (let i = 0; i < 65; i++) {
    await vi.runAllTimersAsync()
  }
}

let NgrokManager: typeof import('../../src/server/ngrok-manager').NgrokManager
let manager: InstanceType<typeof import('../../src/server/ngrok-manager').NgrokManager>

const mockProcess = {
  pid: 1234,
  kill: vi.fn(),
  on: vi.fn(),
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
}

describe('NgrokManager', ngrokManagerTests)

function caddyfileTests() {
  beforeEach(async () => {
    vi.resetModules()
    mockNetworkInterfaces.mockReset()
    const mod = await import('../../src/server/ngrok-manager')
    generateCaddyfile = mod.generateCaddyfile
  })

  describe('a LAN address', caddyfileLanAddressTests)
  describe('falling back to localhost', caddyfileLocalhostTests)
  describe('IPv6 interfaces', caddyfileIpv6Tests)
}

function caddyfileLanAddressTests() {
  it('uses local IPv4 address when a non-internal interface is found', () => {
    mockNetworkInterfaces.mockReturnValue({
      eth0: [{ family: 'IPv4', address: '192.168.1.100', internal: false }],
    })
    const result = generateCaddyfile(7681)
    expect(result).toContain('192.168.1.100')
    expect(result).toContain('reverse_proxy localhost:7681')
    expect(result).toContain('tls internal')
  })
}

function caddyfileLocalhostTests() {
  it('falls back to localhost when only internal addresses exist', () => {
    mockNetworkInterfaces.mockReturnValue({
      lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    })
    const result = generateCaddyfile(8080)
    expect(result).toMatch(/^localhost \{/)
    expect(result).toContain('reverse_proxy localhost:8080')
  })

  it('falls back to localhost when networkInterfaces returns empty object', () => {
    mockNetworkInterfaces.mockReturnValue({})
    const result = generateCaddyfile(7681)
    expect(result).toMatch(/^localhost \{/)
  })
}

function caddyfileIpv6Tests() {
  it('skips IPv6 addresses and uses first IPv4 non-internal', () => {
    mockNetworkInterfaces.mockReturnValue({
      eth0: [
        { family: 'IPv6', address: 'fe80::1', internal: false },
        { family: 'IPv4', address: '10.0.0.5', internal: false },
      ],
    })
    const result = generateCaddyfile(9000)
    expect(result).toContain('10.0.0.5')
    expect(result).not.toContain('fe80')
  })
}

function ngrokManagerTests() {
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    mockSpawn.mockReturnValue(mockProcess)
    mockProcess.kill.mockReset()
    mockProcess.on.mockReset()
    mockProcess.stdout.on.mockReset()
    mockProcess.stderr.on.mockReset()
    const mod = await import('../../src/server/ngrok-manager')
    NgrokManager = mod.NgrokManager
    manager = new NgrokManager()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('isInstalled', ngrokIsInstalledTests)
  describe('start', ngrokStartTests)
  describe('stop', ngrokStopTests)
  describe('onCrash callback', ngrokCrashTests)
}

function ngrokIsInstalledTests() {
  it('returns true when which ngrok exits 0', () => {
    mockExecSync.mockReturnValueOnce('')
    expect(NgrokManager.isInstalled()).toBe(true)
  })

  it('returns false when which ngrok throws', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('not found')
    })
    expect(NgrokManager.isInstalled()).toBe(false)
  })

  it("looks in the person's own PATH before the usual install folders", async () => {
    const own = process.env.PATH
    process.env.PATH = '/home/me/bin'
    vi.resetModules()
    const { NgrokManager: Fresh } = await import('../../src/server/ngrok-manager')
    process.env.PATH = own
    mockExecSync.mockReturnValueOnce('')
    Fresh.isInstalled()
    const { env } = mockExecSync.mock.calls.at(-1)![1] as { env: NodeJS.ProcessEnv }
    expect(env.PATH!.split(':')[0]).toBe('/home/me/bin')
    expect(env.PATH).toContain('/opt/homebrew/bin')
  })
}

function ngrokStartTests() {
  describe('resolving the public URL', ngrokStartResolveTests)
  describe('giving up after polling', ngrokStartGiveUpTests)
  describe('reporting ngrok output', ngrokStartOutputTests)
  describe('an auth token', ngrokStartAuthTokenTests)
}

function ngrokStartResolveTests() {
  it('spawns ngrok http <port> and resolves URL from agent API', async () => {
    mockTunnelUrl('https://abc.ngrok.io')

    const urlPromise = manager.start(7681)
    await vi.runAllTimersAsync()
    const url = await urlPromise

    expect(mockSpawn).toHaveBeenCalledWith('ngrok', ['http', '7681'], expect.anything())
    expect(url).toBe('https://abc.ngrok.io')
  })
}

function ngrokStartGiveUpTests() {
  it('rejects after all polls exhausted (MAX_POLLS=60) and stops process', async () => {
    mockFetch.mockResolvedValue({ ok: false })

    const urlPromise = manager.start(7681)
    urlPromise.catch(() => {})
    await runPastAllPolls()
    await expect(urlPromise).rejects.toThrow('ngrok tunnel URL not available after polling')
    // stop() should have been called inside pollForUrl after exhausting polls
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
  })
}

function ngrokStartOutputTests() {
  it('includes stdout/stderr output in rejection message', async () => {
    let stdoutHandler: ((chunk: Buffer) => void) | undefined
    let stderrHandler: ((chunk: Buffer) => void) | undefined
    mockProcess.stdout.on.mockImplementation((event: string, fn: (chunk: Buffer) => void) => {
      if (event === 'data') stdoutHandler = fn
    })
    mockProcess.stderr.on.mockImplementation((event: string, fn: (chunk: Buffer) => void) => {
      if (event === 'data') stderrHandler = fn
    })

    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const urlPromise = manager.start(7681)
    urlPromise.catch(() => {})

    // Trigger output before polls exhaust
    stdoutHandler?.(Buffer.from('ERR_NGROK_105'))
    stderrHandler?.(Buffer.from('authentication failed'))

    await runPastAllPolls()
    await expect(urlPromise).rejects.toThrow(/authentication failed|ERR_NGROK/)
  })
}

function ngrokStartAuthTokenTests() {
  it('passes --authtoken flag when auth token provided', async () => {
    mockTunnelUrl('https://auth.ngrok.io')

    const urlPromise = manager.start(7681, 'my-token')
    await vi.runAllTimersAsync()
    await urlPromise

    expect(mockSpawn).toHaveBeenCalledWith(
      'ngrok',
      ['http', '7681', '--authtoken', 'my-token'],
      expect.anything()
    )
  })
}

function ngrokStopTests() {
  it('sends SIGTERM to the child process', async () => {
    mockTunnelUrl('https://xyz.ngrok.io')
    await startManagerTunnel()
    manager.stop()
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
  })
}

function ngrokCrashTests() {
  describe('an unexpected exit', ngrokCrashExitTests)
  describe('an intentional stop', ngrokCrashStopTests)
  describe('an exit on its own', ngrokCrashSelfExitTests)
  describe('stopping while polling', ngrokCrashPollingStopTests)
}

function ngrokCrashExitTests() {
  it('fires when ngrok process exits unexpectedly', async () => {
    const onCrash = vi.fn()
    manager.setOnCrash(onCrash)

    mockTunnelUrl('https://crash.ngrok.io')

    await startManagerTunnel()

    const exitHandler = processExitHandler()
    expect(exitHandler).toBeDefined()
    exitHandler?.(1, null)
    expect(onCrash).toHaveBeenCalled()
  })
}

function ngrokCrashStopTests() {
  it('does NOT fire when stop() is called intentionally', async () => {
    const onCrash = vi.fn()
    manager.setOnCrash(onCrash)

    mockTunnelUrl('https://stop.ngrok.io')

    await startManagerTunnel()

    // Intentional stop — should clear the crash callback before killing
    manager.stop()

    const exitHandler = processExitHandler()
    exitHandler?.(130, null) // SIGTERM typically exits with 130
    expect(onCrash).not.toHaveBeenCalled()
  })
}

function ngrokCrashSelfExitTests() {
  it('clears process reference on exit so stop() does not double-kill', async () => {
    mockTunnelUrl('https://ref.ngrok.io')

    await startManagerTunnel()

    const exitHandler = processExitHandler()
    exitHandler?.(1, null) // process exits on its own

    // stop() should be a no-op now — process reference was cleared by the exit handler
    manager.stop()
    expect(mockProcess.kill).not.toHaveBeenCalled()
  })
}

function ngrokCrashPollingStopTests() {
  it('stop() during polling causes start() to reject immediately without waiting for all polls', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const urlPromise = manager.start(7681)
    urlPromise.catch(() => {})

    // Complete first poll iteration (500ms wait + fetch rejection)
    await vi.advanceTimersByTimeAsync(500)
    // Now waiting on second-iteration 500ms timer — call stop so stopped=true
    manager.stop()
    // Fire the second-iteration timer; post-check sees stopped=true and throws immediately
    await vi.advanceTimersByTimeAsync(500)

    await expect(urlPromise).rejects.toThrow('ngrok stopped')
  })
}
