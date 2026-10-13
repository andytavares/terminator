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

const mockExecFile = vi.fn()
const mockReadFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: Object.assign(vi.fn(), { [promisify.custom]: mockExecFile }),
}))
vi.mock('fs/promises', () => ({ readFile: mockReadFile }))

const realPlatform = process.platform
function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}
afterEach(() => setPlatform(realPlatform))

function makeCpus(idle: number, total: number) {
  return [
    {
      model: 'Test CPU',
      speed: 2400,
      times: { user: total - idle, nice: 0, sys: 0, idle, irq: 0 },
    },
  ]
}

let getPtyManager: () => { getPid: ReturnType<typeof vi.fn> }

function useMetricsMocks(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
    mockExecFile.mockResolvedValue({ stdout: '' })
    mockReadFile.mockResolvedValue('')
    mockHandle.mockImplementation((_ch: string, fn: (...args: unknown[]) => unknown) => fn)
    const mockGetPid = vi.fn()
    getPtyManager = () => ({ getPid: mockGetPid })
  })

  afterEach(() => {
    vi.useRealTimers()
  })
}

const netstat = (bytesIn: number, bytesOut: number) => ({
  stdout: `Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Drop\nen0 1500 <Link> aa:bb 1 0 ${bytesIn} 1 0 ${bytesOut} 0\n`,
})

async function registerAndGetSystemHandler() {
  vi.resetModules()
  const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
  registerMetricsHandlers(getPtyManager() as never)
  return mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1] as () => Promise<{
    data: { netInBytesPerSec: number; netOutBytesPerSec: number }
  }>
}

describe('registerMetricsHandlers', () => {
  useMetricsMocks()

  it('metrics:system returns cpu/mem/net data', async () => {
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1]
    // No interval has been measured yet on the first poll, so every rate is zero.
    expect(await handler()).toEqual({
      data: {
        cpuPercent: 0,
        memUsedBytes: 6 * 1024 ** 3,
        memTotalBytes: 8 * 1024 ** 3,
        netInBytesPerSec: 0,
        netOutBytesPerSec: 0,
      },
    })
  })

  it('metrics:system measures CPU busy time between samples', async () => {
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1]
    await handler()
    // 200 ms more in total, 100 of them idle: half busy.
    mockCpus.mockReturnValue(makeCpus(900, 1200))
    await vi.advanceTimersByTimeAsync(1000)
    expect(await handler()).toMatchObject({ data: { cpuPercent: 50 } })
  })
})

describe('registerMetricsHandlers — sampler lifecycle', () => {
  useMetricsMocks()
  beforeEach(() => setPlatform('darwin'))

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
    expect(result.data.netInBytesPerSec).toBe(2000)
    expect(result.data.netOutBytesPerSec).toBe(1000)
  })
})

describe('registerMetricsHandlers — sampler stops and overlaps', () => {
  useMetricsMocks()
  beforeEach(() => setPlatform('darwin'))

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

describe('registerMetricsHandlers — processes and pids', () => {
  useMetricsMocks()

  it('metrics:processes returns empty array when no pids given', async () => {
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:processes')![1]
    const result = (await handler(null, {})) as { data: unknown[] }
    expect(result.data).toEqual([])
  })

  it('queryProcessMetrics skips rows with non-numeric fields', async () => {
    mockExecFile.mockImplementation(async (cmd: string) => ({
      stdout: cmd === 'ps' ? 'abc def ghi\n1234 5.0 1024\n' : '',
    }))
    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await queryProcessMetrics([1234])
    expect(result).toEqual([{ pid: 1234, cpuPercent: 5.0, rssBytes: 1024 * 1024 }])
  })
})

describe('registerMetricsHandlers — truncated network rows', () => {
  useMetricsMocks()

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
    setPlatform('linux')
    mockReadFile.mockResolvedValue('header\nheader\neth0:\nlo: 1 2 3 4 5 6 7 8 9\n')
    vi.resetModules()
    const { readNetBytes } = await import('../../../src/main/ipc/metrics.ipc.js')
    expect(await readNetBytes()).toEqual({ bytesIn: 0, bytesOut: 0 })
  })
})

