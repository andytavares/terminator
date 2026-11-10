import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from './local-storage'
import { storedDismissedOf } from './stored-shapes'
import type { WorkMarks } from './settle'

/** @internal */
export const INBOX_SETTLED_KEY = 'terminator.sidebar.inbox-settled'
/** @internal */
export const INBOX_PINNED_KEY = 'terminator.sidebar.inbox-pinned'
/** @internal */
export const INBOX_SNOOZED_KEY = 'terminator.sidebar.inbox-snoozed'
/** Home's old hand dismissals; read once into `settled`, then removed. */
const DISMISSED_THREADS_KEY = 'terminator.home.dismissed-threads'
const DISMISSED_SESSIONS_KEY = 'terminator.home.dismissed-sessions'
const FORGOTTEN_AFTER_MS = 30 * 24 * 60 * 60 * 1000

type MarkKind = keyof WorkMarks
type Marks = Record<string, number>

const STORAGE_KEYS: Record<MarkKind, string> = {
  settled: INBOX_SETTLED_KEY,
  pinned: INBOX_PINNED_KEY,
  snoozed: INBOX_SNOOZED_KEY,
}

interface WorkMarksState {
  settled: Marks
  pinned: Marks
  snoozed: Marks
  settle: (key: string, at: number) => void
  togglePin: (key: string, at: number) => void
  snooze: (key: string, until: number) => void
  /** Brings a settled or snoozed thread back, as Undo and Restore do. */
  restore: (key: string) => void
  /** Brings settled or snoozed threads back to the top. */
  wake: (keys: readonly string[]) => void
  /** Forgets marks over 30 days old whose thread is not among `liveKeys` any more. */
  forgetGone: (liveKeys: ReadonlySet<string>, now: number) => void
}

const readMarks = (kind: MarkKind): Marks =>
  readStoredJson<Marks>(STORAGE_KEYS[kind], {}, (value) => storedDismissedOf(value))

/** Settled marks, with each old Home dismissal copied in at its time; the old keys are removed. */
function readSettledMigrating(): Marks {
  const old = readStoredJson<Marks>(DISMISSED_THREADS_KEY, {}, (value) => storedDismissedOf(value))
  const settled = { ...old, ...readMarks('settled') }
  if (Object.keys(old).length > 0) writeStoredJson(STORAGE_KEYS.settled, settled)
  removeStored(DISMISSED_THREADS_KEY)
  removeStored(DISMISSED_SESSIONS_KEY)
  return settled
}

function removeStored(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage absent or blocked: there is nothing to remove.
  }
}

const without = (marks: Marks, keys: readonly string[]): Marks =>
  Object.fromEntries(Object.entries(marks).filter(([key]) => !keys.includes(key)))

/** The changed kinds, written to storage as they are set. */
function persisted(changes: Partial<Record<MarkKind, Marks>>): Partial<WorkMarksState> {
  for (const [kind, marks] of Object.entries(changes)) {
    writeStoredJson(STORAGE_KEYS[kind as MarkKind], marks)
  }
  return changes
}

function forgotten(state: WorkMarksState, liveKeys: ReadonlySet<string>, now: number) {
  const kept = (marks: Marks): Marks =>
    Object.fromEntries(
      Object.entries(marks).filter(
        ([key, at]) => liveKeys.has(key) || now - at < FORGOTTEN_AFTER_MS
      )
    )
  const kinds = Object.keys(STORAGE_KEYS) as MarkKind[]
  const changed = kinds.filter(
    (kind) => Object.keys(kept(state[kind])).length !== Object.keys(state[kind]).length
  )
  return changed.length === 0
    ? state
    : persisted(Object.fromEntries(changed.map((kind) => [kind, kept(state[kind])])))
}

export const useWorkMarks = create<WorkMarksState>((set) => ({
  settled: readSettledMigrating(),
  pinned: readMarks('pinned'),
  snoozed: readMarks('snoozed'),
  settle: (key, at) =>
    set((s) =>
      persisted({ settled: { ...s.settled, [key]: at }, pinned: without(s.pinned, [key]) })
    ),
  // Pinning wakes the card, so a later unpin leaves it among the active ones.
  togglePin: (key, at) =>
    set((s) =>
      persisted({
        pinned: s.pinned[key] === undefined ? { ...s.pinned, [key]: at } : without(s.pinned, [key]),
        settled: without(s.settled, [key]),
        snoozed: without(s.snoozed, [key]),
      })
    ),
  snooze: (key, until) =>
    set((s) =>
      persisted({ snoozed: { ...s.snoozed, [key]: until }, pinned: without(s.pinned, [key]) })
    ),
  restore: (key) =>
    set((s) =>
      persisted({ settled: without(s.settled, [key]), snoozed: without(s.snoozed, [key]) })
    ),
  wake: (keys) =>
    set((s) => persisted({ settled: without(s.settled, keys), snoozed: without(s.snoozed, keys) })),
  forgetGone: (liveKeys, now) => set((s) => forgotten(s, liveKeys, now)),
}))
