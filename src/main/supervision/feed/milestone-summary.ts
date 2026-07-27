import type { SessionEvent } from '../events/session-event.js'

// FR-091. The feed carries written summaries rather than raw transcript output.
//
// A milestone is a moment worth a sentence — not every tool call. Detecting
// them here, deterministically, means the expensive part (asking a model to
// write the sentence) happens once per milestone rather than once per event,
// so summarisation cost does not scale with transcript length.

export type MilestoneKind = 'started' | 'unblocked' | 'progressed' | 'finished' | 'failed'

export interface Milestone {
  readonly sessionId: string
  readonly kind: MilestoneKind
  readonly at: number
  /** Tool activity since the previous milestone, for the summariser to describe. */
  readonly toolNames: string[]
  readonly filesTouched: string[]
}

/** How many tool calls constitute a chunk of work worth reporting. */
const PROGRESS_EVERY = 12

/**
 * Folds an event stream into milestones. Pure, so the same stream always yields
 * the same milestones and the summariser can be memoised against them.
 */
export function detectMilestones(events: readonly SessionEvent[]): Milestone[] {
  const milestones: Milestone[] = []
  let toolNames: string[] = []
  let filesTouched: string[] = []
  let sinceLastMilestone = 0

  const flush = (sessionId: string, kind: MilestoneKind, at: number): void => {
    milestones.push({
      sessionId,
      kind,
      at,
      toolNames: [...new Set(toolNames)],
      filesTouched: [...new Set(filesTouched)],
    })
    toolNames = []
    filesTouched = []
    sinceLastMilestone = 0
  }

  for (const event of events) {
    switch (event.kind) {
      case 'session_started':
        flush(event.sessionId, 'started', event.at)
        break

      case 'tool_started':
        toolNames.push(event.toolName)
        if (event.targetPath !== undefined) filesTouched.push(event.targetPath)
        sinceLastMilestone += 1
        // A long run of work is itself worth a line, so an operator returning
        // after an hour sees more than "started" and "finished".
        if (sinceLastMilestone >= PROGRESS_EVERY) flush(event.sessionId, 'progressed', event.at)
        break

      case 'permission_resolved':
        flush(event.sessionId, 'unblocked', event.at)
        break

      case 'session_ended':
        flush(event.sessionId, event.outcome === 'error' ? 'failed' : 'finished', event.at)
        break

      default:
        break
    }
  }

  return milestones
}

/**
 * A serviceable sentence with no model call. Used as-is when summarisation is
 * unavailable, and as the fallback when a model call fails — the feed must
 * never be empty just because a summariser was unreachable.
 */
export function describeMilestone(milestone: Milestone): string {
  const files = milestone.filesTouched.length
  const tools = milestone.toolNames.join(', ')

  switch (milestone.kind) {
    case 'started':
      return 'Started work.'
    case 'unblocked':
      return 'Continued after you answered.'
    case 'progressed':
      return files > 0
        ? `Worked across ${files} ${files === 1 ? 'file' : 'files'} using ${tools}.`
        : `Worked using ${tools}.`
    case 'finished':
      return 'Finished.'
    case 'failed':
      return 'Stopped with an error.'
  }
}

export interface SummariserOptions {
  /** One cheap model call per milestone. Omit to use the deterministic text. */
  summarise?: (milestone: Milestone, fallback: string) => Promise<string>
}

export async function summariseMilestone(
  milestone: Milestone,
  options: SummariserOptions = {}
): Promise<string> {
  const fallback = describeMilestone(milestone)
  if (options.summarise === undefined) return fallback

  try {
    const summary = await options.summarise(milestone, fallback)
    return summary.trim() === '' ? fallback : summary.trim()
  } catch {
    // A summariser that is down costs prose, not the record.
    return fallback
  }
}
