import { create } from 'zustand'

interface TerminalOpenErrorState {
  /** Why a branch's terminal failed to open, keyed by project id. */
  errors: Record<string, string>
  /** Bumped by "Try again"; the auto-open effect re-runs when it changes. */
  retries: Record<string, number>
  setError: (projectId: string, message: string) => void
  clearError: (projectId: string) => void
  retry: (projectId: string) => void
}

export const useTerminalOpenErrorStore = create<TerminalOpenErrorState>((set) => ({
  errors: {},
  retries: {},
  setError: (projectId, message) => set((s) => ({ errors: { ...s.errors, [projectId]: message } })),
  clearError: (projectId) =>
    set((s) => {
      if (!(projectId in s.errors)) return s
      const { [projectId]: _cleared, ...errors } = s.errors
      return { errors }
    }),
  retry: (projectId) =>
    set((s) => {
      const { [projectId]: _cleared, ...errors } = s.errors
      return { errors, retries: { ...s.retries, [projectId]: (s.retries[projectId] ?? 0) + 1 } }
    }),
}))
