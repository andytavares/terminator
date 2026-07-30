// Per-hunk accept/reject (FR-052). Only accepted changes are retained.
//
// Going direct to the agent runtime is what makes this possible at all: Zed
// cannot offer it for external agents because the ACP filesystem APIs were
// removed. The unit of decision is a hunk, not a file, because a single file
// routinely contains both the change you asked for and the one you did not.

export interface Hunk {
  readonly id: string
  readonly file: string
  /** First line of the hunk in the old file — what reverting it applies to. */
  readonly oldStart: number
  /**
   * The file did not exist before this change.
   *
   * Reverting needs to say so: a patch header naming the file on both sides
   * asks git to reverse an addition against something it thinks was already
   * there, and it refuses. Creating files is most of what an agent does, so
   * this is the common case rather than the corner.
   */
  readonly isNew: boolean
  /** First line of the hunk in the new file. */
  readonly newStart: number
  readonly lines: readonly string[]
}

export type HunkDecision = 'accept' | 'reject'

export interface FileDecisions {
  readonly file: string
  readonly accepted: string[]
  readonly rejected: string[]
}

/** A hunk together with what has been decided about it. */
export interface ReviewableHunk {
  readonly hunk: Hunk
  readonly decision: HunkDecision | null
}

export interface DecisionSet {
  decide(hunkId: string, decision: HunkDecision): void
  /**
   * Every hunk, decided or not, in the order the diff has them.
   *
   * `byFile` below reports only what has been decided, which is what a summary
   * needs and exactly what a reviewer cannot use: an undecided hunk is the one
   * still needing a decision, and it would never appear.
   */
  list(): ReviewableHunk[]
  byFile(): FileDecisions[]
  /** Every hunk decided, so the review can be completed. */
  isComplete(): boolean
  /** All rejected: the branch keeps nothing and the session is discarded, not merged. */
  isFullReject(): boolean
}

export function createDecisionSet(hunks: readonly Hunk[]): DecisionSet {
  const decisions = new Map<string, HunkDecision>()
  const byId = new Map(hunks.map((hunk) => [hunk.id, hunk]))

  return {
    decide(hunkId: string, decision: HunkDecision): void {
      // Unknown hunks are ignored rather than recorded: a decision about
      // something that is not in the diff cannot be applied.
      if (!byId.has(hunkId)) return
      decisions.set(hunkId, decision)
    },

    list(): ReviewableHunk[] {
      return hunks.map((hunk) => ({ hunk, decision: decisions.get(hunk.id) ?? null }))
    },

    byFile(): FileDecisions[] {
      const files = new Map<string, FileDecisions>()
      for (const hunk of hunks) {
        const entry = files.get(hunk.file) ?? { file: hunk.file, accepted: [], rejected: [] }
        const decision = decisions.get(hunk.id)
        if (decision === 'accept') entry.accepted.push(hunk.id)
        else if (decision === 'reject') entry.rejected.push(hunk.id)
        files.set(hunk.file, entry)
      }
      return [...files.values()].sort((a, b) => a.file.localeCompare(b.file))
    },

    isComplete(): boolean {
      return hunks.every((hunk) => decisions.has(hunk.id))
    },

    isFullReject(): boolean {
      // Distinguished from "nothing decided yet": an empty diff is not a
      // rejection, and a half-reviewed diff is not one either.
      return hunks.length > 0 && hunks.every((hunk) => decisions.get(hunk.id) === 'reject')
    },
  }
}
