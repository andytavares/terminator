// Shapes the renderer needs in order to render supervision state.
//
// They live in shared/ because both processes use them: the main process
// produces them, the surfaces display them. A renderer component importing from
// src/main/ compiles under Vite (types are erased) but fails `tsc -p
// tsconfig.renderer.json`, and more to the point it inverts the layering.
//
// The main-process modules import these rather than redeclaring them, so there
// is exactly one definition of each.

import type { DiffSummary } from '../types/supervision.js'

// ── review ─────────────────────────────────────────────────────────────────

export type RiskGrade = 'P0' | 'P1' | 'P2' | 'P3'

export type CheckState = 'passing' | 'failing' | 'pending' | 'unavailable'

export const REVIEW_STEPS = ['intent', 'risk', 'structure', 'tests'] as const
export type ReviewStep = (typeof REVIEW_STEPS)[number]

export interface ReviewItem {
  readonly sessionId: string
  readonly repoPath: string
  readonly branch: string
  readonly grade: RiskGrade
  /** The specific reason for the grade, shown on every queue item (FR-050). */
  readonly gradeTrigger: string
  readonly queuedAt: number
  readonly diffSummary: DiffSummary
  readonly step: ReviewStep
}

export interface IntentReview {
  readonly request: string
  readonly agentAccount: string
  /** Touched but never asked for — the scope-creep signal. */
  readonly unexpectedFiles: string[]
  readonly untouchedFiles: string[]
  readonly hasScopeConcern: boolean
}

export interface Hunk {
  readonly id: string
  readonly file: string
  readonly newStart: number
  readonly lines: readonly string[]
}

export type HunkDecision = 'accept' | 'reject'

export interface UnattendedMergeRecord {
  readonly sessionId: string
  readonly repoPath: string
  readonly mergedAt: number
  readonly gradeTrigger: string
  readonly checkState: CheckState
  readonly diffSummary: DiffSummary
}

export interface BackpressureDecision {
  readonly allowed: boolean
  readonly unreviewed: number
  readonly limit: number
  readonly reason: string | null
}

// ── stall detection ────────────────────────────────────────────────────────

export type StallSignal = 'silence' | 'loop' | 'revert'

export type Judgement = 'correct' | 'incorrect'

export interface StallFiringInputs {
  readonly toolSilenceMs: number
  readonly diffSilenceMs: number
  readonly distinctFiles: number
  readonly netChange: number
  readonly reverts: number
  readonly shellInFlight: boolean
}

export interface RecordedFiring {
  readonly id: string
  readonly sessionId: string
  readonly signal: StallSignal
  readonly firedAt: number
  readonly inputs: StallFiringInputs
  readonly shadowMode: boolean
  readonly judgement: Judgement | null
  readonly judgedAt: number | null
}

export interface PrecisionReport {
  readonly total: number
  readonly judged: number
  readonly incorrect: number
  /** Null when nothing is judged — unknown is not the same as perfect. */
  readonly incorrectRate: number | null
}

// ── feed ───────────────────────────────────────────────────────────────────

export type FeedAuthor = 'agent' | 'console'

export interface FeedEntry {
  readonly id: string
  readonly at: number
  readonly sessionId: string
  readonly author: FeedAuthor
  readonly summary: string
  /** Only an agent entry can be replied to — the console is not listening. */
  readonly replyable: boolean
}

/**
 * Routine progress, batched rather than delivered as it happens (FR-028). The
 * operator reads this when they choose to; nothing in it ever interrupts.
 */
export interface Digest {
  readonly from: number
  readonly to: number
  readonly entryCount: number
  readonly sessionCount: number
  readonly bySession: ReadonlyArray<{ sessionId: string; entries: readonly FeedEntry[] }>
}

// ── work items ─────────────────────────────────────────────────────────────

export interface WorkItemLane {
  readonly ord: number
  readonly repo: string
  readonly role: 'producer' | 'consumer'
  readonly branch: string
  readonly task_ids: string[]
  readonly blocks: number[]
  readonly blocked_by: number[]
}

export interface WorkItemView {
  readonly contract_version: number
  readonly id: string
  readonly source: 'linear' | 'github' | 'local'
  readonly source_url?: string
  readonly title: string
  readonly created_at: string
  readonly phase: string
  readonly artifacts: { spec?: string; plan?: string; tasks?: string }
  readonly gates: Record<string, { ok: boolean; at?: string }>
  readonly contract?: { summary?: string; shared_files: string[] }
  readonly lanes: WorkItemLane[]
}

export interface LaneViewModel {
  readonly lane: WorkItemLane
  readonly collisions: string[]
  readonly blockedBy: number[]
}

// ── provisioning ───────────────────────────────────────────────────────────

export interface ScriptResult {
  readonly exitCode: number
  readonly output: string
  readonly durationMs: number
}
