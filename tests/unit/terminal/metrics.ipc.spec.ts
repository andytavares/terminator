import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promisify } from 'util'

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
const mockExecFile = vi.fn()
const mockReadFile = vi.fn()
vi.mock('child_process', () => ({
  execSync: mockExecSync,
  execFile: Object.assign(vi.fn(), { [promisify.custom]: mockExecFile }),
}))
vi.mock('fs/promises', () => ({ readFile: mockReadFile }))

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
    mockExecFile.mockResolvedValue({ stdout: '' })
    mockReadFile.mockResolvedValue('')
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
    const result = (await handler()) as { data: Record<string, number> }
    expect(result.data.cpuPercent).toBeGreaterThanOrEqual(0)
    expect(result.data.memUsedBytes).toBeGreaterThan(0)
    expect(result.data.memTotalBytes).toBe(8 * 1024 ** 3)
    expect(result.data.netInBytesPerSec).toBeGreaterThanOrEqual(0)
    expect(result.data.netOutBytesPerSec).toBeGreaterThanOrEqual(0)
  })

  describe('sampler lifecycle', () => {
    const netstat = (bytesIn: number, bytesOut: number) => ({
      stdout: `Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Drop\nen0 1500 <Link> aa:bb 1 0 ${bytesIn} 1 0 ${bytesOut} 0\n`,
    })
    let originalPlatform: NodeJS.Platform

    beforeEach(() => {
      originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    async function registerAndGetSystemHandler() {
      vi.resetModules()
      const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
      registerMetricsHandlers(getPtyManager() as never)
      return mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1] as () => Promise<{
        data: { netInBytesPerSec: number; netOutBytesPerSec: number }
      }>
    }

    it('does not run netstat while no metrics view has polled', async () => {
      await registerAndGetSystemHandler()

      await vi.advanceTimersByTimeAsync(30_000)

      expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('measures network bytes per second between samples once polled, without execSync', async () => {
      mockExecFile.mockResolvedValueOnce(netstat(1000, 500)).mockResolvedValue(netstat(3000, 1500))
      const system = await registerAndGetSystemHandler()

      await system()
      await vi.advanceTimersByTimeAsync(1000)
      const result = await system()

      expect(mockExecFile).toHaveBeenCalledWith('netstat', ['-ib'], expect.anything())
      expect(mockExecSync).not.toHaveBeenCalled()
      expect(result.data.netInBytesPerSec).toBe(2000)
      expect(result.data.netOutBytesPerSec).toBe(1000)
    })

    it('stops sampling when the polls stop and starts again on the next poll', async () => {
      mockExecFile.mockResolvedValue(netstat(1000, 500))
      const system = await registerAndGetSystemHandler()

      await system()
      await vi.advanceTimersByTimeAsync(6000)
      const callsWhilePolled = mockExecFile.mock.calls.length
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mockExecFile).toHaveBeenCalledTimes(callsWhilePolled)

      await system()
      expect(mockExecFile).toHaveBeenCalledTimes(callsWhilePolled + 1)
    })

    it('does not start a second netstat while the previous one is still running', async () => {
      let finish: (value: ReturnType<typeof netstat>) => void = () => {}
      mockExecFile.mockReturnValue(new Promise((resolve) => (finish = resolve)))
      const system = await registerAndGetSystemHandler()

      await system()
      await vi.advanceTimersByTimeAsync(3000)

      expect(mockExecFile).toHaveBeenCalledTimes(1)
      finish(netstat(1, 1))
    })
  })

  it('metrics:processes returns empty array when no pids given', async () => {
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:processes')![1]
    const result = (await handler(null, {})) as { data: unknown[] }
    expect(result.data).toEqual([])
  })

  it('queryProcessMetrics skips rows with non-numeric fields', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('ps ')) return 'abc def ghi\n1234 5.0 1024\n'
      return ''
    })
    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = queryProcessMetrics([1234])
    expect(result).toEqual([{ pid: 1234, cpuPercent: 5.0, rssBytes: 1024 * 1024 }])
  })

  it('readNetBytes tolerates truncated netstat rows on macOS', async () => {
    // Header + a row with too few columns + a row with non-numeric byte counts
    mockExecFile.mockResolvedValue({
      stdout:
        'Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes\nen0 1500\nen1 1500 link a 1 0 abc 2 0 xyz\n',
    })
    vi.resetModules()
    const { readNetBytes } = await import('../../../src/main/ipc/metrics.ipc.js')
    expect(await readNetBytes()).toEqual({ bytesIn: 0, bytesOut: 0 })
  })

  it('readNetBytes tolerates truncated /proc/net/dev rows on linux', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      mockReadFile.mockResolvedValue('header\nheader\neth0:\nlo: 1 2 3 4 5 6 7 8 9\n')
      vi.resetModules()
      const { readNetBytes } = await import('../../../src/main/ipc/metrics.ipc.js')
      expect(await readNetBytes()).toEqual({ bytesIn: 0, bytesOut: 0 })
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
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
    const result = (await handler(null, { pids: [1234] })) as {
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
    const result = (await handler(null, { pids: [9999] })) as { data: unknown[] }
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
    const result = (await handler(null, { sessionIds: ['ses-1', 'ses-2'] })) as {
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
    const result = (await handler(null, {})) as { data: unknown[] }
    expect(result.data).toEqual([])
  })

  it('metrics:system reads linux /proc/net/dev when on linux', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    mockReadFile.mockResolvedValue(
      'Inter-|   Receive\nIface |bytes packets\neth0: 1000 0 0 0 0 0 0 0 0 500\n'
    )
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1]
    await expect(handler()).resolves.toBeDefined()
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('readNetBytes falls back to zero when proc/net/dev read fails on linux', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    mockReadFile.mockRejectedValue(new Error('read failed'))
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1]
    const result = (await handler()) as {
      data: { netInBytesPerSec: number; netOutBytesPerSec: number }
    }
    expect(result.data.netInBytesPerSec).toBeGreaterThanOrEqual(0)
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })
})

