import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from '../../home/local-storage'
import { storedDismissedOf } from '../../home/stored-shapes'
import type { InboxMarks } from './inbox'

/** @internal */
export const INBOX_SETTLED_KEY = 'terminator.sidebar.inbox-settled'
/** @internal */
export const INBOX_PINNED_KEY = 'terminator.sidebar.inbox-pinned'
/** @internal */
export const INBOX_SNOOZED_KEY = 'terminator.sidebar.inbox-snoozed'
const FORGOTTEN_AFTER_MS = 30 * 24 * 60 * 60 * 1000

type MarkKind = keyof InboxMarks
type Marks = Record<string, number>

const STORAGE_KEYS: Record<MarkKind, string> = {
  settled: INBOX_SETTLED_KEY,
  pinned: INBOX_PINNED_KEY,
  snoozed: INBOX_SNOOZED_KEY,
}

interface InboxMarksState {
  settled: Marks
  pinned: Marks
  snoozed: Marks
  settle: (key: string, at: number) => void
  togglePin: (key: string, at: number) => void
  snooze: (key: string, until: number) => void
  /** Brings settled or snoozed threads back to the top. */
  wake: (keys: readonly string[]) => void
  /** Forgets marks over 30 days old whose thread is not among `liveKeys` any more. */
  forgetGone: (liveKeys: ReadonlySet<string>, now: number) => void
}

const readMarks = (kind: MarkKind): Marks =>
  readStoredJson<Marks>(STORAGE_KEYS[kind], {}, (value) => storedDismissedOf(value))

const without = (marks: Marks, keys: readonly string[]): Marks =>
  Object.fromEntries(Object.entries(marks).filter(([key]) => !keys.includes(key)))

/** The changed kinds, written to storage as they are set. */
function persisted(changes: Partial<Record<MarkKind, Marks>>): Partial<InboxMarksState> {
  for (const [kind, marks] of Object.entries(changes)) {
    writeStoredJson(STORAGE_KEYS[kind as MarkKind], marks)
  }
  return changes
}

function forgotten(state: InboxMarksState, liveKeys: ReadonlySet<string>, now: number) {
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

export const useInboxMarks = create<InboxMarksState>((set) => ({
  settled: readMarks('settled'),
  pinned: readMarks('pinned'),
  snoozed: readMarks('snoozed'),
  settle: (key, at) =>
    set((s) =>
      persisted({ settled: { ...s.settled, [key]: at }, pinned: without(s.pinned, [key]) })
    ),
  togglePin: (key, at) =>
    set((s) =>
      persisted({
        pinned: s.pinned[key] === undefined ? { ...s.pinned, [key]: at } : without(s.pinned, [key]),
      })
    ),
  snooze: (key, until) =>
    set((s) =>
      persisted({ snoozed: { ...s.snoozed, [key]: until }, pinned: without(s.pinned, [key]) })
    ),
  wake: (keys) =>
    set((s) => persisted({ settled: without(s.settled, keys), snoozed: without(s.snoozed, keys) })),
  forgetGone: (liveKeys, now) => set((s) => forgotten(s, liveKeys, now)),
}))
