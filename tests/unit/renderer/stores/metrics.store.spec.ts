import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetSystem = vi.fn()
const mockGetProcesses = vi.fn()
const mockGetPids = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: {
    electronAPI: {
      metrics: {
        getSystem: mockGetSystem,
        getProcesses: mockGetProcesses,
        getPids: mockGetPids,
      },
    },
  },
  writable: true,
})

import { useMetricsStore } from '../../../../src/renderer/stores/metrics.store'

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

describe('useMetricsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    useMetricsStore.getState().stopPolling()
    vi.useRealTimers()
  })

  it('starts with null system metrics and no polling', () => {
    expect(useMetricsStore.getState().system).toBeNull()
    expect(useMetricsStore.getState().pollingActive).toBe(false)
  })

  it('setSystem updates system metrics', () => {
    useMetricsStore.getState().setSystem(sysData)
    expect(useMetricsStore.getState().system).toMatchObject({ cpuPercent: 42 })
  })

  it('setProcessMetrics stores per-session data', () => {
    useMetricsStore
      .getState()
      .setProcessMetrics('sess-1', { pid: 123, cpuPercent: 5, rssBytes: 1024 })
    expect(useMetricsStore.getState().processesBySessionId.get('sess-1')?.cpuPercent).toBe(5)
  })

  it('startPolling fires immediately and sets pollingActive', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [] })

    useMetricsStore.getState().startPolling([])
    expect(useMetricsStore.getState().pollingActive).toBe(true)

    await vi.advanceTimersByTimeAsync(2001)
    await Promise.resolve()

    expect(mockGetSystem).toHaveBeenCalled()
  })

  it('startPolling polls getProcesses with resolved pids', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({
      data: [{ pid: 100, cpuPercent: 12, rssBytes: 4096 }],
    })

    useMetricsStore.getState().startPolling([{ sessionId: 'sess-1', pid: 100 }])
    await vi.advanceTimersByTimeAsync(2001)
    await Promise.resolve()

    expect(mockGetProcesses).toHaveBeenCalledWith([100])
    expect(useMetricsStore.getState().processesBySessionId.get('sess-1')?.cpuPercent).toBe(12)
  })

  it('stopPolling clears all metrics and sets pollingActive false', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [] })

    useMetricsStore.getState().startPolling([])
    await vi.advanceTimersByTimeAsync(2001)
    await Promise.resolve()

    useMetricsStore.getState().setSystem(sysData)
    expect(useMetricsStore.getState().system).not.toBeNull()

    useMetricsStore.getState().stopPolling()
    expect(useMetricsStore.getState().system).toBeNull()
    expect(useMetricsStore.getState().processesBySessionId.size).toBe(0)
    expect(useMetricsStore.getState().pollingActive).toBe(false)
  })

  it('stopPolling keeps polling when globalMetricsEnabled is true', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [] })

    useMetricsStore.setState({ globalMetricsEnabled: true })
    useMetricsStore.getState().startPolling([{ sessionId: 'sess-1', pid: 100 }])
    useMetricsStore.getState().setProcessMetrics('sess-1', { pid: 100, cpuPercent: 5, rssBytes: 0 })

    useMetricsStore.getState().stopPolling()

    // process metrics cleared, polling still active
    expect(useMetricsStore.getState().processesBySessionId.size).toBe(0)
    expect(useMetricsStore.getState().pollingActive).toBe(true)
  })

  it('enableGlobalMetrics starts polling when not already active', async () => {
    mockGetSystem.mockResolvedValue({ data: sysData })
    mockGetProcesses.mockResolvedValue({ data: [] })

    expect(useMetricsStore.getState().pollingActive).toBe(false)
    useMetricsStore.getState().enableGlobalMetrics()

    expect(useMetricsStore.getState().globalMetricsEnabled).toBe(true)
    expect(useMetricsStore.getState().pollingActive).toBe(true)
  })

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
    await Promise.resolve()
    // system stays null — no crash
    expect(useMetricsStore.getState().system).toBeNull()
  })
})
