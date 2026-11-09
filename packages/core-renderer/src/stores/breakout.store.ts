import { create } from 'zustand'

/** The terminals living in their own window, by session id, each with its window.open child. */
interface BreakoutWindows {
  windows: Map<string, Window>
  add(sessionId: string, win: Window): void
  remove(sessionId: string): void
}

export const useBreakoutStore = create<BreakoutWindows>((set) => ({
  windows: new Map(),
  add: (sessionId, win) => set((s) => ({ windows: new Map(s.windows).set(sessionId, win) })),
  remove: (sessionId) =>
    set((s) => {
      const windows = new Map(s.windows)
      windows.delete(sessionId)
      return { windows }
    }),
}))

/** Whether this terminal is in its own window. */
export function isBrokenOut(sessionId: string): boolean {
  return useBreakoutStore.getState().windows.has(sessionId)
}
