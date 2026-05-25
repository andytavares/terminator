import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
const mockRemoveHandler = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

const mockCpus = vi.fn()
const mockFreemem = vi.fn().mockReturnValue(2 * 1024 ** 3)
const mockTotalmem = vi.fn().mockReturnValue(8 * 1024 ** 3)
vi.mock('os', () => ({
  default: { cpus: mockCpus, freemem: mockFreemem, totalmem: mockTotalmem },
  cpus: mockCpus,
  freemem: mockFreemem,
  totalmem: mockTotalmem,
}))

const mockExecSync = vi.fn()
const mockReadFileSync = vi.fn()
vi.mock('child_process', () => ({ execSync: mockExecSync }))
vi.mock('fs', () => ({ readFileSync: mockReadFileSync }))

function makeCpus(idle: number, total: number) {
  return [
    {
      model: 'Test CPU',
      speed: 2400,
      times: { user: total - idle, nice: 0, sys: 0, idle, irq: 0 },
    },
  ]
}

describe('registerMetricsHandlers', () => {
  let getPtyManager: () => { getPid: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
    mockExecSync.mockReturnValue('')
    mockHandle.mockImplementation((_ch: string, fn: (...args: unknown[]) => unknown) => fn)
    const mockGetPid = vi.fn()
    getPtyManager = () => ({ getPid: mockGetPid })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers metrics:system, metrics:processes, metrics:pids handlers', async () => {
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    expect(mockHandle).toHaveBeenCalledWith('metrics:system', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('metrics:processes', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('metrics:pids', expect.any(Function))
  })

  it('metrics:system returns cpu/mem/net data', async () => {
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1]
    const result = handler() as { data: Record<string, number> }
    expect(result.data.cpuPercent).toBeGreaterThanOrEqual(0)
    expect(result.data.memUsedBytes).toBeGreaterThan(0)
    expect(result.data.memTotalBytes).toBe(8 * 1024 ** 3)
    expect(result.data.netInBytesPerSec).toBeGreaterThanOrEqual(0)
    expect(result.data.netOutBytesPerSec).toBeGreaterThanOrEqual(0)
  })

  it('metrics:processes returns empty array when no pids given', async () => {
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:processes')![1]
    const result = handler(null, {}) as { data: unknown[] }
    expect(result.data).toEqual([])
  })

  it('metrics:processes parses ps output', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('ps ')) return '1234 12.5 204800\n'
      return ''
    })
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:processes')![1]
    const result = handler(null, { pids: [1234] }) as {
      data: Array<{ pid: number; cpuPercent: number; rssBytes: number }>
    }
    expect(result.data).toHaveLength(1)
    expect(result.data[0].pid).toBe(1234)
    expect(result.data[0].cpuPercent).toBe(12.5)
    expect(result.data[0].rssBytes).toBe(204800 * 1024)
  })

  it('metrics:processes returns empty array when ps fails', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('ps ')) throw new Error('ps failed')
      return ''
    })
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:processes')![1]
    const result = handler(null, { pids: [9999] }) as { data: unknown[] }
    expect(result.data).toEqual([])
  })

  it('metrics:pids maps sessionIds to pids', async () => {
    vi.resetModules()
    const mockGetPid = vi
      .fn()
      .mockImplementation((sid: string) => (sid === 'ses-1' ? 4321 : undefined))
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers({ getPid: mockGetPid } as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:pids')![1]
    const result = handler(null, { sessionIds: ['ses-1', 'ses-2'] }) as {
      data: Array<{ sessionId: string; pid: number }>
    }
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toEqual({ sessionId: 'ses-1', pid: 4321 })
  })

  it('metrics:pids returns empty array when no sessionIds given', async () => {
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:pids')![1]
    const result = handler(null, {}) as { data: unknown[] }
    expect(result.data).toEqual([])
  })

  it('metrics:system reads linux /proc/net/dev when on linux', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    mockReadFileSync.mockReturnValue(
      'Inter-|   Receive\nIface |bytes packets\neth0: 1000 0 0 0 0 0 0 0 0 500\n'
    )
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1]
    expect(() => handler()).not.toThrow()
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('readNetBytes falls back to zero when proc/net/dev read fails on linux', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    mockReadFileSync.mockImplementation(() => {
      throw new Error('read failed')
    })
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1]
    const result = handler() as { data: { netInBytesPerSec: number; netOutBytesPerSec: number } }
    expect(result.data.netInBytesPerSec).toBeGreaterThanOrEqual(0)
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })
})
