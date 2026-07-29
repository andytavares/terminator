import { createJsonlLog } from '../jsonl-log.js'
import type { CheckState, RiskGrade } from './risk-grader.js'
import type { DiffSummary } from './diff-summary.js'

// Unattended merge. It exists, but only for the lowest grade, only under a
// per-repository setting that defaults off, and never when the checks are
// anything other than green.
//
// There is deliberately no way to enable it everywhere at once (FR-059). The
// operator's own framing was that one bad auto-merge kills the feature
// permanently, so the blast radius is capped at one repository by construction.

export interface MergeCandidate {
  readonly sessionId: string
  readonly repoPath: string
  readonly grade: RiskGrade
  readonly gradeTrigger: string
  readonly checkState: CheckState
  readonly diffSummary: DiffSummary
}

export interface MergeDecision {
  readonly may: boolean
  readonly reason: string
}

export interface UnattendedMergeRecord {
  readonly sessionId: string
  readonly repoPath: string
  readonly mergedAt: number
  readonly gradeTrigger: string
  readonly checkState: CheckState
  readonly diffSummary: DiffSummary
}

export interface MergePolicyOptions {
  isUnattendedEnabledFor: (repoPath: string) => boolean
  auditLogPath: string
}

export interface MergePolicy {
  mayMergeUnattended(candidate: MergeCandidate): MergeDecision
  recordUnattendedMerge(candidate: MergeCandidate, at: number): void
  unattendedMerges(): UnattendedMergeRecord[]
}

export function createMergePolicy(options: MergePolicyOptions): MergePolicy {
  const { isUnattendedEnabledFor, auditLogPath } = options
  const log = createJsonlLog<UnattendedMergeRecord>(auditLogPath)

  return {
    mayMergeUnattended(candidate: MergeCandidate): MergeDecision {
      if (!isUnattendedEnabledFor(candidate.repoPath)) {
        return {
          may: false,
          reason: 'unattended merge is not enabled for this repository',
        }
      }
      if (candidate.grade !== 'P3') {
        return {
          may: false,
          reason: `only the lowest grade may merge unattended; this is ${candidate.grade}`,
        }
      }
      if (candidate.checkState !== 'passing') {
        // The safe direction is the default direction: an unreachable or
        // unauthenticated code host reads as `unavailable`, never as passing.
        return {
          may: false,
          reason: `automated checks are ${candidate.checkState}, not passing`,
        }
      }
      return { may: true, reason: 'lowest grade, green checks, enabled for this repository' }
    },

    recordUnattendedMerge(candidate: MergeCandidate, at: number): void {
      // Written at merge time, unconditionally. Retrieval must never depend on
      // the operator having done something first (SC-012).
      log.append({
        sessionId: candidate.sessionId,
        repoPath: candidate.repoPath,
        mergedAt: at,
        gradeTrigger: candidate.gradeTrigger,
        checkState: candidate.checkState,
        diffSummary: candidate.diffSummary,
      })
    },

    unattendedMerges(): UnattendedMergeRecord[] {
      return log.readAll()
    },
  }
}
