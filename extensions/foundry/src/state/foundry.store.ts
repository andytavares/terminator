import { createStore } from 'zustand/vanilla'
import type { Run, Harness, HarnessHealthEvent, Provider } from '../types/foundry.types.js'

interface FoundryState {
  runs: Map<string, Run>
  activeRunId: string | null
  harness: Harness | null
  healthEvents: HarnessHealthEvent[]
  providers: Provider[]

  addRun(run: Run): void
  updateRun(runId: string, partial: Partial<Run>): void
  removeRun(runId: string): void
  setActiveRunId(runId: string | null): void
  setHarness(harness: Harness): void
  setProviders(providers: Provider[]): void
  addHealthEvent(event: HarnessHealthEvent): void
  resolveHealthEvent(kind: HarnessHealthEvent['kind'], sensorName?: string): void
}

export function createFoundryStore() {
  return createStore<FoundryState>()((set) => ({
    runs: new Map(),
    activeRunId: null,
    harness: null,
    healthEvents: [],
    providers: [],

    addRun(run) {
      set((s) => {
        const next = new Map(s.runs)
        next.set(run.id, run)
        return { runs: next }
      })
    },

    updateRun(runId, partial) {
      set((s) => {
        const existing = s.runs.get(runId)
        if (!existing) return {}
        const next = new Map(s.runs)
        next.set(runId, { ...existing, ...partial })
        return { runs: next }
      })
    },

    removeRun(runId) {
      set((s) => {
        const next = new Map(s.runs)
        next.delete(runId)
        return { runs: next }
      })
    },

    setActiveRunId(runId) {
      set({ activeRunId: runId })
    },

    setHarness(harness) {
      set({ harness })
    },

    setProviders(providers) {
      set({ providers })
    },

    addHealthEvent(event) {
      set((s) => ({ healthEvents: [...s.healthEvents, event] }))
    },

    resolveHealthEvent(kind, sensorName) {
      set((s) => ({
        healthEvents: s.healthEvents.filter(
          (e) => !(e.kind === kind && e.sensorName === sensorName)
        ),
      }))
    },
  }))
}

export const foundryStore = createFoundryStore()
export type FoundryStore = ReturnType<typeof createFoundryStore>
