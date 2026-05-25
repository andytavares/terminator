/**
 * Conflict resolution helpers for MergeFlow.
 * This file exists to generate realistic merge conflicts for UI testing.
 */

// ---------------------------------------------------------------------------
// Conflict 1 — Simple constant (EASY: 1 line)
// One side bumped the limit, the other kept it conservative.
// ---------------------------------------------------------------------------

export const MAX_CONFLICTS_SHOWN = 5

// ---------------------------------------------------------------------------
// Conflict 2 — Short formatter function (EASY: 3 lines)
// Two different ways to pluralise the word "conflict".
// ---------------------------------------------------------------------------

export function formatConflictCount(n: number): string {
  return `${n} conflict${n !== 1 ? 's' : ''}`
}

// ---------------------------------------------------------------------------
// Conflict 3 — Config object (MEDIUM: 8 lines)
// Different opinions on sensible defaults.
// ---------------------------------------------------------------------------

export const MERGE_FLOW_DEFAULTS = {
  autoAdvance: true,
  showContextLines: 3,
  defaultStrategy: 'ours' as const,
  confirmOnSingleConflict: false,
}

// ---------------------------------------------------------------------------
// Conflict 4 — Time-estimate function (MEDIUM-HARD: 12 lines)
// Different mental models for what "how long will this take?" means.
// ---------------------------------------------------------------------------

export function estimateResolutionTime(conflictCount: number): string {
  const minutesPerConflict = 2
  const total = conflictCount * minutesPerConflict
  if (total < 5) return 'less than 5 minutes'
  if (total < 30) return `about ${total} minutes`
  return 'more than 30 minutes'
}

// ---------------------------------------------------------------------------
// Conflict 5 — Ranking algorithm (HARD: 20 lines)
// One side does a simple sort; the other weighs block size too.
// ---------------------------------------------------------------------------

import type { ConflictFile } from './schemas/merge-flow.schema'

export function rankConflictsByDifficulty(files: ConflictFile[]): ConflictFile[] {
  return [...files].sort((a, b) => b.conflictCount - a.conflictCount)
}
