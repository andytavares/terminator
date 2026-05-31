import { create } from 'zustand'
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

function startInterval(
  pids: number[],
  pidToSessionId: Map<number, string>,
  getState: () => MetricsState
): void {
  async function poll(): Promise<void> {
    try {
      const sysResult = await window.electronAPI.metrics.getSystem()
      if ('data' in sysResult) getState().setSystem(sysResult.data)
    } catch {
      // IPC failure — keep stale value
    }

    if (pids.length === 0) return
    try {
      const procResult = await window.electronAPI.metrics.getProcesses(pids)
      if ('data' in procResult) {
        for (const pm of procResult.data) {
          const sessionId = pidToSessionId.get(pm.pid)
          if (sessionId) getState().setProcessMetrics(sessionId, pm)
        }
      }
    } catch {
      // IPC failure — keep stale values
    }
  }

  void poll()
  intervalId = setInterval(() => void poll(), 2000)
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

    const pidToSessionId = new Map(sessions.map(({ sessionId, pid }) => [pid, sessionId]))
    const pids = sessions.map((s) => s.pid)
    startInterval(pids, pidToSessionId, get)
  },

  stopPolling: () => {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (get().globalMetricsEnabled) {
      // Keep system metrics running for the global bar — drop per-process data only
      set({ processesBySessionId: new Map(), pollingActive: true })
      startInterval([], new Map(), get)
    } else {
      set({ system: null, processesBySessionId: new Map(), pollingActive: false })
    }
  },

  enableGlobalMetrics: () => {
    set({ globalMetricsEnabled: true, pollingActive: true })
    if (intervalId === null) {
      startInterval([], new Map(), get)
    }
  },

  disableGlobalMetrics: () => {
    set({ globalMetricsEnabled: false })
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
    set({ system: null, processesBySessionId: new Map(), pollingActive: false })
  },
}))