describe('registerMetricsHandlers — ps output', () => {
  useMetricsMocks()

  it('metrics:processes parses ps output', async () => {
    mockExecFile.mockImplementation(async (cmd: string) => ({
      stdout: cmd === 'ps' ? '1234 12.5 204800\n' : '',
    }))
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
})

describe('registerMetricsHandlers — ps failures', () => {
  useMetricsMocks()

  it('metrics:processes returns empty array when ps fails', async () => {
    mockExecFile.mockImplementation(async (cmd: string) => {
      if (cmd === 'ps') throw new Error('ps failed')
      return { stdout: '' }
    })
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:processes')![1]
    const result = (await handler(null, { pids: [9999] })) as { data: unknown[] }
    expect(result.data).toEqual([])
  })
})

describe('registerMetricsHandlers — pids', () => {
  useMetricsMocks()

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
})

describe('registerMetricsHandlers — network on linux', () => {
  useMetricsMocks()

  it('metrics:system measures network rates from /proc/net/dev on linux', async () => {
    setPlatform('linux')
    const procNetDev = (bytesIn: number, bytesOut: number) =>
      `Inter-|   Receive\nIface |bytes packets\neth0: ${bytesIn} 0 0 0 0 0 0 0 ${bytesOut}\n`
    mockReadFile
      .mockResolvedValueOnce(procNetDev(1000, 500))
      .mockResolvedValue(procNetDev(4000, 2000))
    vi.resetModules()
    const { registerMetricsHandlers } = await import('../../../src/main/ipc/metrics.ipc.js')
    registerMetricsHandlers(getPtyManager() as never)
    const handler = mockHandle.mock.calls.find(([ch]) => ch === 'metrics:system')![1]
    await handler()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await handler()).toMatchObject({
      data: { netInBytesPerSec: 3000, netOutBytesPerSec: 1500 },
    })
    expect(mockReadFile).toHaveBeenCalledWith('/proc/net/dev', 'utf-8')
  })

  it('readNetBytes falls back to zero when /proc/net/dev cannot be read on linux', async () => {
    setPlatform('linux')
    mockReadFile.mockRejectedValue(new Error('read failed'))
    vi.resetModules()
    const { readNetBytes } = await import('../../../src/main/ipc/metrics.ipc.js')
    expect(await readNetBytes()).toEqual({ bytesIn: 0, bytesOut: 0 })
  })
})

describe('readNetBytes (exported)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
    mockExecFile.mockResolvedValue({ stdout: '' })
  })

  it('parses /proc/net/dev on Linux, sums non-loopback interfaces, skips lo', async () => {
    setPlatform('linux')
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
  })
})

describe('readNetBytes (exported) — darwin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
    mockExecFile.mockResolvedValue({ stdout: '' })
  })

  it('parses netstat -ib on Darwin, reads correct columns, skips lo0', async () => {
    setPlatform('darwin')
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
  })
})

describe('readNetBytes (exported) — failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
    mockExecFile.mockResolvedValue({ stdout: '' })
  })

  it('returns { bytesIn: 0, bytesOut: 0 } when read/exec throws', async () => {
    setPlatform('darwin')
    mockExecFile.mockRejectedValue(new Error('exec failed'))

    vi.resetModules()
    const { readNetBytes } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await readNetBytes()

    expect(result).toEqual({ bytesIn: 0, bytesOut: 0 })
  })
})

describe('queryProcessMetrics (exported)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
  })

  it('returns [] without calling exec when pids is empty', async () => {
    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await queryProcessMetrics([])
    expect(result).toEqual([])
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('parses ps output on Linux and returns { pid, cpuPercent, rssBytes } with rssBytes = rssKb * 1024', async () => {
    setPlatform('linux')
    mockExecFile.mockImplementation(async (cmd: string) => ({
      stdout: cmd === 'ps' ? '1234 25.0 8192\n5678 0.5 4096\n' : '',
    }))

    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await queryProcessMetrics([1234, 5678])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ pid: 1234, cpuPercent: 25.0, rssBytes: 8192 * 1024 })
    expect(result[1]).toEqual({ pid: 5678, cpuPercent: 0.5, rssBytes: 4096 * 1024 })
    expect(mockExecFile).toHaveBeenCalledWith(
      'ps',
      ['-p', '1234,5678', '-o', 'pid,%cpu,rss', '--no-headers'],
      expect.anything()
    )
  })
})

describe('queryProcessMetrics (exported) — darwin and malformed output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
  })

  it('parses ps output on Darwin and returns the same shape', async () => {
    setPlatform('darwin')
    mockExecFile.mockImplementation(async (cmd: string) => ({
      stdout: cmd === 'ps' ? '9999 10.2 16384\n' : '',
    }))

    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await queryProcessMetrics([9999])

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ pid: 9999, cpuPercent: 10.2, rssBytes: 16384 * 1024 })
    expect(mockExecFile).toHaveBeenCalledWith(
      'ps',
      ['-p', '9999', '-o', 'pid=,%cpu=,rss='],
      expect.anything()
    )
  })
})

describe('queryProcessMetrics (exported) — malformed output and failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCpus.mockReturnValue(makeCpus(800, 1000))
  })

  it('skips malformed lines that have fewer than 3 parts', async () => {
    mockExecFile.mockImplementation(async (cmd: string) => ({
      stdout: cmd === 'ps' ? '1234 15.0 2048\nbadline\n  \n4321 5.0 1024\n' : '',
    }))

    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await queryProcessMetrics([1234, 4321])

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.pid)).toEqual([1234, 4321])
  })

  it('returns [] when exec throws', async () => {
    mockExecFile.mockImplementation(async (cmd: string) => {
      if (cmd === 'ps') throw new Error('ps not found')
      return { stdout: '' }
    })

    vi.resetModules()
    const { queryProcessMetrics } = await import('../../../src/main/ipc/metrics.ipc.js')
    const result = await queryProcessMetrics([1234])

    expect(result).toEqual([])
  })
})
