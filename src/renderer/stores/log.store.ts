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
