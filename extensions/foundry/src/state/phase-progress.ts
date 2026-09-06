import { PHASE_LABELS, PHASE_ORDER } from '../types/speckit.types.js'
import type { CardSummary, PhaseId } from '../types/speckit.types.js'

/**
 * How far a card has got, in words.
 *
 * The board drew a row of ten identical circles numbered 1 to 10 and a `0/10`
 * fraction. The phase names existed all along — `PHASE_LABELS` — but only ever
 * surfaced as a tooltip, or as text beside the one phase actively running. So a
 * card could not answer the question you ask a board card, and reading your own
 * board required having memorised that phase 4 is Plan.
 *
 * Pure: everything comes from the summary it is given.
 */

export interface PhaseProgress {
  /** How many phases are finished. */
  done: number
  total: number
  /**
   * The name of the next phase to happen, or null when the card is finished.
   * This is the one fact on the card you can act on.
   */
  nextPhaseName: string | null
  /** The phases already finished, named, for the hover detail. */
  completedNames: string[]
  /** Finished every phase. */
  complete: boolean
}

export function phaseProgress(card: CardSummary): PhaseProgress {
  const total = card.phaseSummary.total || PHASE_ORDER.length
  // A summary can outrun the known phase list if the pipeline changes under a
  // card mid-flight; clamp rather than index past the end.
  const done = Math.max(0, Math.min(card.phaseSummary.done, total))
  const complete = done >= total

  return {
    done,
    total,
    nextPhaseName: complete ? null : nameOf(PHASE_ORDER[done]),
    completedNames: PHASE_ORDER.slice(0, done).map(nameOf),
    complete,
  }
}

/**
 * What the card says next to its progress bar.
 *
 * Waiting on a person reads differently from waiting on a machine, and the
 * distinction is the whole point of the board — so it is stated, not left to
 * the colour of a dot.
 */
export function nextStepLabel(card: CardSummary): string {
  const progress = phaseProgress(card)
  if (progress.complete) return 'Done'
  if (card.phaseSummary.awaitingReview) return `Review ${lower(progress.nextPhaseName)}`
  if (card.runStatus === 'running') return `Running ${lower(progress.nextPhaseName)}`
  if (card.runStatus === 'failed') return `${progress.nextPhaseName} failed`
  return `Next: ${lower(progress.nextPhaseName)}`
}

/** Completed phases, for the title attribute on the bar. */
export function completedSummary(card: CardSummary): string {
  const { completedNames, done, total } = phaseProgress(card)
  if (completedNames.length === 0) return `Nothing done yet · 0 of ${total}`
  return `${done} of ${total} · ${completedNames.join(', ')} done`
}

function nameOf(id: PhaseId | undefined): string {
  return id === undefined ? 'Done' : PHASE_LABELS[id]
}

/**
 * Sentence case inside a sentence: "Next: write the plan" rather than
 * "Next: Plan", which reads as a proper noun mid-phrase.
 */
function lower(name: string | null): string {
  if (name === null) return 'done'
  return name.charAt(0).toLowerCase() + name.slice(1)
}
