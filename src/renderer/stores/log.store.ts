import { create } from 'zustand'

export type LogLevel = 'log' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  level: LogLevel
  message: string
  timestamp: string
}

interface LogState {
  entries: LogEntry[]
  addEntry: (level: LogLevel, message: string) => void
  clear: () => void
}

let seq = 0

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  addEntry: (level, message) => {
    const entry: LogEntry = {
      id: ++seq,
      level,
      message,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    }
    set((s) => ({ entries: [...s.entries.slice(-999), entry] }))
  },
  clear: () => set({ entries: [] }),
}))

/** Call once at app startup to intercept console methods. */
export function installLogInterceptor(): void {
  const store = useLogStore.getState

  const wrap =
    (level: LogLevel, original: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      original.apply(console, args)
      const message = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)))
        .join(' ')
      store().addEntry(level, message)
    }

  console.log = wrap('log', console.log.bind(console))
  console.info = wrap('info', console.info.bind(console))
  console.warn = wrap('warn', console.warn.bind(console))
  console.error = wrap('error', console.error.bind(console))
}
