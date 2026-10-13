import { create, type StoreApi } from 'zustand'
import type { SystemMetrics, ProcessMetrics } from '../../shared/types/index'

interface SessionRef {
  sessionId: string
  pid: number
}

interface MetricsState {
  system: SystemMetrics | null
  processesBySessionId: Map<string, ProcessMetrics>
  pollingActive: boolean
  globalMetricsEnabled: boolean
  setSystem: (m: SystemMetrics) => void
  setProcessMetrics: (sessionId: string, m: ProcessMetrics) => void
  startPolling: (sessions: SessionRef[]) => void
  stopPolling: () => void
  enableGlobalMetrics: () => void
  disableGlobalMetrics: () => void
}

// Held outside Zustand state — interval handles are not serializable
let intervalId: ReturnType<typeof setInterval> | null = null

async function pollSystem(getState: () => MetricsState): Promise<void> {
  try {
    const sysResult = await window.electronAPI.metrics.getSystem()
    if ('data' in sysResult) getState().setSystem(sysResult.data)
  } catch {
    // IPC failure — keep stale value
  }
}

async function pollProcesses(sessions: SessionRef[], getState: () => MetricsState): Promise<void> {
  const pidToSessionId = new Map(sessions.map(({ sessionId, pid }) => [pid, sessionId]))
  try {
    const procResult = await window.electronAPI.metrics.getProcesses(sessions.map((s) => s.pid))
    if (!('data' in procResult)) return
    for (const pm of procResult.data) {
      const sessionId = pidToSessionId.get(pm.pid)
      if (sessionId) getState().setProcessMetrics(sessionId, pm)
    }
  } catch {
    // IPC failure — keep stale values
  }
}

/** Samples now and every two seconds: the system, and the sessions' processes when there are any. */
function startInterval(sessions: SessionRef[], getState: () => MetricsState): void {
  async function poll(): Promise<void> {
    await pollSystem(getState)
    if (sessions.length > 0) await pollProcesses(sessions, getState)
  }

  void poll()
  intervalId = setInterval(() => void poll(), 2000)
}

function clearPoll(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function stopPolling(
  set: StoreApi<MetricsState>['setState'],
  get: StoreApi<MetricsState>['getState']
): void {
  clearPoll()
  if (get().globalMetricsEnabled) {
    // Keep system metrics running for the global bar — drop per-process data only
    set({ processesBySessionId: new Map(), pollingActive: true })
    startInterval([], get)
  } else {
    set({ system: null, processesBySessionId: new Map(), pollingActive: false })
  }
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  system: null,
  processesBySessionId: new Map(),
  pollingActive: false,
  globalMetricsEnabled: false,

  setSystem: (m) => set({ system: m }),

  setProcessMetrics: (sessionId, m) =>
    set((s) => {
      const processesBySessionId = new Map(s.processesBySessionId)
      processesBySessionId.set(sessionId, m)
      return { processesBySessionId }
    }),

  startPolling: (sessions) => {
    if (intervalId !== null) clearInterval(intervalId)
    set({ pollingActive: true })
    startInterval(sessions, get)
  },

  stopPolling: () => stopPolling(set, get),

  enableGlobalMetrics: () => {
    set({ globalMetricsEnabled: true, pollingActive: true })
    if (intervalId === null) {
      startInterval([], get)
    }
  },

  disableGlobalMetrics: () => {
    set({ globalMetricsEnabled: false })
    clearPoll()
    set({ system: null, processesBySessionId: new Map(), pollingActive: false })
  },
}))
