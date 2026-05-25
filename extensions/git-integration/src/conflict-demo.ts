/**
 * Conflict resolution helpers for MergeFlow.
 * This file exists to generate realistic merge conflicts for UI testing.
 */

// ---------------------------------------------------------------------------
// Conflict 1 — Simple constant (EASY: 1 line)
// One side bumped the limit, the other kept it conservative.
// ---------------------------------------------------------------------------

export const MAX_CONFLICTS_SHOWN = 10

// ---------------------------------------------------------------------------
// Conflict 2 — Short formatter function (EASY: 3 lines)
// Two different ways to pluralise the word "conflict".
// ---------------------------------------------------------------------------

export function formatConflictCount(n: number): string {
  if (n === 0) return 'no conflicts'
  return n === 1 ? '1 conflict' : `${n} conflicts`
}

// ---------------------------------------------------------------------------
// Conflict 3 — Config object (MEDIUM: 8 lines)
// Different opinions on sensible defaults.
// ---------------------------------------------------------------------------

export const MERGE_FLOW_DEFAULTS = {
  autoAdvance: false,
  showContextLines: 5,
  defaultStrategy: 'manual' as const,
  confirmOnSingleConflict: true,
  persistSessionOnExit: true,
}

// ---------------------------------------------------------------------------
// Conflict 4 — Time-estimate function (MEDIUM-HARD: 12 lines)
// Different mental models for what "how long will this take?" means.
// ---------------------------------------------------------------------------

export function estimateResolutionTime(conflictCount: number): string {
  if (conflictCount === 0) return 'no conflicts to resolve'
  const minutesPerConflict = 3
  const total = Math.ceil(conflictCount * minutesPerConflict)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours > 0) return `about ${hours}h ${minutes}m`
  return `about ${minutes} minutes`
}

// ---------------------------------------------------------------------------
// Conflict 5 — Ranking algorithm (HARD: 20 lines)
// One side does a simple sort; the other weighs block size too.
// ---------------------------------------------------------------------------

import type { ConflictFile } from './schemas/merge-flow.schema'

export function rankConflictsByDifficulty(files: ConflictFile[]): ConflictFile[] {
  return [...files].sort((a, b) => {
    const largeBlockPenalty = (f: ConflictFile) =>
      f.blocks.some((bl) => bl.theirsText.length > 100) ? 5 : 0
    const scoreA = a.conflictCount * 3 + largeBlockPenalty(a)
    const scoreB = b.conflictCount * 3 + largeBlockPenalty(b)
    return scoreB - scoreA
  })
}
