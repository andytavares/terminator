import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetSystem = vi.fn()
const mockGetProcesses = vi.fn()
const mockGetPids = vi.fn()

beforeEach(() => {
  vi.stubGlobal('window', {
    electronAPI: {
      metrics: {
        getSystem: mockGetSystem,
        getProcesses: mockGetProcesses,
        getPids: mockGetPids,
      },
    },
  })
})

import { useMetricsStore } from '../../../../src/renderer/stores/metrics.store'

/** Waits for every call the mock has answered so far, whether it resolved or rejected. The store's
 * own continuation was attached first, so it has run by the time this returns. */
const answered = (mock: { mock: { results: Array<{ value: unknown }> } }) =>
  Promise.allSettled(mock.mock.results.map((call) => call.value))

const sysData = {
  cpuPercent: 42,
  memUsedBytes: 2e9,
  memTotalBytes: 8e9,
  netInBytesPerSec: 1000,
  netOutBytesPerSec: 500,
}

function resetStore(): void {
  useMetricsStore.setState({
    system: null,
    processesBySessionId: new Map(),
    pollingActive: false,
    globalMetricsEnabled: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  resetStore()
})

afterEach(() => {
  // disableGlobalMetrics clears the interval whatever the case left enabled;
  // stopPolling restarts it when global metrics are on.
  useMetricsStore.getState().disableGlobalMetrics()
  vi.useRealTimers()
})

describe('useMetricsStore', () => {
  it('startPolling fires immediately and sets pollingActive', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [] })

    useMetricsStore.getState().startPolling([])
    expect(useMetricsStore.getState().pollingActive).toBe(true)

    // No timer has run yet: the first sample comes from the immediate poll.
    await vi.advanceTimersByTimeAsync(0)

    expect(useMetricsStore.getState().system).toEqual(sysData)
  })
})

describe('useMetricsStore — startPolling polls getProcesses with resolved pids', () => {
  it('startPolling polls getProcesses with resolved pids', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({
      data: [{ pid: 100, cpuPercent: 12, rssBytes: 4096 }],
    })

    useMetricsStore.getState().startPolling([{ sessionId: 'sess-1', pid: 100 }])
    await vi.advanceTimersByTimeAsync(2001)
    await answered(mockGetSystem)
    await answered(mockGetProcesses)

    expect(mockGetProcesses).toHaveBeenCalledWith([100])
    expect(useMetricsStore.getState().processesBySessionId.get('sess-1')?.cpuPercent).toBe(12)
  })

  it('stopPolling clears all metrics and sets pollingActive false', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [{ pid: 100, cpuPercent: 12, rssBytes: 4096 }] })
    useMetricsStore.getState().startPolling([{ sessionId: 'sess-1', pid: 100 }])
    await vi.advanceTimersByTimeAsync(0)
    expect(useMetricsStore.getState().processesBySessionId.size).toBe(1)

    useMetricsStore.getState().stopPolling()

    expect(useMetricsStore.getState()).toMatchObject({ system: null, pollingActive: false })
    expect(useMetricsStore.getState().processesBySessionId.size).toBe(0)
  })
})

describe('useMetricsStore — stopPolling keeps system polling when globalMetricsEnabled', () => {
  it('stopPolling keeps system polling when globalMetricsEnabled and clears per-process metrics', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [{ pid: 100, cpuPercent: 12, rssBytes: 4096 }] })
    useMetricsStore.setState({ globalMetricsEnabled: true })
    useMetricsStore.getState().startPolling([{ sessionId: 'sess-1', pid: 100 }])
    await vi.advanceTimersByTimeAsync(0)
    expect(useMetricsStore.getState().processesBySessionId.size).toBe(1)

    useMetricsStore.getState().stopPolling()

    expect(useMetricsStore.getState()).toMatchObject({ system: sysData, pollingActive: true })
    expect(useMetricsStore.getState().processesBySessionId.size).toBe(0)
  })

  it('enableGlobalMetrics starts polling when not already active', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [] })

    expect(useMetricsStore.getState().pollingActive).toBe(false)
    useMetricsStore.getState().enableGlobalMetrics()

    expect(useMetricsStore.getState().globalMetricsEnabled).toBe(true)
    expect(useMetricsStore.getState().pollingActive).toBe(true)
  })
})

describe('useMetricsStore — disableGlobalMetrics stops polling and clears state', () => {
  it('disableGlobalMetrics stops polling and clears state', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [] })

    useMetricsStore.getState().enableGlobalMetrics()
    useMetricsStore.getState().setSystem(sysData)

    useMetricsStore.getState().disableGlobalMetrics()

    expect(useMetricsStore.getState().globalMetricsEnabled).toBe(false)
    expect(useMetricsStore.getState().system).toBeNull()
    expect(useMetricsStore.getState().pollingActive).toBe(false)
  })

  it('handles getSystem error gracefully', async () => {
    mockGetSystem.mockRejectedValue(new Error('ipc fail'))
    mockGetProcesses.mockResolvedValue({ data: [] })

    expect(() => useMetricsStore.getState().startPolling([])).not.toThrow()
    await vi.advanceTimersByTimeAsync(2001)
    await answered(mockGetSystem)
    // system stays null — no crash
    expect(useMetricsStore.getState().system).toBeNull()
  })
})

describe('useMetricsStore — enableGlobalMetrics called twice', () => {
  it('enableGlobalMetrics called twice still samples once per tick', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [] })
    useMetricsStore.getState().enableGlobalMetrics()
    useMetricsStore.getState().enableGlobalMetrics()
    await vi.advanceTimersByTimeAsync(0)
    mockGetSystem.mockClear()

    await vi.advanceTimersByTimeAsync(2000)

    expect(mockGetSystem).toHaveBeenCalledTimes(1)
  })
})

describe('useMetricsStore — restarting and stray answers', () => {
  it('starting again replaces the running poll rather than adding a second', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [] })
    useMetricsStore.getState().startPolling([{ sessionId: 's1', pid: 1 }])
    useMetricsStore.getState().startPolling([{ sessionId: 's1', pid: 1 }])
    await vi.advanceTimersByTimeAsync(0)
    mockGetSystem.mockClear()
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockGetSystem).toHaveBeenCalledTimes(1)
  })

  it('ignores a failed process read and a pid no session owns', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses
      .mockResolvedValueOnce({ error: 'unavailable' })
      .mockResolvedValue({ data: [{ pid: 99, cpuPercent: 1, memBytes: 1 }] })
    useMetricsStore.getState().startPolling([{ sessionId: 's1', pid: 1 }])
    await vi.advanceTimersByTimeAsync(2000)
    expect(useMetricsStore.getState().processesBySessionId.size).toBe(0)
  })
})

describe('an answer that lands after polling stopped', () => {
  it('is dropped: the sessions it measured are no longer shown', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    let answer: (value: unknown) => void = () => undefined
    mockGetProcesses.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    useMetricsStore.getState().startPolling([{ sessionId: 's1', pid: 101 }])
    await answered(mockGetSystem)

    useMetricsStore.getState().stopPolling()
    answer({ data: [{ pid: 101, cpuPercent: 5, memBytes: 1e6 }] })
    await answered(mockGetProcesses)

    expect(useMetricsStore.getState().processesBySessionId.size).toBe(0)
  })
})
