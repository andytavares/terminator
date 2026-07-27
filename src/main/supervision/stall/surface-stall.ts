import type { FiringLog } from './firing-log.js'
import type { StallFiring } from './evaluate-stall.js'

// The shadow-mode gate. Shadow mode is global and defaults ON (FR-018): the
// detector runs and records from the first release, but leaves session state,
// the feed, and every notification path untouched until the operator turns it
// off on the evidence of the precision report.
//
// The boolean is read here, at the surfacing step — never inside evaluateStall.
// That keeps one code path: there is no separate shadow implementation to
// maintain, and precision is measured identically in both modes.

export interface FeedEntryDraft {
  readonly sessionId: string
  readonly author: 'console' | 'agent'
  readonly summary: string
  readonly at: number
}

export interface ShadowStore {
  get(): boolean | undefined
  set(value: boolean): void
}

export interface StallSurfacerOptions {
  log: FiringLog
  setStalled: (sessionId: string, firing: StallFiring) => void
  postFeedEntry: (entry: FeedEntryDraft) => void
  notify: (entry: FeedEntryDraft) => void
  shadowStore: ShadowStore
}

export interface StallSurfacer {
  surface(firing: StallFiring): void
  isShadowMode(): boolean
  setShadowMode(value: boolean): void
}

const SIGNAL_PROSE: Record<StallFiring['signal'], string> = {
  silence: 'has recorded no tool activity',
  loop: 'is looping on a single file with nothing to show for it',
  revert: 'has reverted its own edits repeatedly',
}

export function createStallSurfacer(options: StallSurfacerOptions): StallSurfacer {
  const { log, setStalled, postFeedEntry, notify, shadowStore } = options

  function isShadowMode(): boolean {
    // Absent means on. Defaulting to silence is the safe direction: a detector
    // that has never been tuned should not be allowed to interrupt anyone.
    return shadowStore.get() ?? true
  }

  return {
    isShadowMode,

    setShadowMode(value: boolean): void {
      shadowStore.set(value)
    },

    surface(firing: StallFiring): void {
      const shadow = isShadowMode()
      // Recorded in every mode (FR-017). Shadow gates the consequence, not the
      // record, which is what makes the precision report meaningful before the
      // operator has ever seen a stall notification.
      log.record(firing, shadow)
      if (shadow) return

      const entry: FeedEntryDraft = {
        sessionId: firing.sessionId,
        // Attributed to the console, because the agent did not write it and
        // pretending otherwise would misrepresent who noticed (FR-092).
        author: 'console',
        summary: `Terminator: this session ${SIGNAL_PROSE[firing.signal]} (${firing.signal} signal).`,
        at: firing.firedAt,
      }

      setStalled(firing.sessionId, firing)
      postFeedEntry(entry)
      notify(entry)
    },
  }
}