describe('readNetBytes (exported)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
    mockExecSync.mockReturnValue('')
    mockExecFile.mockResolvedValue({ stdout: '' })
  })

  it('parses /proc/net/dev on Linux, sums non-loopback interfaces, skips lo', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    // Two header lines then interface lines
    const procNetDev = [
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '   lo:  100   10    0    0    0     0          0         0      100      10    0    0    0     0       0          0',
      ' eth0: 1000  100    0    0    0     0          0         0      500      50    0    0    0     0       0          0',
      ' eth1: 2000  200    0    0    0     0          0         0     1000     100    0    0    0     0       0          0',
    ].join('\n')
    mockReadFile.mockResolvedValue(procNetDev)

    vi.resetModules()
    const { readNetBytes } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await readNetBytes()

    // eth0: bytesIn=1000, bytesOut=500; eth1: bytesIn=2000, bytesOut=1000 → totals 3000/1500
    // lo is skipped
    expect(result.bytesIn).toBe(3000)
    expect(result.bytesOut).toBe(1500)
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('parses netstat -ib on Darwin, reads correct columns, skips lo0', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    // netstat -ib output: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Drop
    const netstatOutput = [
      'Name       Mtu  Network       Address       Ipkts Ierrs    Ibytes    Opkts Oerrs    Obytes  Drop',
      'lo0      16384  <Link#1>                     1000     0      5000     1000     0      5000     0',
      'en0       1500  <Link#5>  aa:bb:cc:dd:ee:ff  5000     0    200000     4000     0    100000     0',
      'en1       1500  <Link#6>  aa:bb:cc:dd:ee:00  3000     0    120000     2000     0     60000     0',
    ].join('\n')
    mockExecFile.mockResolvedValue({ stdout: netstatOutput })

    vi.resetModules()
    const { readNetBytes } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await readNetBytes()

    // en0: Ibytes=200000 (col 6), Obytes=100000 (col 9); en1: 120000/60000; lo0 skipped
    expect(result.bytesIn).toBe(320000)
    expect(result.bytesOut).toBe(160000)
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('returns { bytesIn: 0, bytesOut: 0 } when read/exec throws', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    mockExecFile.mockRejectedValue(new Error('exec failed'))

    vi.resetModules()
    const { readNetBytes } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await readNetBytes()

    expect(result).toEqual({ bytesIn: 0, bytesOut: 0 })
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })
})

describe('queryProcessMetrics (exported)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
    mockExecSync.mockReturnValue('')
  })

  it('returns [] without calling exec when pids is empty', async () => {
    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = queryProcessMetrics([])
    expect(result).toEqual([])
    expect(mockExecSync).not.toHaveBeenCalled()
  })

  it('parses ps output on Linux and returns { pid, cpuPercent, rssBytes } with rssBytes = rssKb * 1024', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('ps ')) return '1234 25.0 8192\n5678 0.5 4096\n'
      return ''
    })

    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = queryProcessMetrics([1234, 5678])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ pid: 1234, cpuPercent: 25.0, rssBytes: 8192 * 1024 })
    expect(result[1]).toEqual({ pid: 5678, cpuPercent: 0.5, rssBytes: 4096 * 1024 })
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('parses ps output on Darwin and returns the same shape', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('ps ')) return '9999 10.2 16384\n'
      return ''
    })

    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = queryProcessMetrics([9999])

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ pid: 9999, cpuPercent: 10.2, rssBytes: 16384 * 1024 })
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('skips malformed lines that have fewer than 3 parts', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('ps ')) return '1234 15.0 2048\nbadline\n  \n4321 5.0 1024\n'
      return ''
    })

    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = queryProcessMetrics([1234, 4321])

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.pid)).toEqual([1234, 4321])
  })

  it('returns [] when exec throws', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('ps ')) throw new Error('ps not found')
      return ''
    })

    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = queryProcessMetrics([1234])

    expect(result).toEqual([])
  })
})
