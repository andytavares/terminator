import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from '../../home/local-storage'
import { storedDismissedOf } from '../../home/stored-shapes'
import type { WorkThread } from '../../home/work-threads'

/** @internal */
export const DISMISSED_THREADS_KEY = 'terminator.home.dismissed-threads'
/** The dismissed keys whose rows showed Terminator sessions; only their ended sessions are deleted. */
const DELETES_SESSIONS_KEY = 'terminator.home.dismissed-sessions'
const FORGOTTEN_AFTER_MS = 30 * 24 * 60 * 60 * 1000

interface DismissedThreadsState {
  /** Work keys the operator dismissed, each with the time it was dismissed. Nothing brings one back but Undo or starting it again. */
  dismissed: Record<string, number>
  /** Of those, the ones whose row showed sessions when dismissed, by the same time: their ended
   * sessions are deleted (ADR 146). A pull request row or an older dismissal deletes nothing. */
  deletesSessions: Record<string, number>
  dismiss: (key: string, at: number, deletesSessions: boolean) => void
  restore: (key: string) => void
  /** Forgets keys dismissed over 30 days ago whose thread is not among `liveKeys` any more. */
  forgetGone: (liveKeys: ReadonlySet<string>, now: number) => void
}

function persistDismissed(dismissed: Record<string, number>): Partial<DismissedThreadsState> {
  writeStoredJson(DISMISSED_THREADS_KEY, dismissed)
  return { dismissed }
}

function persistDeletes(deletesSessions: Record<string, number>): Partial<DismissedThreadsState> {
  writeStoredJson(DELETES_SESSIONS_KEY, deletesSessions)
  return { deletesSessions }
}

const without = (record: Record<string, number>, key: string): Record<string, number> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))

const storedDismissed = readStoredJson<Record<string, number>>(DISMISSED_THREADS_KEY, {}, (value) =>
  storedDismissedOf(value)
)

const storedDeletes = readStoredJson<Record<string, number>>(DELETES_SESSIONS_KEY, {}, (value) =>
  storedDismissedOf(value)
)

export const useDismissedThreads = create<DismissedThreadsState>((set) => ({
  dismissed: storedDismissed,
  deletesSessions: storedDeletes,
  dismiss: (key, at, deletesSessions) =>
    set((s) => ({
      ...persistDismissed({ ...s.dismissed, [key]: at }),
      ...(deletesSessions ? persistDeletes({ ...s.deletesSessions, [key]: at }) : {}),
    })),
  restore: (key) =>
    set((s) => ({
      ...persistDismissed(without(s.dismissed, key)),
      ...persistDeletes(without(s.deletesSessions, key)),
    })),
  forgetGone: (liveKeys, now) =>
    set((s) => {
      const stillLive = ([key, at]: [string, number]): boolean =>
        liveKeys.has(key) || now - at < FORGOTTEN_AFTER_MS
      const dismissed = Object.fromEntries(Object.entries(s.dismissed).filter(stillLive))
      if (Object.keys(dismissed).length === Object.keys(s.dismissed).length) return s
      const deletes = Object.fromEntries(
        Object.entries(s.deletesSessions).filter(([key]) => key in dismissed)
      )
      return { ...persistDismissed(dismissed), ...persistDeletes(deletes) }
    }),
}))

/** True once the operator dismissed the thread; later activity does not bring it back. */
export function isDismissed(dismissed: Readonly<Record<string, number>>, key: string): boolean {
  return dismissed[key] !== undefined
}

/** The ended sessions of rows dismissed while they showed sessions, whose records are deleted for
 * good (ADR 146). */
export function endedSessionsOfDismissed(
  threads: readonly WorkThread[],
  dismissed: Readonly<Record<string, number>>,
  deletesSessions: Readonly<Record<string, number>>
): string[] {
  return threads
    .filter((thread) => isDismissed(dismissed, thread.key) && thread.key in deletesSessions)
    .flatMap((thread) => thread.sessions.filter((s) => s.isClosed).map((s) => s.sessionId))
}
