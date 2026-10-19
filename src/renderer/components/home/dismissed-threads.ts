import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from '../../home/local-storage'
import { storedDismissedOf } from '../../home/stored-shapes'

/** @internal */
export const DISMISSED_THREADS_KEY = 'terminator.home.dismissed-threads'
const FORGOTTEN_AFTER_MS = 30 * 24 * 60 * 60 * 1000

interface DismissedThreadsState {
  /** Work keys the operator dismissed, each with the time it was dismissed. Nothing brings one back but Undo or starting it again. */
  dismissed: Record<string, number>
  dismiss: (key: string, at: number) => void
  restore: (key: string) => void
  /** Forgets keys dismissed over 30 days ago whose thread is not among `liveKeys` any more. */
  forgetGone: (liveKeys: ReadonlySet<string>, now: number) => void
}

function persistDismissed(dismissed: Record<string, number>): Partial<DismissedThreadsState> {
  writeStoredJson(DISMISSED_THREADS_KEY, dismissed)
  return { dismissed }
}

const storedDismissed = readStoredJson<Record<string, number>>(DISMISSED_THREADS_KEY, {}, (value) =>
  storedDismissedOf(value)
)

export const useDismissedThreads = create<DismissedThreadsState>((set) => ({
  dismissed: storedDismissed,
  dismiss: (key, at) => set((s) => persistDismissed({ ...s.dismissed, [key]: at })),
  restore: (key) =>
    set((s) =>
      persistDismissed(Object.fromEntries(Object.entries(s.dismissed).filter(([k]) => k !== key)))
    ),
  forgetGone: (liveKeys, now) =>
    set((s) => {
      const stillLive = ([key, at]: [string, number]): boolean =>
        liveKeys.has(key) || now - at < FORGOTTEN_AFTER_MS
      const dismissed = Object.fromEntries(Object.entries(s.dismissed).filter(stillLive))
      return Object.keys(dismissed).length === Object.keys(s.dismissed).length
        ? s
        : persistDismissed(dismissed)
    }),
}))

/** True once the operator dismissed the thread; later activity does not bring it back. */
export function isDismissed(dismissed: Readonly<Record<string, number>>, key: string): boolean {
  return dismissed[key] !== undefined
}
