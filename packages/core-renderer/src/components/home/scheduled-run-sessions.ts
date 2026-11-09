import { create } from 'zustand'

/** The session each scheduled run last opened, by schedule id: Home › Scheduled shows whether it
 * is going and opens it, and a repeat that skips overlaps checks it.
 * shortcut: kept in memory, so a reload forgets it; persist it if people miss the View button. */
interface ScheduledRunSessions {
  sessions: Map<string, string>
  record(scheduleId: string, sessionId: string): void
}

export const useScheduledRunSessions = create<ScheduledRunSessions>((set) => ({
  sessions: new Map(),
  record: (scheduleId, sessionId) =>
    set((state) => ({ sessions: new Map(state.sessions).set(scheduleId, sessionId) })),
}))
